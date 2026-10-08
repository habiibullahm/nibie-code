-- Actions / Tools V1: owner-scoped audit of Action executions.
-- Sanitized input_summary only — no secrets, tokens, or cookies.

CREATE TABLE "action_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"room_id" uuid,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"action_id" text NOT NULL,
	"capability" text NOT NULL,
	"input_summary" text NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "action_runs_capability_check" CHECK ("action_runs"."capability" IN ('read', 'create', 'update', 'delete', 'execute')),
	CONSTRAINT "action_runs_status_check" CHECK ("action_runs"."status" IN ('requested', 'running', 'completed', 'failed', 'cancelled', 'waiting_for_confirmation')),
	CONSTRAINT "action_runs_action_id_len" CHECK (char_length("action_runs"."action_id") between 1 and 120 AND "action_runs"."action_id" = btrim("action_runs"."action_id")),
	CONSTRAINT "action_runs_input_summary_len" CHECK (char_length("action_runs"."input_summary") between 1 and 240),
	CONSTRAINT "action_runs_error_code_len" CHECK (
		"action_runs"."error_code" IS NULL
		OR char_length("action_runs"."error_code") between 1 and 64
	),
	CONSTRAINT "action_runs_completed_after_start" CHECK (
		"action_runs"."completed_at" IS NULL
		OR "action_runs"."completed_at" >= "action_runs"."started_at"
	)
);
--> statement-breakpoint
ALTER TABLE "action_runs" ADD CONSTRAINT "action_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_runs" ADD CONSTRAINT "action_runs_conversation_owner_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_runs" ADD CONSTRAINT "action_runs_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Single-column message FK so message delete can null only message_id (composite SET NULL would also null conversation_id/user_id).
ALTER TABLE "action_runs" ADD CONSTRAINT "action_runs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_runs_user_started_idx" ON "action_runs" USING btree ("user_id","started_at" DESC,"id");--> statement-breakpoint
CREATE INDEX "action_runs_conversation_idx" ON "action_runs" USING btree ("conversation_id","started_at" DESC);--> statement-breakpoint
CREATE INDEX "action_runs_message_idx" ON "action_runs" USING btree ("message_id") WHERE "message_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE public.action_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.action_runs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY action_runs_select_own ON public.action_runs FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY action_runs_insert_own ON public.action_runs FOR INSERT TO authenticated
	WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
		SELECT 1 FROM public.conversations c
		WHERE c.id = conversation_id AND c.user_id = (SELECT auth.uid())
	));--> statement-breakpoint
CREATE POLICY action_runs_update_own ON public.action_runs FOR UPDATE TO authenticated
	USING (user_id = (SELECT auth.uid()))
	WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY action_runs_delete_own ON public.action_runs FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.action_runs TO authenticated;
