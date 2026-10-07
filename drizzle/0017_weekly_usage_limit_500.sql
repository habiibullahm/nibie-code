-- Raise the weekly free AI usage ceiling from 100 to 500 credits.
-- Existing credits_used rows are preserved; exhausted accounts at 100 immediately have 400 remaining.
ALTER TABLE "weekly_ai_usage" DROP CONSTRAINT "weekly_ai_usage_credits_nonnegative";--> statement-breakpoint
ALTER TABLE "weekly_ai_usage" ADD CONSTRAINT "weekly_ai_usage_credits_nonnegative" CHECK ("weekly_ai_usage"."credits_used" between 0 and 500);--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.reserve_weekly_ai_usage(p_generation_id uuid, p_logical_mode public.weekly_usage_mode)
RETURNS TABLE(accepted boolean, credits_charged integer, credits_used integer, credits_remaining integer, reset_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_now timestamptz := clock_timestamp();
  v_week_start date := date_trunc('week', v_now AT TIME ZONE 'UTC')::date;
  v_reset_at timestamptz;
  v_cost integer;
  v_usage public.weekly_ai_usage;
  v_reservation public.weekly_usage_reservations;
BEGIN
  IF v_user_id IS NULL OR p_generation_id IS NULL OR p_logical_mode IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated generation required.';
  END IF;
  v_reset_at := (v_week_start + 7)::timestamp AT TIME ZONE 'UTC';
  v_cost := CASE p_logical_mode WHEN 'Fast' THEN 1 WHEN 'Balanced' THEN 3 WHEN 'High' THEN 6 END;

  -- Serialize repeat calls for this generation and ensure it is the caller's active assistant placeholder.
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

  INSERT INTO public.weekly_usage_reservations (generation_id, user_id, week_start, logical_mode, credits_charged)
    VALUES (p_generation_id, v_user_id, v_week_start, p_logical_mode, v_cost);
  RETURN QUERY SELECT true, v_cost, v_usage.credits_used, GREATEST(0, 500 - v_usage.credits_used), v_reset_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.get_current_weekly_ai_usage()
RETURNS TABLE(credits_used integer, credits_remaining integer, reset_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(u.credits_used, 0), GREATEST(0, 500 - COALESCE(u.credits_used, 0)),
    (date_trunc('week', now() AT TIME ZONE 'UTC')::date + 7)::timestamp AT TIME ZONE 'UTC'
  FROM (SELECT (SELECT auth.uid()) AS user_id,
    date_trunc('week', now() AT TIME ZONE 'UTC')::date AS week_start) current_week
  LEFT JOIN public.weekly_ai_usage u ON u.user_id = current_week.user_id AND u.week_start = current_week.week_start
  WHERE current_week.user_id IS NOT NULL;
$$;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
