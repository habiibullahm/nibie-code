-- Room files V1. Text extracted from an owner-scoped room file. Not embeddings, and not retrieved automatically.

CREATE TABLE "room_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_path" text NOT NULL,
	"extracted_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_files_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "room_files_storage_path_key" UNIQUE("storage_path"),
	CONSTRAINT "room_files_name_length" CHECK (char_length("room_files"."original_name") between 1 and 120 and "room_files"."original_name" = btrim("room_files"."original_name")),
	CONSTRAINT "room_files_mime_allowlist" CHECK ("room_files"."mime_type" in ('text/plain', 'text/markdown', 'text/csv')),
	CONSTRAINT "room_files_size_bounds" CHECK ("room_files"."size_bytes" between 1 and 5242880),
	CONSTRAINT "room_files_text_bounds" CHECK (char_length("room_files"."extracted_text") between 1 and 24000),
	CONSTRAINT "room_files_owner_path" CHECK ("room_files"."storage_path" like ("room_files"."user_id")::text || '/' || ("room_files"."room_id")::text || '/' || ("room_files"."id")::text || '/%')
);
--> statement-breakpoint
ALTER TABLE "room_files" ADD CONSTRAINT "room_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_files" ADD CONSTRAINT "room_files_room_owner_fk" FOREIGN KEY ("room_id","user_id") REFERENCES "public"."rooms"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_files_user_room_idx" ON "room_files" USING btree ("user_id","room_id","created_at");--> statement-breakpoint
ALTER TABLE public.room_files ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.room_files FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY room_files_select_own ON public.room_files FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY room_files_insert_own ON public.room_files FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY room_files_delete_own ON public.room_files FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.room_files TO authenticated;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_room_files_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN NEW.updated_at = pg_catalog.clock_timestamp(); RETURN NEW; END; $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.set_room_files_updated_at() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.set_room_files_updated_at() TO authenticated;--> statement-breakpoint
CREATE TRIGGER room_files_set_updated_at BEFORE UPDATE ON public.room_files FOR EACH ROW EXECUTE FUNCTION public.set_room_files_updated_at();--> statement-breakpoint
-- Supabase Storage policies apply only when this database has the storage schema.
-- Ordinary file access still uses the signed-in user. There is no service-role path here.
DO $room_files_storage$
BEGIN
	IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
		RETURN;
	END IF;
	INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
	VALUES ('room-files', 'room-files', false, 5242880, ARRAY['text/plain', 'text/markdown', 'text/csv']::text[])
	ON CONFLICT (id) DO UPDATE
		SET public = false,
			file_size_limit = EXCLUDED.file_size_limit,
			allowed_mime_types = EXCLUDED.allowed_mime_types;
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'room_files_storage_select') THEN
		CREATE POLICY room_files_storage_select ON storage.objects FOR SELECT TO authenticated
			USING (bucket_id = 'room-files' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'room_files_storage_insert') THEN
		CREATE POLICY room_files_storage_insert ON storage.objects FOR INSERT TO authenticated
			WITH CHECK (bucket_id = 'room-files' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'room_files_storage_delete') THEN
		CREATE POLICY room_files_storage_delete ON storage.objects FOR DELETE TO authenticated
			USING (bucket_id = 'room-files' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
	END IF;
END
$room_files_storage$;
