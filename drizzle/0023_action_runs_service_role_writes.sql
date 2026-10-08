-- Action audit writes are service-role only.
-- Ordinary authenticated clients must not EXECUTE insert/complete RPCs (browser forge path).
-- Owner association is the explicit p_user_id supplied by the trusted Action Runtime.
-- Append-only finalize unchanged: non-terminal → terminal only.

DROP FUNCTION IF EXISTS public.insert_action_run(uuid, text, text, text, text, uuid, uuid, jsonb);--> statement-breakpoint
DROP FUNCTION IF EXISTS public.complete_action_run(uuid, text, text, jsonb);--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.insert_action_run(
  p_user_id uuid,
  p_conversation_id uuid,
  p_action_id text,
  p_capability text,
  p_input_summary text,
  p_status text DEFAULT 'running',
  p_room_id uuid DEFAULT NULL,
  p_message_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS TABLE(id uuid, status text, started_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_status text;
  v_started_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required for action audit writes.';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Action run owner required.';
  END IF;
  IF p_conversation_id IS NULL OR p_action_id IS NULL OR p_capability IS NULL OR p_input_summary IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Action run arguments incomplete.';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('requested', 'running', 'waiting_for_confirmation') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Action run insert status must be non-terminal.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id AND c.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Conversation unavailable.';
  END IF;
  IF p_room_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.rooms r WHERE r.id = p_room_id AND r.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Room unavailable.';
  END IF;
  IF p_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_message_id AND m.conversation_id = p_conversation_id AND m.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Message unavailable.';
  END IF;

  INSERT INTO public.action_runs (
    user_id, room_id, conversation_id, message_id, action_id, capability, input_summary, status, metadata
  ) VALUES (
    p_user_id, p_room_id, p_conversation_id, p_message_id, p_action_id, p_capability, p_input_summary, p_status, p_metadata
  )
  RETURNING action_runs.id, action_runs.status, action_runs.started_at
    INTO v_id, v_status, v_started_at;

  id := v_id;
  status := v_status;
  started_at := v_started_at;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.complete_action_run(
  p_user_id uuid,
  p_run_id uuid,
  p_status text,
  p_error_code text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_existing public.action_runs;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required for action audit writes.';
  END IF;
  IF p_user_id IS NULL OR p_run_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Action run owner and id required.';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Action run complete status must be terminal.';
  END IF;

  SELECT r.* INTO v_existing FROM public.action_runs r
    WHERE r.id = p_run_id AND r.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Append-only finalize: refuse rewriting an already-terminal row.
  IF v_existing.status IN ('completed', 'failed', 'cancelled') THEN RETURN false; END IF;

  UPDATE public.action_runs SET
    status = p_status,
    completed_at = clock_timestamp(),
    error_code = p_error_code,
    metadata = COALESCE(p_metadata, metadata)
  WHERE id = p_run_id AND user_id = p_user_id
    AND status NOT IN ('completed', 'failed', 'cancelled');
  RETURN FOUND;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.insert_action_run(uuid, uuid, text, text, text, text, uuid, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complete_action_run(uuid, uuid, text, text, jsonb) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.insert_action_run(uuid, uuid, text, text, text, text, uuid, uuid, jsonb) FROM authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complete_action_run(uuid, uuid, text, text, jsonb) FROM authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.insert_action_run(uuid, uuid, text, text, text, text, uuid, uuid, jsonb) FROM anon;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complete_action_run(uuid, uuid, text, text, jsonb) FROM anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.insert_action_run(uuid, uuid, text, text, text, text, uuid, uuid, jsonb) TO service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.complete_action_run(uuid, uuid, text, text, jsonb) TO service_role;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
