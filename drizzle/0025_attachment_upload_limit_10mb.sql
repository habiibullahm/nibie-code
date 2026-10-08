-- Raise chat attachment per-file size from 4 MB to 10 MB, and combined message total from 8 MB to 20 MB.
ALTER TABLE "message_attachments" DROP CONSTRAINT "message_attachments_size_bounds";--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_size_bounds" CHECK ("message_attachments"."size_bytes" between 1 and 10485760);--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.append_user_message_with_attachments(p_conversation_id uuid, p_message_id uuid, p_content text, p_attachment_ids uuid[])
RETURNS TABLE(id uuid, "position" integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_existed boolean;
  v_saved record;
  v_linked integer;
  v_total bigint;
BEGIN
  IF p_attachment_ids IS NULL OR cardinality(p_attachment_ids) NOT BETWEEN 1 AND 3
    OR (SELECT count(DISTINCT a) FROM unnest(p_attachment_ids) AS a) <> cardinality(p_attachment_ids) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Invalid attachments.';
  END IF;
  v_existed := EXISTS (SELECT 1 FROM public.messages m WHERE m.id = p_message_id);
  SELECT * INTO v_saved FROM public.append_user_message(p_conversation_id, p_message_id, p_content);
  IF NOT v_existed THEN
    UPDATE public.message_attachments a SET conversation_id = p_conversation_id, message_id = p_message_id
    WHERE a.id = ANY(p_attachment_ids) AND a.user_id = (SELECT auth.uid()) AND a.message_id IS NULL;
  END IF;
  SELECT count(*), coalesce(sum(a.size_bytes), 0) INTO v_linked, v_total FROM public.message_attachments a
  WHERE a.message_id = p_message_id AND a.user_id = (SELECT auth.uid());
  IF v_linked <> cardinality(p_attachment_ids) OR EXISTS (
    SELECT 1 FROM public.message_attachments a WHERE a.message_id = p_message_id AND NOT (a.id = ANY(p_attachment_ids))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Attachment unavailable.';
  END IF;
  IF v_total > 20971520 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT413', MESSAGE = 'Attachments are too large together.';
  END IF;
  RETURN QUERY SELECT v_saved.id, v_saved.position;
END;
$$;--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
