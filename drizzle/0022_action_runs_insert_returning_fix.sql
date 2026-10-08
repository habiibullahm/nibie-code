-- Fix insert_action_run: RETURNING three columns INTO action_runs composite
-- previously assigned status text into user_id (uuid). Replace with scalar targets.
-- Safe to re-run on DBs that already applied 0021.

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
  v_id uuid;
  v_status text;
  v_started_at timestamptz;
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
  RETURNING action_runs.id, action_runs.status, action_runs.started_at
    INTO v_id, v_status, v_started_at;

  id := v_id;
  status := v_status;
  started_at := v_started_at;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
