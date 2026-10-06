-- Thread summary lifecycle (P0). One rolling summary per conversation, written in the background after a complete reply.
-- covers_through_position only moves forward, so an older background job can never overwrite a newer summary.
-- Original messages are never deleted; the summary is deleted with its conversation.

CREATE TABLE "thread_summaries" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"objective" text NOT NULL,
	"important_context" text NOT NULL,
	"decisions" text NOT NULL,
	"completed_work" text NOT NULL,
	"current_state" text NOT NULL,
	"open_questions" text NOT NULL,
	"covers_through_position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_summaries_coverage_positive" CHECK ("thread_summaries"."covers_through_position" >= 1),
	CONSTRAINT "thread_summaries_objective_length" CHECK (char_length("thread_summaries"."objective") <= 3200),
	CONSTRAINT "thread_summaries_important_context_length" CHECK (char_length("thread_summaries"."important_context") <= 3200),
	CONSTRAINT "thread_summaries_decisions_length" CHECK (char_length("thread_summaries"."decisions") <= 3200),
	CONSTRAINT "thread_summaries_completed_work_length" CHECK (char_length("thread_summaries"."completed_work") <= 3200),
	CONSTRAINT "thread_summaries_current_state_length" CHECK (char_length("thread_summaries"."current_state") <= 3200),
	CONSTRAINT "thread_summaries_open_questions_length" CHECK (char_length("thread_summaries"."open_questions") <= 3200)
);
--> statement-breakpoint
ALTER TABLE "thread_summaries" ADD CONSTRAINT "thread_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_summaries" ADD CONSTRAINT "thread_summaries_conversation_owner_fk" FOREIGN KEY ("conversation_id","user_id") REFERENCES "public"."conversations"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thread_summaries_user_idx" ON "thread_summaries" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE public.thread_summaries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.thread_summaries FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY thread_summaries_select_own ON public.thread_summaries FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY thread_summaries_insert_own ON public.thread_summaries FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY thread_summaries_update_own ON public.thread_summaries FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY thread_summaries_delete_own ON public.thread_summaries FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
REVOKE ALL ON public.thread_summaries FROM PUBLIC, anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.thread_summaries TO authenticated;--> statement-breakpoint
-- Coverage is monotonic and a summary never moves to another conversation or owner, whichever path writes it.
CREATE OR REPLACE FUNCTION public.guard_thread_summary_update() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.conversation_id <> OLD.conversation_id OR NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Thread summary owner cannot change.';
  END IF;
  IF NEW.covers_through_position <= OLD.covers_through_position THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Thread summary coverage must increase.';
  END IF;
  NEW.created_at = OLD.created_at;
  NEW.updated_at = pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_thread_summary_update() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.guard_thread_summary_update() TO authenticated;--> statement-breakpoint
CREATE TRIGGER thread_summaries_guard_update BEFORE UPDATE ON public.thread_summaries FOR EACH ROW EXECUTE FUNCTION public.guard_thread_summary_update();--> statement-breakpoint
-- The write path for the background job. SECURITY INVOKER: row-level security and the owner foreign key still apply, and the
-- owner is always the caller. One atomic upsert handles the first-insert race, and a candidate whose coverage is not newer than
-- the stored one is discarded (returns false) instead of overwriting it.
CREATE OR REPLACE FUNCTION public.save_thread_summary(
  p_conversation_id uuid,
  p_objective text,
  p_important_context text,
  p_decisions text,
  p_completed_work text,
  p_current_state text,
  p_open_questions text,
  p_covers_through_position integer
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_saved integer;
BEGIN
  IF v_user_id IS NULL OR p_conversation_id IS NULL OR p_covers_through_position IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated conversation required.';
  END IF;
  -- Another owner's conversation (hidden by its own RLS) fails the same way as a missing one.
  PERFORM 1 FROM public.conversations c WHERE c.id = p_conversation_id AND c.user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Conversation unavailable.'; END IF;
  INSERT INTO public.thread_summaries AS s (
    conversation_id, user_id, objective, important_context, decisions, completed_work, current_state, open_questions, covers_through_position
  ) VALUES (
    p_conversation_id, v_user_id, p_objective, p_important_context, p_decisions, p_completed_work, p_current_state, p_open_questions, p_covers_through_position
  )
  ON CONFLICT (conversation_id) DO UPDATE SET
    objective = EXCLUDED.objective,
    important_context = EXCLUDED.important_context,
    decisions = EXCLUDED.decisions,
    completed_work = EXCLUDED.completed_work,
    current_state = EXCLUDED.current_state,
    open_questions = EXCLUDED.open_questions,
    covers_through_position = EXCLUDED.covers_through_position
  WHERE s.user_id = v_user_id AND s.covers_through_position < EXCLUDED.covers_through_position;
  GET DIAGNOSTICS v_saved = ROW_COUNT;
  RETURN v_saved > 0;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.save_thread_summary(uuid, text, text, text, text, text, text, integer) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.save_thread_summary(uuid, text, text, text, text, text, text, integer) TO authenticated;
