CREATE TYPE "public"."weekly_usage_mode" AS ENUM('Fast', 'Balanced', 'High');--> statement-breakpoint
CREATE TABLE "weekly_ai_usage" (
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"fast_requests" integer DEFAULT 0 NOT NULL,
	"balanced_requests" integer DEFAULT 0 NOT NULL,
	"high_requests" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_ai_usage_user_week_key" UNIQUE("user_id","week_start"),
	CONSTRAINT "weekly_ai_usage_credits_nonnegative" CHECK ("weekly_ai_usage"."credits_used" between 0 and 100),
	CONSTRAINT "weekly_ai_usage_fast_nonnegative" CHECK ("weekly_ai_usage"."fast_requests" >= 0),
	CONSTRAINT "weekly_ai_usage_balanced_nonnegative" CHECK ("weekly_ai_usage"."balanced_requests" >= 0),
	CONSTRAINT "weekly_ai_usage_high_nonnegative" CHECK ("weekly_ai_usage"."high_requests" >= 0)
);
--> statement-breakpoint
CREATE TABLE "weekly_usage_reservations" (
	"generation_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"logical_mode" "weekly_usage_mode" NOT NULL,
	"credits_charged" integer NOT NULL,
	"released_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_usage_reservations_credits_positive" CHECK ("weekly_usage_reservations"."credits_charged" > 0)
);
--> statement-breakpoint
ALTER TABLE "weekly_ai_usage" ADD CONSTRAINT "weekly_ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_usage_reservations" ADD CONSTRAINT "weekly_usage_reservations_generation_id_messages_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_usage_reservations" ADD CONSTRAINT "weekly_usage_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weekly_usage_reservations_user_week_idx" ON "weekly_usage_reservations" USING btree ("user_id","week_start");--> statement-breakpoint

ALTER TABLE public.weekly_ai_usage ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.weekly_ai_usage FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY weekly_ai_usage_select_own ON public.weekly_ai_usage FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
ALTER TABLE public.weekly_usage_reservations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.weekly_usage_reservations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.weekly_ai_usage, public.weekly_usage_reservations FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT ON public.weekly_ai_usage TO authenticated;--> statement-breakpoint

-- These narrowly scoped definer RPCs are the only write path: granting authenticated direct write access would let a client
-- erase or forge its own quota. Ownership comes only from auth.uid(), all objects are schema-qualified, and search_path is empty.
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
      COALESCE(v_usage.credits_used, 0), GREATEST(0, 100 - COALESCE(v_usage.credits_used, 0)), v_reset_at;
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
    WHERE u.credits_used + EXCLUDED.credits_used <= 100
    RETURNING u.* INTO v_usage;

  IF NOT FOUND THEN
    SELECT u.* INTO v_usage FROM public.weekly_ai_usage u WHERE u.user_id = v_user_id AND u.week_start = v_week_start;
    RETURN QUERY SELECT false, 0, v_usage.credits_used, GREATEST(0, 100 - v_usage.credits_used), v_reset_at;
    RETURN;
  END IF;

  INSERT INTO public.weekly_usage_reservations (generation_id, user_id, week_start, logical_mode, credits_charged)
    VALUES (p_generation_id, v_user_id, v_week_start, p_logical_mode, v_cost);
  RETURN QUERY SELECT true, v_cost, v_usage.credits_used, GREATEST(0, 100 - v_usage.credits_used), v_reset_at;
END;
$$;--> statement-breakpoint

-- Start and release serialize on the same reservation row. A client may start early, but cannot get a free reply by releasing later.
CREATE OR REPLACE FUNCTION public.start_weekly_ai_usage(p_generation_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_reservation public.weekly_usage_reservations;
BEGIN
  IF v_user_id IS NULL OR p_generation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated generation required.';
  END IF;
  SELECT r.* INTO v_reservation FROM public.weekly_usage_reservations r
    WHERE r.generation_id = p_generation_id AND r.user_id = v_user_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.released_at IS NOT NULL THEN RETURN false; END IF;
  IF v_reservation.started_at IS NULL THEN
    UPDATE public.weekly_usage_reservations SET started_at = clock_timestamp()
      WHERE generation_id = p_generation_id AND user_id = v_user_id AND started_at IS NULL;
  END IF;
  RETURN true;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.release_weekly_ai_usage(p_generation_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_reservation public.weekly_usage_reservations;
BEGIN
  IF v_user_id IS NULL OR p_generation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated generation required.';
  END IF;
  SELECT r.* INTO v_reservation FROM public.weekly_usage_reservations r
    WHERE r.generation_id = p_generation_id AND r.user_id = v_user_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.released_at IS NOT NULL OR v_reservation.started_at IS NOT NULL THEN RETURN false; END IF;

  UPDATE public.weekly_ai_usage AS u SET
      credits_used = u.credits_used - v_reservation.credits_charged,
      fast_requests = u.fast_requests - CASE WHEN v_reservation.logical_mode = 'Fast' THEN 1 ELSE 0 END,
      balanced_requests = u.balanced_requests - CASE WHEN v_reservation.logical_mode = 'Balanced' THEN 1 ELSE 0 END,
      high_requests = u.high_requests - CASE WHEN v_reservation.logical_mode = 'High' THEN 1 ELSE 0 END,
      updated_at = clock_timestamp()
    WHERE u.user_id = v_user_id AND u.week_start = v_reservation.week_start
      AND u.credits_used >= v_reservation.credits_charged
      AND u.fast_requests >= CASE WHEN v_reservation.logical_mode = 'Fast' THEN 1 ELSE 0 END
      AND u.balanced_requests >= CASE WHEN v_reservation.logical_mode = 'Balanced' THEN 1 ELSE 0 END
      AND u.high_requests >= CASE WHEN v_reservation.logical_mode = 'High' THEN 1 ELSE 0 END;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Usage reservation accounting invariant failed.'; END IF;

  UPDATE public.weekly_usage_reservations SET released_at = clock_timestamp()
    WHERE generation_id = p_generation_id AND user_id = v_user_id AND released_at IS NULL;
  RETURN FOUND;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.get_current_weekly_ai_usage()
RETURNS TABLE(credits_used integer, credits_remaining integer, reset_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(u.credits_used, 0), GREATEST(0, 100 - COALESCE(u.credits_used, 0)),
    (date_trunc('week', now() AT TIME ZONE 'UTC')::date + 7)::timestamp AT TIME ZONE 'UTC'
  FROM (SELECT (SELECT auth.uid()) AS user_id,
    date_trunc('week', now() AT TIME ZONE 'UTC')::date AS week_start) current_week
  LEFT JOIN public.weekly_ai_usage u ON u.user_id = current_week.user_id AND u.week_start = current_week.week_start
  WHERE current_week.user_id IS NOT NULL;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.reserve_weekly_ai_usage(uuid, public.weekly_usage_mode), public.start_weekly_ai_usage(uuid), public.release_weekly_ai_usage(uuid), public.get_current_weekly_ai_usage() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.reserve_weekly_ai_usage(uuid, public.weekly_usage_mode), public.start_weekly_ai_usage(uuid), public.release_weekly_ai_usage(uuid), public.get_current_weekly_ai_usage() TO authenticated;--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
