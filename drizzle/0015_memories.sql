-- Recall / Memory V1: explicit user-owned cross-conversation memories.
-- Additive only. No external API calls from SQL.

CREATE TYPE "public"."memory_type" AS ENUM('preference', 'project', 'instruction', 'fact');--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "memory_type" NOT NULL,
	"content" text NOT NULL,
	"normalized_key" text NOT NULL,
	"source_conversation_id" uuid,
	"source_message_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "memories_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "memories_user_key_unique" UNIQUE("user_id","normalized_key"),
	CONSTRAINT "memories_content_length" CHECK (char_length("memories"."content") between 1 and 1000 and "memories"."content" = btrim("memories"."content")),
	CONSTRAINT "memories_normalized_key_length" CHECK (char_length("memories"."normalized_key") between 1 and 200 and "memories"."normalized_key" = btrim("memories"."normalized_key"))
);
--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Single-column FK so conversation delete can null only the source id (composite SET NULL would also null user_id).
ALTER TABLE "memories" ADD CONSTRAINT "memories_source_conversation_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memories_user_active_idx" ON "memories" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "memories_user_updated_idx" ON "memories" USING btree ("user_id","updated_at","id");--> statement-breakpoint
-- Optional vector column; schema-aware like files v3 (public vs extensions).
DO $migration$
DECLARE vector_schema text;
BEGIN
  SELECT n.nspname INTO vector_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector';
  IF vector_schema IS NULL THEN
    CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
    SELECT n.nspname INTO vector_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated', vector_schema);
  EXECUTE replace($ddl$
ALTER TABLE public.memories ADD COLUMN embedding public.vector(512);$ddl$, 'public.vector', quote_ident(vector_schema) || '.vector');
  EXECUTE replace($ddl$
ALTER TABLE public.memories ADD CONSTRAINT memories_embedding_nonzero CHECK (embedding IS NULL OR public.vector_norm(embedding) > 0);$ddl$, 'public.vector', quote_ident(vector_schema) || '.vector');
  EXECUTE replace($ddl$
CREATE INDEX memories_embedding_hnsw_idx ON public.memories USING hnsw (embedding public.vector_cosine_ops);$ddl$, 'public.vector', quote_ident(vector_schema) || '.vector');
END;
$migration$;--> statement-breakpoint
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.memories FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY memories_select_own ON public.memories FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY memories_insert_own ON public.memories FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY memories_update_own ON public.memories FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY memories_delete_own ON public.memories FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memories TO authenticated;--> statement-breakpoint
GRANT USAGE ON TYPE public.memory_type TO authenticated;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_memories_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN NEW.updated_at = pg_catalog.clock_timestamp(); RETURN NEW; END; $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.set_memories_updated_at() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.set_memories_updated_at() TO authenticated;--> statement-breakpoint
CREATE TRIGGER memories_set_updated_at BEFORE UPDATE ON public.memories FOR EACH ROW EXECUTE FUNCTION public.set_memories_updated_at();--> statement-breakpoint
-- Lexical search scoped by auth.uid(). No external calls.
CREATE OR REPLACE FUNCTION public.search_memories_lexical(p_query text, p_limit integer DEFAULT 5)
RETURNS TABLE(id uuid, type public.memory_type, content text, normalized_key text, rank real)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT m.id, m.type, m.content, m.normalized_key,
         ts_rank_cd(to_tsvector('simple', m.content), plainto_tsquery('simple', coalesce(nullif(btrim(p_query), ''), ' '))) AS rank
  FROM public.memories m
  WHERE m.user_id = (SELECT auth.uid())
    AND m.is_active = true
    AND nullif(btrim(p_query), '') IS NOT NULL
    AND to_tsvector('simple', m.content) @@ plainto_tsquery('simple', btrim(p_query))
  ORDER BY rank DESC, m.updated_at DESC, m.id
  LIMIT least(greatest(p_limit, 0), 10)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.search_memories_lexical(text, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.search_memories_lexical(text, integer) TO authenticated;--> statement-breakpoint
-- Semantic search when embeddings exist. Soft-fail at the app layer if unavailable.
DO $migration$
DECLARE vector_schema text;
BEGIN
  SELECT n.nspname INTO vector_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector';
  EXECUTE replace(replace($ddl$
CREATE FUNCTION public.search_memories_semantic(p_embedding public.vector(512), p_limit integer DEFAULT 5)
RETURNS TABLE(id uuid, type public.memory_type, content text, normalized_key text, similarity double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT m.id, m.type, m.content, m.normalized_key,
         1 - (m.embedding OPERATOR(public.<=>) p_embedding) AS similarity
  FROM public.memories m
  WHERE m.user_id = (SELECT auth.uid()) AND m.is_active = true AND m.embedding IS NOT NULL
  ORDER BY m.embedding OPERATOR(public.<=>) p_embedding
  LIMIT least(greatest(p_limit, 0), 10)
$$;$ddl$, 'public.vector', quote_ident(vector_schema) || '.vector'), 'OPERATOR(public.<=>)', 'OPERATOR(' || quote_ident(vector_schema) || '.<=>)');
END;
$migration$;--> statement-breakpoint
DO $migration$
DECLARE vector_schema text;
BEGIN
  SELECT n.nspname INTO vector_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector';
  EXECUTE replace($ddl$
REVOKE ALL ON FUNCTION public.search_memories_semantic(public.vector, integer) FROM PUBLIC;$ddl$, 'public.vector', quote_ident(vector_schema) || '.vector');
  EXECUTE replace($ddl$
GRANT EXECUTE ON FUNCTION public.search_memories_semantic(public.vector, integer) TO authenticated;$ddl$, 'public.vector', quote_ident(vector_schema) || '.vector');
END;
$migration$;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "recall_enabled" boolean DEFAULT true NOT NULL;
