-- Server-controlled action_runs writes. Authenticated clients may SELECT own rows only.
-- Insert and finalize go through SECURITY DEFINER RPCs used by the trusted backend (user JWT).
-- Append-only: no client UPDATE/DELETE; complete_action_run only moves non-terminal → terminal.

DROP POLICY IF EXISTS action_runs_insert_own ON public.action_runs;--> statement-breakpoint
DROP POLICY IF EXISTS action_runs_update_own ON public.action_runs;--> statement-breakpoint
DROP POLICY IF EXISTS action_runs_delete_own ON public.action_runs;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON public.action_runs FROM authenticated;--> statement-breakpoint
-- SELECT grant + action_runs_select_own policy remain.

CREATE OR REPLACE FUNCTION public.insert_action_run(
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
  v_user_id uuid := (SELECT auth.uid());
  v_row public.action_runs;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated action run required.';
  END IF;
  IF p_conversation_id IS NULL OR p_action_id IS NULL OR p_capability IS NULL OR p_input_summary IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Action run arguments incomplete.';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('requested', 'running', 'waiting_for_confirmation') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Action run insert status must be non-terminal.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id AND c.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Conversation unavailable.';
  END IF;
  IF p_room_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.rooms r WHERE r.id = p_room_id AND r.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Room unavailable.';
  END IF;
  IF p_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_message_id AND m.conversation_id = p_conversation_id AND m.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Message unavailable.';
  END IF;

  INSERT INTO public.action_runs (
    user_id, room_id, conversation_id, message_id, action_id, capability, input_summary, status, metadata
  ) VALUES (
    v_user_id, p_room_id, p_conversation_id, p_message_id, p_action_id, p_capability, p_input_summary, p_status, p_metadata
  )
  RETURNING action_runs.id, action_runs.status, action_runs.started_at INTO v_row;

  RETURN QUERY SELECT v_row.id, v_row.status, v_row.started_at;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.complete_action_run(
  p_run_id uuid,
  p_status text,
  p_error_code text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_existing public.action_runs;
BEGIN
  IF v_user_id IS NULL OR p_run_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated action run required.';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Action run complete status must be terminal.';
  END IF;

  SELECT r.* INTO v_existing FROM public.action_runs r
    WHERE r.id = p_run_id AND r.user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Append-only finalize: refuse rewriting an already-terminal row.
  IF v_existing.status IN ('completed', 'failed', 'cancelled') THEN RETURN false; END IF;

  UPDATE public.action_runs SET
    status = p_status,
    completed_at = clock_timestamp(),
    error_code = p_error_code,
    metadata = COALESCE(p_metadata, metadata)
  WHERE id = p_run_id AND user_id = v_user_id
    AND status NOT IN ('completed', 'failed', 'cancelled');
  RETURN FOUND;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.insert_action_run(uuid, text, text, text, text, uuid, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complete_action_run(uuid, text, text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.insert_action_run(uuid, text, text, text, text, uuid, uuid, jsonb) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.complete_action_run(uuid, text, text, jsonb) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
