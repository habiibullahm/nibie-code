-- Citations V1: persist server-owned SourceReference rows with assistant messages.
-- Additive only. Memory is not a citation source.

CREATE TYPE "public"."citation_source_kind" AS ENUM('web', 'room_file', 'attachment');--> statement-breakpoint
CREATE TABLE "message_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" "citation_source_kind" NOT NULL,
	"handle" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"domain" text,
	"excerpt" text,
	"retrieved_at" timestamp with time zone,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_sources_message_ordinal_key" UNIQUE("message_id","ordinal"),
	CONSTRAINT "message_sources_message_handle_key" UNIQUE("message_id","handle"),
	CONSTRAINT "message_sources_ordinal_positive" CHECK ("message_sources"."ordinal" >= 1 AND "message_sources"."ordinal" <= 20),
	CONSTRAINT "message_sources_handle_format" CHECK ("message_sources"."handle" ~ '^(web|room_file|attachment):[1-9][0-9]*$'),
	CONSTRAINT "message_sources_title_length" CHECK (char_length("message_sources"."title") between 1 and 200 and "message_sources"."title" = btrim("message_sources"."title")),
	CONSTRAINT "message_sources_url_safe" CHECK ("message_sources"."url" IS NULL OR (char_length("message_sources"."url") between 1 and 2048 AND "message_sources"."url" ~ '^https?://' AND position('@' in split_part(substr("message_sources"."url", 1, 64), '/', 3)) = 0)),
	CONSTRAINT "message_sources_domain_length" CHECK ("message_sources"."domain" IS NULL OR (char_length("message_sources"."domain") between 1 and 253 AND "message_sources"."domain" = btrim("message_sources"."domain"))),
	CONSTRAINT "message_sources_excerpt_length" CHECK ("message_sources"."excerpt" IS NULL OR char_length("message_sources"."excerpt") between 1 and 480),
	CONSTRAINT "message_sources_source_id_length" CHECK ("message_sources"."source_id" IS NULL OR (char_length("message_sources"."source_id") between 1 and 200 AND "message_sources"."source_id" = btrim("message_sources"."source_id"))),
	CONSTRAINT "message_sources_web_requires_url" CHECK ("message_sources"."kind" <> 'web' OR ("message_sources"."url" IS NOT NULL AND "message_sources"."domain" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "message_sources" ADD CONSTRAINT "message_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_sources" ADD CONSTRAINT "message_sources_message_owner_fk" FOREIGN KEY ("message_id","conversation_id","user_id") REFERENCES "public"."messages"("id","conversation_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_sources_conversation_idx" ON "message_sources" USING btree ("conversation_id","message_id");--> statement-breakpoint
ALTER TABLE public.message_sources ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.message_sources FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY message_sources_select_own ON public.message_sources FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY message_sources_insert_own ON public.message_sources FOR INSERT TO authenticated
	WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
		SELECT 1 FROM public.messages m
		WHERE m.id = message_id AND m.conversation_id = conversation_id AND m.user_id = (SELECT auth.uid()) AND m.role = 'assistant'
	));--> statement-breakpoint
CREATE POLICY message_sources_delete_own ON public.message_sources FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.message_sources TO authenticated;--> statement-breakpoint
GRANT USAGE ON TYPE public.citation_source_kind TO authenticated;
