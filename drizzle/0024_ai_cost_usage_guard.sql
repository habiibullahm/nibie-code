-- AI Cost & Usage Guard: research credit metering, USD spend ceilings, stale reservation reconcile.
-- Additive only. Free weekly credits remain separate from dollar spend limits.

ALTER TABLE public.weekly_usage_reservations
  ADD COLUMN IF NOT EXISTS usage_kind text NOT NULL DEFAULT 'chat';--> statement-breakpoint
ALTER TABLE public.weekly_usage_reservations
  DROP CONSTRAINT IF EXISTS weekly_usage_reservations_usage_kind_check;--> statement-breakpoint
ALTER TABLE public.weekly_usage_reservations
  ADD CONSTRAINT weekly_usage_reservations_usage_kind_check CHECK (usage_kind IN ('chat', 'research'));--> statement-breakpoint

ALTER TABLE public.message_research
  ALTER COLUMN usage_policy SET DEFAULT 'research_metered_v1';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.ai_spend_user_daily (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE cascade,
  day_utc date NOT NULL,
  micros_used bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_spend_user_daily_pk PRIMARY KEY (user_id, day_utc),
  CONSTRAINT ai_spend_user_daily_micros_nonnegative CHECK (micros_used >= 0)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.ai_spend_global_hourly (
  hour_utc timestamptz NOT NULL PRIMARY KEY,
  micros_used bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_spend_global_hourly_micros_nonnegative CHECK (micros_used >= 0)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.ai_spend_reservations (
  generation_id uuid PRIMARY KEY REFERENCES public.messages(id) ON DELETE cascade,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE cascade,
  day_utc date NOT NULL,
  hour_utc timestamptz NOT NULL,
  reserved_micros bigint NOT NULL,
  actual_micros bigint,
  released_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_spend_reservations_reserved_positive CHECK (reserved_micros > 0),
  CONSTRAINT ai_spend_reservations_actual_nonnegative CHECK (actual_micros IS NULL OR actual_micros >= 0)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ai_spend_reservations_user_day_idx ON public.ai_spend_reservations (user_id, day_utc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_spend_reservations_stale_idx ON public.ai_spend_reservations (created_at) WHERE released_at IS NULL AND finalized_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS weekly_usage_reservations_stale_idx ON public.weekly_usage_reservations (created_at) WHERE released_at IS NULL AND started_at IS NULL;--> statement-breakpoint

ALTER TABLE public.ai_spend_user_daily ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ai_spend_user_daily FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ai_spend_global_hourly ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ai_spend_global_hourly FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ai_spend_reservations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ai_spend_reservations FORCE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON public.ai_spend_user_daily, public.ai_spend_global_hourly, public.ai_spend_reservations FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- Replace chat-only reserve with usage_kind-aware costs. Research = mode + 6 multi-call overhead.
DROP FUNCTION IF EXISTS public.reserve_weekly_ai_usage(uuid, public.weekly_usage_mode);--> statement-breakpoint

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
    RETURN QUERY SELECT false, 0, v_usage.credits_used, GREATEST(0, 500 - v_usage.credits_used), v_reset_at;
    RETURN;
  END IF;

  INSERT INTO public.weekly_usage_reservations (generation_id, user_id, week_start, logical_mode, credits_charged, usage_kind)
    VALUES (p_generation_id, v_user_id, v_week_start, p_logical_mode, v_cost, v_kind);
  RETURN QUERY SELECT true, v_cost, v_usage.credits_used, GREATEST(0, 500 - v_usage.credits_used), v_reset_at;
END;
$$;--> statement-breakpoint

-- Dollar spend accounting is service_role only (same class as action audit).
-- Ordinary authenticated clients must not EXECUTE these RPCs with caller-controlled limits/amounts.
-- Owner association is the explicit p_user_id supplied by the trusted server boundary.
DROP FUNCTION IF EXISTS public.reserve_ai_spend(uuid, bigint, bigint, bigint);--> statement-breakpoint
DROP FUNCTION IF EXISTS public.finalize_ai_spend(uuid, bigint);--> statement-breakpoint
DROP FUNCTION IF EXISTS public.release_ai_spend(uuid);--> statement-breakpoint

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

  -- Zero limits fail closed: no expensive request may proceed.
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
    -- Roll back the user daily reservation that just succeeded.
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

CREATE OR REPLACE FUNCTION public.finalize_ai_spend(p_user_id uuid, p_generation_id uuid, p_actual_micros bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reservation public.ai_spend_reservations;
  v_refund bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required for AI spend writes.';
  END IF;
  IF p_user_id IS NULL OR p_generation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Spend owner and generation required.';
  END IF;
  IF p_actual_micros IS NULL OR p_actual_micros < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Actual spend must be non-negative.';
  END IF;

  SELECT r.* INTO v_reservation FROM public.ai_spend_reservations r
    WHERE r.generation_id = p_generation_id AND r.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.released_at IS NOT NULL THEN RETURN false; END IF;
  IF v_reservation.finalized_at IS NOT NULL THEN RETURN true; END IF;

  v_refund := GREATEST(0, v_reservation.reserved_micros - LEAST(p_actual_micros, v_reservation.reserved_micros));

  IF v_refund > 0 THEN
    UPDATE public.ai_spend_user_daily AS u SET
      micros_used = u.micros_used - v_refund,
      updated_at = clock_timestamp()
      WHERE u.user_id = p_user_id AND u.day_utc = v_reservation.day_utc AND u.micros_used >= v_refund;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Spend user accounting invariant failed.'; END IF;

    UPDATE public.ai_spend_global_hourly AS g SET
      micros_used = g.micros_used - v_refund,
      updated_at = clock_timestamp()
      WHERE g.hour_utc = v_reservation.hour_utc AND g.micros_used >= v_refund;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Spend global accounting invariant failed.'; END IF;
  END IF;

  UPDATE public.ai_spend_reservations SET
      actual_micros = LEAST(p_actual_micros, reserved_micros),
      finalized_at = clock_timestamp()
    WHERE generation_id = p_generation_id AND user_id = p_user_id AND finalized_at IS NULL;
  RETURN FOUND;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.release_ai_spend(p_user_id uuid, p_generation_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reservation public.ai_spend_reservations;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required for AI spend writes.';
  END IF;
  IF p_user_id IS NULL OR p_generation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Spend owner and generation required.';
  END IF;

  SELECT r.* INTO v_reservation FROM public.ai_spend_reservations r
    WHERE r.generation_id = p_generation_id AND r.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.released_at IS NOT NULL OR v_reservation.finalized_at IS NOT NULL THEN RETURN false; END IF;

  UPDATE public.ai_spend_user_daily AS u SET
      micros_used = u.micros_used - v_reservation.reserved_micros,
      updated_at = clock_timestamp()
    WHERE u.user_id = p_user_id AND u.day_utc = v_reservation.day_utc
      AND u.micros_used >= v_reservation.reserved_micros;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Spend user release invariant failed.'; END IF;

  UPDATE public.ai_spend_global_hourly AS g SET
      micros_used = g.micros_used - v_reservation.reserved_micros,
      updated_at = clock_timestamp()
    WHERE g.hour_utc = v_reservation.hour_utc
      AND g.micros_used >= v_reservation.reserved_micros;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Spend global release invariant failed.'; END IF;

  UPDATE public.ai_spend_reservations SET released_at = clock_timestamp()
    WHERE generation_id = p_generation_id AND user_id = p_user_id AND released_at IS NULL;
  RETURN FOUND;
END;
$$;--> statement-breakpoint

-- Failure-safe reconcile for crashed processes: release unstarted credit + spend holds that are terminal or stale-streaming.
CREATE OR REPLACE FUNCTION public.reconcile_stale_ai_usage(p_stale_after_seconds integer DEFAULT 900)
RETURNS TABLE(weekly_released integer, spend_released integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_weekly integer := 0;
  v_spend integer := 0;
  v_cutoff timestamptz;
  r record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required for usage reconciliation.';
  END IF;
  IF p_stale_after_seconds IS NULL OR p_stale_after_seconds < 60 OR p_stale_after_seconds > 86400 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Stale window must be between 60 and 86400 seconds.';
  END IF;
  v_cutoff := clock_timestamp() - make_interval(secs => p_stale_after_seconds);

  FOR r IN
    SELECT res.generation_id, res.user_id, res.week_start, res.logical_mode, res.credits_charged
    FROM public.weekly_usage_reservations res
    JOIN public.messages m ON m.id = res.generation_id
    WHERE res.released_at IS NULL
      AND res.started_at IS NULL
      AND res.created_at < v_cutoff
      AND (
        m.status IN ('error', 'interrupted', 'complete')
        OR m.status = 'streaming'
      )
    FOR UPDATE OF res SKIP LOCKED
  LOOP
    UPDATE public.weekly_ai_usage AS u SET
        credits_used = u.credits_used - r.credits_charged,
        fast_requests = u.fast_requests - CASE WHEN r.logical_mode = 'Fast' THEN 1 ELSE 0 END,
        balanced_requests = u.balanced_requests - CASE WHEN r.logical_mode = 'Balanced' THEN 1 ELSE 0 END,
        high_requests = u.high_requests - CASE WHEN r.logical_mode = 'High' THEN 1 ELSE 0 END,
        updated_at = clock_timestamp()
      WHERE u.user_id = r.user_id AND u.week_start = r.week_start
        AND u.credits_used >= r.credits_charged
        AND u.fast_requests >= CASE WHEN r.logical_mode = 'Fast' THEN 1 ELSE 0 END
        AND u.balanced_requests >= CASE WHEN r.logical_mode = 'Balanced' THEN 1 ELSE 0 END
        AND u.high_requests >= CASE WHEN r.logical_mode = 'High' THEN 1 ELSE 0 END;
    IF FOUND THEN
      UPDATE public.weekly_usage_reservations SET released_at = clock_timestamp()
        WHERE generation_id = r.generation_id AND released_at IS NULL AND started_at IS NULL;
      IF FOUND THEN v_weekly := v_weekly + 1; END IF;
    END IF;
  END LOOP;

  FOR r IN
    SELECT res.generation_id, res.user_id, res.day_utc, res.hour_utc, res.reserved_micros
    FROM public.ai_spend_reservations res
    JOIN public.messages m ON m.id = res.generation_id
    WHERE res.released_at IS NULL
      AND res.finalized_at IS NULL
      AND res.created_at < v_cutoff
      AND (
        m.status IN ('error', 'interrupted', 'complete')
        OR m.status = 'streaming'
      )
    FOR UPDATE OF res SKIP LOCKED
  LOOP
    UPDATE public.ai_spend_user_daily AS u SET
        micros_used = u.micros_used - r.reserved_micros,
        updated_at = clock_timestamp()
      WHERE u.user_id = r.user_id AND u.day_utc = r.day_utc AND u.micros_used >= r.reserved_micros;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.ai_spend_global_hourly AS g SET
        micros_used = g.micros_used - r.reserved_micros,
        updated_at = clock_timestamp()
      WHERE g.hour_utc = r.hour_utc AND g.micros_used >= r.reserved_micros;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.ai_spend_reservations SET released_at = clock_timestamp()
      WHERE generation_id = r.generation_id AND released_at IS NULL AND finalized_at IS NULL;
    IF FOUND THEN v_spend := v_spend + 1; END IF;
  END LOOP;

  weekly_released := v_weekly;
  spend_released := v_spend;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.reserve_weekly_ai_usage(uuid, public.weekly_usage_mode, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.reserve_weekly_ai_usage(uuid, public.weekly_usage_mode, text) TO authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reserve_ai_spend(uuid, uuid, bigint, bigint, bigint) FROM PUBLIC, authenticated, anon;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.finalize_ai_spend(uuid, uuid, bigint) FROM PUBLIC, authenticated, anon;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.release_ai_spend(uuid, uuid) FROM PUBLIC, authenticated, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.reserve_ai_spend(uuid, uuid, bigint, bigint, bigint) TO service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.finalize_ai_spend(uuid, uuid, bigint) TO service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.release_ai_spend(uuid, uuid) TO service_role;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reconcile_stale_ai_usage(integer) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.reconcile_stale_ai_usage(integer) TO service_role;--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
