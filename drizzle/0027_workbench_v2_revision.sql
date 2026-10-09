-- Workbench V2: monotonic document revision + AI revise runs that can meter via weekly/spend reservations.
-- Additive: new column, new table, drop generation_id→messages FKs (RPC validates message OR revision run), replace reserve functions.

ALTER TABLE "workbench_documents" ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workbench_documents" DROP CONSTRAINT IF EXISTS "workbench_documents_revision_positive";--> statement-breakpoint
ALTER TABLE "workbench_documents" ADD CONSTRAINT "workbench_documents_revision_positive" CHECK ("revision" >= 1);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workbench_revision_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "status" text DEFAULT 'generating' NOT NULL,
  "instruction" text NOT NULL,
  "base_revision" integer NOT NULL,
  "base_title" text NOT NULL,
  "base_content" text NOT NULL,
  "proposed_title" text,
  "proposed_content" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "workbench_revision_runs_status_check" CHECK ("status" IN ('generating', 'complete', 'failed', 'cancelled')),
  CONSTRAINT "workbench_revision_runs_instruction_length" CHECK (char_length("instruction") between 1 and 4000),
  CONSTRAINT "workbench_revision_runs_base_revision_positive" CHECK ("base_revision" >= 1)
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "workbench_revision_runs" ADD CONSTRAINT "workbench_revision_runs_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "workbench_documents" ADD CONSTRAINT "workbench_documents_id_user_key" UNIQUE ("id", "user_id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "workbench_revision_runs" ADD CONSTRAINT "workbench_revision_runs_document_owner_fk"
    FOREIGN KEY ("document_id", "user_id") REFERENCES "public"."workbench_documents"("id", "user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "workbench_revision_runs_user_created_idx" ON "workbench_revision_runs" USING btree ("user_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workbench_revision_runs_document_idx" ON "workbench_revision_runs" USING btree ("document_id");--> statement-breakpoint

ALTER TABLE "workbench_revision_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workbench_revision_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS "workbench_revision_runs_select_own" ON "workbench_revision_runs";--> statement-breakpoint
CREATE POLICY "workbench_revision_runs_select_own" ON "workbench_revision_runs" FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
DROP POLICY IF EXISTS "workbench_revision_runs_insert_own" ON "workbench_revision_runs";--> statement-breakpoint
CREATE POLICY "workbench_revision_runs_insert_own" ON "workbench_revision_runs" FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
DROP POLICY IF EXISTS "workbench_revision_runs_update_own" ON "workbench_revision_runs";--> statement-breakpoint
CREATE POLICY "workbench_revision_runs_update_own" ON "workbench_revision_runs" FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
DROP POLICY IF EXISTS "workbench_revision_runs_delete_own" ON "workbench_revision_runs";--> statement-breakpoint
CREATE POLICY "workbench_revision_runs_delete_own" ON "workbench_revision_runs" FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "workbench_revision_runs" TO authenticated;--> statement-breakpoint

-- Usage/spend reservations may key off chat assistant messages OR workbench revision runs.
ALTER TABLE "weekly_usage_reservations" DROP CONSTRAINT IF EXISTS "weekly_usage_reservations_generation_id_messages_id_fk";--> statement-breakpoint
ALTER TABLE "ai_spend_reservations" DROP CONSTRAINT IF EXISTS "ai_spend_reservations_generation_id_fkey";--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.reserve_weekly_ai_usage(
  p_generation_id uuid,
  p_logical_mode public.weekly_usage_mode,
  p_usage_kind text DEFAULT 'chat'
)
RETURNS TABLE(accepted boolean, credits_charged integer, credits_used integer, credits_remaining integer, reset_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_now timestamptz := clock_timestamp();
  v_week_start date := date_trunc('week', v_now AT TIME ZONE 'UTC')::date;
  v_reset_at timestamptz;
  v_base integer;
  v_cost integer;
  v_kind text;
  v_usage public.weekly_ai_usage;
  v_reservation public.weekly_usage_reservations;
BEGIN
  IF v_user_id IS NULL OR p_generation_id IS NULL OR p_logical_mode IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated generation required.';
  END IF;
  v_kind := lower(coalesce(nullif(btrim(p_usage_kind), ''), 'chat'));
  IF v_kind NOT IN ('chat', 'research') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid usage kind.';
  END IF;
  v_reset_at := (v_week_start + 7)::timestamp AT TIME ZONE 'UTC';
  v_base := CASE p_logical_mode WHEN 'Fast' THEN 1 WHEN 'Balanced' THEN 3 WHEN 'High' THEN 6 END;
  v_cost := CASE WHEN v_kind = 'research' THEN v_base + 6 ELSE v_base END;

  PERFORM 1 FROM public.messages m
    WHERE m.id = p_generation_id AND m.user_id = v_user_id AND m.role = 'assistant' AND m.status = 'streaming'
    FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM 1 FROM public.workbench_revision_runs r
      WHERE r.id = p_generation_id AND r.user_id = v_user_id AND r.status = 'generating'
      FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Generation unavailable.'; END IF;

  SELECT r.* INTO v_reservation FROM public.weekly_usage_reservations r
    WHERE r.generation_id = p_generation_id FOR UPDATE;
  IF FOUND THEN
    IF v_reservation.user_id <> v_user_id THEN RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Generation unavailable.'; END IF;
    SELECT u.* INTO v_usage FROM public.weekly_ai_usage u WHERE u.user_id = v_user_id AND u.week_start = v_reservation.week_start;
    RETURN QUERY SELECT v_reservation.released_at IS NULL,
      CASE WHEN v_reservation.released_at IS NULL THEN v_reservation.credits_charged ELSE 0 END,
      COALESCE(v_usage.credits_used, 0), GREATEST(0, 500 - COALESCE(v_usage.credits_used, 0)), v_reset_at;
    RETURN;
  END IF;

  INSERT INTO public.weekly_ai_usage AS u (user_id, week_start, credits_used, fast_requests, balanced_requests, high_requests)
    VALUES (v_user_id, v_week_start, v_cost,
      CASE WHEN p_logical_mode = 'Fast' THEN 1 ELSE 0 END,
      CASE WHEN p_logical_mode = 'Balanced' THEN 1 ELSE 0 END,
      CASE WHEN p_logical_mode = 'High' THEN 1 ELSE 0 END)
    ON CONFLICT (user_id, week_start) DO UPDATE SET
      credits_used = u.credits_used + EXCLUDED.credits_used,
      fast_requests = u.fast_requests + EXCLUDED.fast_requests,
      balanced_requests = u.balanced_requests + EXCLUDED.balanced_requests,
      high_requests = u.high_requests + EXCLUDED.high_requests,
      updated_at = v_now
    WHERE u.credits_used + EXCLUDED.credits_used <= 500
    RETURNING u.* INTO v_usage;
  IF NOT FOUND THEN
    SELECT u.* INTO v_usage FROM public.weekly_ai_usage u WHERE u.user_id = v_user_id AND u.week_start = v_week_start;
    RETURN QUERY SELECT false, 0, COALESCE(v_usage.credits_used, 0), GREATEST(0, 500 - COALESCE(v_usage.credits_used, 0)), v_reset_at;
    RETURN;
  END IF;

  INSERT INTO public.weekly_usage_reservations (generation_id, user_id, week_start, logical_mode, credits_charged, usage_kind)
    VALUES (p_generation_id, v_user_id, v_week_start, p_logical_mode, v_cost, v_kind);
  RETURN QUERY SELECT true, v_cost, v_usage.credits_used, GREATEST(0, 500 - v_usage.credits_used), v_reset_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.reserve_ai_spend(
  p_user_id uuid,
  p_generation_id uuid,
  p_reserved_micros bigint,
  p_user_daily_limit_micros bigint,
  p_global_hourly_limit_micros bigint
)
RETURNS TABLE(accepted boolean, reserved_micros bigint, user_remaining_micros bigint, global_remaining_micros bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_day date := (v_now AT TIME ZONE 'UTC')::date;
  v_hour timestamptz := date_trunc('hour', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_user public.ai_spend_user_daily;
  v_global public.ai_spend_global_hourly;
  v_reservation public.ai_spend_reservations;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required for AI spend writes.';
  END IF;
  IF p_user_id IS NULL OR p_generation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Spend owner and generation required.';
  END IF;
  IF p_reserved_micros IS NULL OR p_reserved_micros <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Reserved spend must be positive.';
  END IF;
  IF p_user_daily_limit_micros IS NULL OR p_user_daily_limit_micros < 0
     OR p_global_hourly_limit_micros IS NULL OR p_global_hourly_limit_micros < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Spend limits must be non-negative.';
  END IF;

  PERFORM 1 FROM public.messages m
    WHERE m.id = p_generation_id AND m.user_id = p_user_id AND m.role = 'assistant' AND m.status = 'streaming'
    FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM 1 FROM public.workbench_revision_runs r
      WHERE r.id = p_generation_id AND r.user_id = p_user_id AND r.status = 'generating'
      FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Generation unavailable.'; END IF;

  SELECT r.* INTO v_reservation FROM public.ai_spend_reservations r
    WHERE r.generation_id = p_generation_id FOR UPDATE;
  IF FOUND THEN
    IF v_reservation.user_id <> p_user_id THEN RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Generation unavailable.'; END IF;
    SELECT u.* INTO v_user FROM public.ai_spend_user_daily u WHERE u.user_id = p_user_id AND u.day_utc = v_reservation.day_utc;
    SELECT g.* INTO v_global FROM public.ai_spend_global_hourly g WHERE g.hour_utc = v_reservation.hour_utc;
    RETURN QUERY SELECT v_reservation.released_at IS NULL AND v_reservation.finalized_at IS NULL,
      CASE WHEN v_reservation.released_at IS NULL THEN v_reservation.reserved_micros ELSE 0 END,
      GREATEST(0, p_user_daily_limit_micros - COALESCE(v_user.micros_used, 0)),
      GREATEST(0, p_global_hourly_limit_micros - COALESCE(v_global.micros_used, 0));
    RETURN;
  END IF;

  IF p_user_daily_limit_micros = 0 OR p_global_hourly_limit_micros = 0 THEN
    RETURN QUERY SELECT false, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  INSERT INTO public.ai_spend_user_daily AS u (user_id, day_utc, micros_used)
    VALUES (p_user_id, v_day, p_reserved_micros)
    ON CONFLICT (user_id, day_utc) DO UPDATE SET
      micros_used = u.micros_used + EXCLUDED.micros_used,
      updated_at = v_now
    WHERE u.micros_used + EXCLUDED.micros_used <= p_user_daily_limit_micros
    RETURNING u.* INTO v_user;
  IF NOT FOUND THEN
    SELECT u.* INTO v_user FROM public.ai_spend_user_daily u WHERE u.user_id = p_user_id AND u.day_utc = v_day;
    SELECT g.* INTO v_global FROM public.ai_spend_global_hourly g WHERE g.hour_utc = v_hour;
    RETURN QUERY SELECT false, 0::bigint,
      GREATEST(0, p_user_daily_limit_micros - COALESCE(v_user.micros_used, 0)),
      GREATEST(0, p_global_hourly_limit_micros - COALESCE(v_global.micros_used, 0));
    RETURN;
  END IF;

  INSERT INTO public.ai_spend_global_hourly AS g (hour_utc, micros_used)
    VALUES (v_hour, p_reserved_micros)
    ON CONFLICT (hour_utc) DO UPDATE SET
      micros_used = g.micros_used + EXCLUDED.micros_used,
      updated_at = v_now
    WHERE g.micros_used + EXCLUDED.micros_used <= p_global_hourly_limit_micros
    RETURNING g.* INTO v_global;
  IF NOT FOUND THEN
    UPDATE public.ai_spend_user_daily AS u SET
      micros_used = u.micros_used - p_reserved_micros,
      updated_at = v_now
      WHERE u.user_id = p_user_id AND u.day_utc = v_day AND u.micros_used >= p_reserved_micros;
    SELECT u.* INTO v_user FROM public.ai_spend_user_daily u WHERE u.user_id = p_user_id AND u.day_utc = v_day;
    SELECT g.* INTO v_global FROM public.ai_spend_global_hourly g WHERE g.hour_utc = v_hour;
    RETURN QUERY SELECT false, 0::bigint,
      GREATEST(0, p_user_daily_limit_micros - COALESCE(v_user.micros_used, 0)),
      GREATEST(0, p_global_hourly_limit_micros - COALESCE(v_global.micros_used, 0));
    RETURN;
  END IF;

  INSERT INTO public.ai_spend_reservations (generation_id, user_id, day_utc, hour_utc, reserved_micros)
    VALUES (p_generation_id, p_user_id, v_day, v_hour, p_reserved_micros);
  RETURN QUERY SELECT true, p_reserved_micros,
    GREATEST(0, p_user_daily_limit_micros - v_user.micros_used),
    GREATEST(0, p_global_hourly_limit_micros - v_global.micros_used);
END;
$$;--> statement-breakpoint
