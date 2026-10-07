-- Deep Research V1: high-level run metadata for assistant messages.
-- Counts and status only — no CoT, query text, or page bodies.

CREATE TABLE "message_research" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" text NOT NULL,
	"follow_up_used" boolean DEFAULT false NOT NULL,
	"search_query_count" integer DEFAULT 0 NOT NULL,
	"search_result_count" integer DEFAULT 0 NOT NULL,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"pages_failed" integer DEFAULT 0 NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"model_call_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"time_sensitive" boolean DEFAULT false NOT NULL,
	"usage_policy" text DEFAULT 'temporary_undercount_v1' NOT NULL,
	"incomplete_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_research_status_check" CHECK ("message_research"."status" IN ('complete', 'interrupted', 'failed', 'incomplete')),
	CONSTRAINT "message_research_counts_nonneg" CHECK (
		"message_research"."search_query_count" >= 0
		AND "message_research"."search_result_count" >= 0
		AND "message_research"."pages_fetched" >= 0
		AND "message_research"."pages_failed" >= 0
		AND "message_research"."evidence_count" >= 0
		AND "message_research"."model_call_count" >= 0
		AND "message_research"."duration_ms" >= 0
	),
	CONSTRAINT "message_research_usage_policy_len" CHECK (char_length("message_research"."usage_policy") between 1 and 64),
	CONSTRAINT "message_research_incomplete_reason_len" CHECK (
		"message_research"."incomplete_reason" IS NULL
		OR char_length("message_research"."incomplete_reason") between 1 and 120
	)
);
--> statement-breakpoint
ALTER TABLE "message_research" ADD CONSTRAINT "message_research_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_research" ADD CONSTRAINT "message_research_message_owner_fk" FOREIGN KEY ("message_id","conversation_id","user_id") REFERENCES "public"."messages"("id","conversation_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_research_conversation_idx" ON "message_research" USING btree ("conversation_id","message_id");--> statement-breakpoint
ALTER TABLE public.message_research ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.message_research FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY message_research_select_own ON public.message_research FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY message_research_insert_own ON public.message_research FOR INSERT TO authenticated
	WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
		SELECT 1 FROM public.messages m
		WHERE m.id = message_id AND m.conversation_id = conversation_id AND m.user_id = (SELECT auth.uid()) AND m.role = 'assistant'
	));--> statement-breakpoint
CREATE POLICY message_research_update_own ON public.message_research FOR UPDATE TO authenticated
	USING (user_id = (SELECT auth.uid()))
	WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY message_research_delete_own ON public.message_research FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_research TO authenticated;
