-- Files V2: widen supported metadata, retain truncation state, and add deterministic lexical chunks.
ALTER TABLE public.room_files ADD COLUMN extracted_truncated boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE public.room_files DROP CONSTRAINT room_files_mime_allowlist;--> statement-breakpoint
ALTER TABLE public.room_files ADD CONSTRAINT room_files_mime_allowlist CHECK (mime_type IN ('text/plain','text/markdown','text/csv','application/json','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/typescript','text/javascript','text/x-python','text/x-java-source','text/x-go','text/x-rust','application/sql','text/html','text/css','application/yaml','application/xml'));--> statement-breakpoint
DO $room_files_bucket$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    UPDATE storage.buckets SET public = false, file_size_limit = 5242880,
      allowed_mime_types = ARRAY['text/plain','text/markdown','text/csv','application/json','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/typescript','text/javascript','text/x-python','text/x-java-source','text/x-go','text/x-rust','application/sql','text/html','text/css','application/yaml','application/xml']::text[]
    WHERE id = 'room-files';
  END IF;
END
$room_files_bucket$;--> statement-breakpoint
CREATE TABLE public.room_file_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL,
  user_id uuid NOT NULL,
  room_id uuid NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 3000),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  CONSTRAINT room_file_chunks_file_fk FOREIGN KEY (file_id, user_id) REFERENCES public.room_files(id, user_id) ON DELETE CASCADE,
  CONSTRAINT room_file_chunks_room_owner_fk FOREIGN KEY (room_id, user_id) REFERENCES public.rooms(id, user_id) ON DELETE CASCADE,
  CONSTRAINT room_file_chunks_file_index_key UNIQUE (file_id, chunk_index)
);--> statement-breakpoint
CREATE INDEX room_file_chunks_search_idx ON public.room_file_chunks USING gin(search_vector);--> statement-breakpoint
CREATE INDEX room_file_chunks_scope_idx ON public.room_file_chunks(user_id, room_id, file_id);--> statement-breakpoint
ALTER TABLE public.room_file_chunks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.room_file_chunks FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY room_file_chunks_select_own ON public.room_file_chunks FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.room_files f WHERE f.id = file_id AND f.user_id = (SELECT auth.uid()) AND f.room_id = room_file_chunks.room_id));--> statement-breakpoint
CREATE POLICY room_file_chunks_insert_own ON public.room_file_chunks FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.room_files f WHERE f.id = file_id AND f.user_id = (SELECT auth.uid()) AND f.room_id = room_file_chunks.room_id));--> statement-breakpoint
CREATE POLICY room_file_chunks_delete_own ON public.room_file_chunks FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.room_file_chunks TO authenticated;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.search_room_file_chunks(p_room_id uuid, p_query text, p_limit integer DEFAULT 5)
RETURNS TABLE(file_id uuid, original_name text, content text, extracted_truncated boolean, chunk_index integer, rank real)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT c.file_id, f.original_name, c.content, f.extracted_truncated, c.chunk_index,
         ts_rank_cd(c.search_vector, websearch_to_tsquery('simple', left(p_query, 2000))) AS rank
  FROM public.room_file_chunks c JOIN public.room_files f ON f.id = c.file_id AND f.user_id = c.user_id AND f.room_id = c.room_id
  WHERE c.user_id = (SELECT auth.uid()) AND c.room_id = p_room_id
    AND f.user_id = (SELECT auth.uid()) AND f.room_id = p_room_id
    AND c.search_vector @@ websearch_to_tsquery('simple', left(p_query, 2000))
  ORDER BY rank DESC, c.file_id, c.chunk_index
  LIMIT least(greatest(p_limit, 0), 5)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.search_room_file_chunks(uuid, text, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.search_room_file_chunks(uuid, text, integer) TO authenticated;
