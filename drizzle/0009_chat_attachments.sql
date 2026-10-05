-- Chat attachments V1. Text extracted from a file the owner attached to one of their own messages. Not room knowledge,
-- not shared across threads, and no stored copy of the original file.

CREATE TABLE "message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"extracted_text" text NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"page_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_attachments_link_pair" CHECK (("message_attachments"."conversation_id" IS NULL) = ("message_attachments"."message_id" IS NULL)),
	CONSTRAINT "message_attachments_name_length" CHECK (char_length("message_attachments"."original_name") between 1 and 120 and "message_attachments"."original_name" = btrim("message_attachments"."original_name")),
	CONSTRAINT "message_attachments_mime_allowlist" CHECK ("message_attachments"."mime_type" in ('text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf', 'text/x-typescript', 'text/javascript', 'text/x-python', 'text/x-java', 'text/x-go', 'text/x-rust', 'application/sql', 'text/html', 'text/css', 'application/yaml', 'application/xml')),
	CONSTRAINT "message_attachments_size_bounds" CHECK ("message_attachments"."size_bytes" between 1 and 4194304),
	CONSTRAINT "message_attachments_text_bounds" CHECK (char_length("message_attachments"."extracted_text") between 1 and 24000),
	CONSTRAINT "message_attachments_page_bounds" CHECK ("message_attachments"."page_count" IS NULL OR "message_attachments"."page_count" between 1 and 100000)
);
--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_owner_fk" FOREIGN KEY ("message_id","conversation_id","user_id") REFERENCES "public"."messages"("id","conversation_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_attachments_message_idx" ON "message_attachments" USING btree ("conversation_id","message_id");--> statement-breakpoint
CREATE INDEX "message_attachments_draft_idx" ON "message_attachments" USING btree ("user_id","created_at") WHERE "message_attachments"."message_id" IS NULL;--> statement-breakpoint
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.message_attachments FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY message_attachments_select_own ON public.message_attachments FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
-- A new attachment is always an unlinked draft of its owner.
CREATE POLICY message_attachments_insert_own ON public.message_attachments FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND conversation_id IS NULL AND message_id IS NULL);--> statement-breakpoint
-- Only a draft can be linked, only once, and never unlinked. The composite key above ties it to the owner's own message.
CREATE POLICY message_attachments_link_own ON public.message_attachments FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND message_id IS NULL)
  WITH CHECK (user_id = (SELECT auth.uid()) AND message_id IS NOT NULL);--> statement-breakpoint
-- Removing a sent attachment happens only through its message or conversation being deleted.
CREATE POLICY message_attachments_delete_draft ON public.message_attachments FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND message_id IS NULL);--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.message_attachments TO authenticated;--> statement-breakpoint
GRANT UPDATE (conversation_id, message_id) ON public.message_attachments TO authenticated;--> statement-breakpoint
-- Saves a user message and links its draft attachments in one transaction: either both are saved or neither is.
-- A retry with the same message id succeeds only when that message already carries exactly the same attachments.
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
  IF v_total > 8388608 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT413', MESSAGE = 'Attachments are too large together.';
  END IF;
  RETURN QUERY SELECT v_saved.id, v_saved.position;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.append_user_message_with_attachments(uuid, uuid, text, uuid[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.append_user_message_with_attachments(uuid, uuid, text, uuid[]) TO authenticated;
