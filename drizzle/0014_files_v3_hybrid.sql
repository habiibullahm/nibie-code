-- Files V3: additive vectors on the existing V2 chunks; no re-chunking.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;--> statement-breakpoint
-- Invoker RPCs need type/operator lookup access in the extension's schema.
DO $migration$
DECLARE vector_schema text;
BEGIN
  SELECT n.nspname INTO vector_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector';
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated', vector_schema);
END;
$migration$;--> statement-breakpoint
-- Respect installations where Supabase already placed vector in extensions.
DO $migration$
DECLARE vector_schema text;
BEGIN
  SELECT n.nspname INTO vector_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector';
  EXECUTE replace(replace($ddl$
ALTER TABLE public.room_file_chunks ADD COLUMN embedding public.vector(512);$ddl$, 'public.vector', quote_ident(vector_schema) || '.vector'), 'OPERATOR(public.<=>)', 'OPERATOR(' || quote_ident(vector_schema) || '.<=>)');
END;
$migration$;--> statement-breakpoint
-- Respect installations where Supabase already placed vector in extensions.
DO $migration$
DECLARE vector_schema text;
BEGIN
  SELECT n.nspname INTO vector_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector';
  EXECUTE replace(replace($ddl$
ALTER TABLE public.room_file_chunks ADD CONSTRAINT room_file_chunks_embedding_nonzero CHECK (embedding IS NULL OR public.vector_norm(embedding) > 0);$ddl$, 'public.vector', quote_ident(vector_schema) || '.vector'), 'OPERATOR(public.<=>)', 'OPERATOR(' || quote_ident(vector_schema) || '.<=>)');
END;
$migration$;--> statement-breakpoint
-- Respect installations where Supabase already placed vector in extensions.
DO $migration$
DECLARE vector_schema text;
BEGIN
  SELECT n.nspname INTO vector_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector';
  EXECUTE replace(replace($ddl$
CREATE INDEX room_file_chunks_embedding_hnsw_idx ON public.room_file_chunks USING hnsw (embedding public.vector_cosine_ops);$ddl$, 'public.vector', quote_ident(vector_schema) || '.vector'), 'OPERATOR(public.<=>)', 'OPERATOR(' || quote_ident(vector_schema) || '.<=>)');
END;
$migration$;--> statement-breakpoint
-- Only the new embedding column can be updated, and only while missing.
GRANT UPDATE (embedding) ON public.room_file_chunks TO authenticated;--> statement-breakpoint
CREATE POLICY room_file_chunks_fill_embedding ON public.room_file_chunks FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()) AND embedding IS NULL AND EXISTS (
  SELECT 1 FROM public.room_files f WHERE f.id = file_id AND f.user_id = (SELECT auth.uid()) AND f.room_id = room_file_chunks.room_id
)) WITH CHECK (user_id = (SELECT auth.uid()) AND embedding IS NOT NULL);--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.search_room_file_chunks(p_room_id uuid, p_query text, p_limit integer DEFAULT 5)
RETURNS TABLE(file_id uuid, original_name text, content text, extracted_truncated boolean, chunk_index integer, rank real)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH q AS (
    SELECT public.room_file_lexical_tsquery(p_query) AS query
  )
  SELECT c.file_id, f.original_name, c.content, f.extracted_truncated, c.chunk_index,
         ts_rank_cd(c.search_vector, q.query) AS rank
  FROM q
  JOIN public.room_file_chunks c ON true
  JOIN public.room_files f ON f.id = c.file_id AND f.user_id = c.user_id AND f.room_id = c.room_id
  WHERE q.query IS NOT NULL
    AND c.user_id = (SELECT auth.uid()) AND c.room_id = p_room_id
    AND f.user_id = (SELECT auth.uid()) AND f.room_id = p_room_id
    AND c.search_vector @@ q.query
  ORDER BY rank DESC, c.file_id, c.chunk_index
  LIMIT least(greatest(p_limit, 0), 10)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.room_file_lexical_tsquery(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.room_file_lexical_tsquery(text) TO authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.search_room_file_chunks(uuid, text, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.search_room_file_chunks(uuid, text, integer) TO authenticated;--> statement-breakpoint
-- Respect installations where Supabase already placed vector in extensions.
DO $migration$
DECLARE vector_schema text;
BEGIN
  SELECT n.nspname INTO vector_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector';
  EXECUTE replace(replace($ddl$

CREATE FUNCTION public.search_room_file_chunks_semantic(p_room_id uuid, p_embedding public.vector(512), p_limit integer DEFAULT 10)
RETURNS TABLE(file_id uuid, original_name text, content text, extracted_truncated boolean, chunk_index integer, similarity double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
SET hnsw.ef_search = '100'
SET hnsw.iterative_scan = 'strict_order'
SET hnsw.max_scan_tuples = '1000' AS $$
  SELECT c.file_id, f.original_name, c.content, f.extracted_truncated, c.chunk_index,
         1 - (c.embedding OPERATOR(public.<=>) p_embedding) AS similarity
  FROM public.room_file_chunks c
  JOIN public.room_files f ON f.id = c.file_id AND f.user_id = c.user_id AND f.room_id = c.room_id
  WHERE c.user_id = (SELECT auth.uid()) AND c.room_id = p_room_id
    AND f.user_id = (SELECT auth.uid()) AND f.room_id = p_room_id AND c.embedding IS NOT NULL
  ORDER BY c.embedding OPERATOR(public.<=>) p_embedding
  LIMIT least(greatest(p_limit, 0), 10)
$$;$ddl$, 'public.vector', quote_ident(vector_schema) || '.vector'), 'OPERATOR(public.<=>)', 'OPERATOR(' || quote_ident(vector_schema) || '.<=>)');
END;
$migration$;--> statement-breakpoint
CREATE FUNCTION public.missing_room_file_embeddings(p_room_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid, content text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT c.id, c.content FROM public.room_file_chunks c
  WHERE c.user_id = (SELECT auth.uid()) AND c.room_id = p_room_id AND c.embedding IS NULL
  ORDER BY c.id LIMIT least(greatest(p_limit, 0), 20)
$$;--> statement-breakpoint
-- Respect installations where Supabase already placed vector in extensions.
DO $migration$
DECLARE vector_schema text;
BEGIN
  SELECT n.nspname INTO vector_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector';
  EXECUTE replace(replace($ddl$
CREATE FUNCTION public.fill_room_file_embeddings(p_room_id uuid, p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE filled integer;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 20 THEN
    RAISE EXCEPTION 'Invalid embedding batch';
  END IF;
  UPDATE public.room_file_chunks c SET embedding = (r.value->>'embedding')::public.vector(512)
  FROM jsonb_array_elements(p_rows) r(value)
  WHERE c.id = (r.value->>'id')::uuid AND c.user_id = (SELECT auth.uid())
    AND c.room_id = p_room_id AND c.embedding IS NULL;
  GET DIAGNOSTICS filled = ROW_COUNT;
  RETURN filled;
END;
$$;$ddl$, 'public.vector', quote_ident(vector_schema) || '.vector'), 'OPERATOR(public.<=>)', 'OPERATOR(' || quote_ident(vector_schema) || '.<=>)');
END;
$migration$;--> statement-breakpoint
-- Respect installations where Supabase already placed vector in extensions.
DO $migration$
DECLARE vector_schema text;
BEGIN
  SELECT n.nspname INTO vector_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector';
  EXECUTE replace(replace($ddl$
REVOKE ALL ON FUNCTION public.search_room_file_chunks_semantic(uuid, public.vector, integer) FROM PUBLIC;$ddl$, 'public.vector', quote_ident(vector_schema) || '.vector'), 'OPERATOR(public.<=>)', 'OPERATOR(' || quote_ident(vector_schema) || '.<=>)');
END;
$migration$;--> statement-breakpoint
-- Respect installations where Supabase already placed vector in extensions.
DO $migration$
DECLARE vector_schema text;
BEGIN
  SELECT n.nspname INTO vector_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector';
  EXECUTE replace(replace($ddl$
GRANT EXECUTE ON FUNCTION public.search_room_file_chunks_semantic(uuid, public.vector, integer) TO authenticated;$ddl$, 'public.vector', quote_ident(vector_schema) || '.vector'), 'OPERATOR(public.<=>)', 'OPERATOR(' || quote_ident(vector_schema) || '.<=>)');
END;
$migration$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.missing_room_file_embeddings(uuid, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.missing_room_file_embeddings(uuid, integer) TO authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.fill_room_file_embeddings(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.fill_room_file_embeddings(uuid, jsonb) TO authenticated;
