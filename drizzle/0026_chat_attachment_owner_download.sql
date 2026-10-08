-- Chat attachments: keep original bytes in a durable private Storage bucket so the owner can
-- download a sent file from the message chip. Staging (0025) remains ephemeral; durable path is
-- message_attachments.storage_path → chat-attachments/{user_id}/attachments/{id}/…

ALTER TABLE "message_attachments" ADD COLUMN "storage_path" text;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_storage_path_key" UNIQUE("storage_path");--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_owner_path" CHECK ("message_attachments"."storage_path" IS NULL OR "message_attachments"."storage_path" like ("message_attachments"."user_id")::text || '/attachments/' || ("message_attachments"."id")::text || '/%');--> statement-breakpoint

DO $chat_attachments_durable$
BEGIN
	IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
		RETURN;
	END IF;
	INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
	VALUES (
		'chat-attachments',
		'chat-attachments',
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
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'chat_attachments_select') THEN
		CREATE POLICY chat_attachments_select ON storage.objects FOR SELECT TO authenticated
			USING (bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'chat_attachments_insert') THEN
		CREATE POLICY chat_attachments_insert ON storage.objects FOR INSERT TO authenticated
			WITH CHECK (bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'chat_attachments_delete') THEN
		CREATE POLICY chat_attachments_delete ON storage.objects FOR DELETE TO authenticated
			USING (bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
	END IF;
END
$chat_attachments_durable$;--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
