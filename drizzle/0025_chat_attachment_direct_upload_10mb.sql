-- Chat attachments: raise per-file limit to 10 MB / combined total to 20 MB, and add transient
-- direct-to-storage staging (upload-init → TUS signed upload → finalize/extract → delete) so
-- uploads bypass the Vercel Function ≈4.5 MB request-body limit. Durable store remains extracted text only.
-- Keep as 0025 while Chat Roles #69 is open with its own 0025; renumber to 0026 after #69 merges.

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

CREATE TABLE "attachment_upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"declared_size" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_upload_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "attachment_upload_sessions_name_length" CHECK (char_length("attachment_upload_sessions"."original_name") between 1 and 120 and "attachment_upload_sessions"."original_name" = btrim("attachment_upload_sessions"."original_name")),
	CONSTRAINT "attachment_upload_sessions_mime_allowlist" CHECK ("attachment_upload_sessions"."mime_type" in ('text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf', 'text/x-typescript', 'text/javascript', 'text/x-python', 'text/x-java', 'text/x-go', 'text/x-rust', 'application/sql', 'text/html', 'text/css', 'application/yaml', 'application/xml')),
	CONSTRAINT "attachment_upload_sessions_size_bounds" CHECK ("attachment_upload_sessions"."declared_size" between 1 and 10485760),
	CONSTRAINT "attachment_upload_sessions_owner_path" CHECK ("attachment_upload_sessions"."storage_path" like ("attachment_upload_sessions"."user_id")::text || '/%')
);--> statement-breakpoint
CREATE INDEX "attachment_upload_sessions_user_expires_idx" ON "attachment_upload_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
ALTER TABLE public.attachment_upload_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.attachment_upload_sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY attachment_upload_sessions_select_own ON public.attachment_upload_sessions FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY attachment_upload_sessions_insert_own ON public.attachment_upload_sessions FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY attachment_upload_sessions_delete_own ON public.attachment_upload_sessions FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.attachment_upload_sessions TO authenticated;--> statement-breakpoint

DO $chat_attachment_staging$
BEGIN
	IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
		RETURN;
	END IF;
	INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
	VALUES (
		'chat-attachment-staging',
		'chat-attachment-staging',
		false,
		10485760,
		ARRAY[
			'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf',
			'text/x-typescript', 'text/javascript', 'text/x-python', 'text/x-java', 'text/x-go',
			'text/x-rust', 'application/sql', 'text/html', 'text/css', 'application/yaml', 'application/xml'
		]::text[]
	)
	ON CONFLICT (id) DO UPDATE
		SET public = false,
			file_size_limit = EXCLUDED.file_size_limit,
			allowed_mime_types = EXCLUDED.allowed_mime_types;
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'chat_attachment_staging_select') THEN
		CREATE POLICY chat_attachment_staging_select ON storage.objects FOR SELECT TO authenticated
			USING (bucket_id = 'chat-attachment-staging' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'chat_attachment_staging_insert') THEN
		CREATE POLICY chat_attachment_staging_insert ON storage.objects FOR INSERT TO authenticated
			WITH CHECK (bucket_id = 'chat-attachment-staging' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'chat_attachment_staging_delete') THEN
		CREATE POLICY chat_attachment_staging_delete ON storage.objects FOR DELETE TO authenticated
			USING (bucket_id = 'chat-attachment-staging' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
	END IF;
END
$chat_attachment_staging$;--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
