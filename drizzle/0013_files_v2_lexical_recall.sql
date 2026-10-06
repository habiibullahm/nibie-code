-- Improve natural-language lexical recall and backfill chunks for existing room_files.
CREATE OR REPLACE FUNCTION public.room_file_lexical_tsquery(p_query text)
RETURNS tsquery
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  terms text[];
  joined text;
BEGIN
  SELECT coalesce(array_agg(term ORDER BY ord), ARRAY[]::text[])
  INTO terms
  FROM (
    SELECT lower(match[1]) AS term, min(ord) AS ord
    FROM regexp_matches(left(coalesce(p_query, ''), 2000), '[A-Za-z0-9][A-Za-z0-9_-]{2,}', 'g') WITH ORDINALITY AS token(match, ord)
    WHERE lower(match[1]) NOT IN (
      'the','and','or','but','if','then','so','as','at','by','for','from','in','into','of','on','to','with','about','than',
      'is','are','was','were','be','been','being','am',
      'do','does','did','doing','done',
      'have','has','had','having',
      'what','which','who','whom','whose','where','when','why','how',
      'this','that','these','those','there','here',
      'i','me','my','we','our','ours','you','your','yours','it','its','they','them','their','theirs',
      'can','could','should','would','will','shall','may','might','must',
      'just','also','any','all','each','few','more','most','other','some','such','no','not','only','own','same','too','very',
      'please','tell','give','explain','describe','show','list','get','make','need','want','know','think','like','use','using','used'
    )
    GROUP BY lower(match[1])
    ORDER BY min(ord)
    LIMIT 16
  ) filtered;

  IF terms IS NULL OR cardinality(terms) = 0 THEN
    RETURN NULL;
  END IF;

  joined := array_to_string(
    ARRAY(
      SELECT regexp_replace(term, '([\\|&!():*<->])', '\\\1', 'g')
      FROM unnest(terms) AS term
    ),
    ' | '
  );
  RETURN to_tsquery('simple', joined);
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.search_room_file_chunks(p_room_id uuid, p_query text, p_limit integer DEFAULT 5)
RETURNS TABLE(file_id uuid, original_name text, content text, extracted_truncated boolean, chunk_index integer, rank real)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH q AS (
    SELECT public.room_file_lexical_tsquery(p_query) AS query
  )
  SELECT c.file_id, f.original_name, c.content, f.extracted_truncated, c.chunk_index,
         ts_rank_cd(c.search_vector, q.query) AS rank
  FROM q
  JOIN public.room_file_chunks c ON true
  JOIN public.room_files f ON f.id = c.file_id AND f.user_id = c.user_id AND f.room_id = c.room_id
  WHERE q.query IS NOT NULL
    AND c.user_id = (SELECT auth.uid()) AND c.room_id = p_room_id
    AND f.user_id = (SELECT auth.uid()) AND f.room_id = p_room_id
    AND c.search_vector @@ q.query
  ORDER BY rank DESC, c.file_id, c.chunk_index
  LIMIT least(greatest(p_limit, 0), 5)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.room_file_lexical_tsquery(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.room_file_lexical_tsquery(text) TO authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.search_room_file_chunks(uuid, text, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.search_room_file_chunks(uuid, text, integer) TO authenticated;--> statement-breakpoint
-- Deterministic chunker matching lib/files/chunks.ts sizing (2400 chars, 240 overlap).
CREATE OR REPLACE FUNCTION public.chunk_room_file_text(p_text text)
RETURNS TABLE(chunk_index integer, content text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  chunk_chars constant integer := 2400;
  overlap constant integer := 240;
  start_pos integer := 1;
  end_pos integer;
  newline_at integer;
  part text;
  idx integer := 0;
  text_len integer := char_length(coalesce(p_text, ''));
  slice_text text;
BEGIN
  IF text_len = 0 THEN
    RETURN;
  END IF;
  WHILE start_pos <= text_len LOOP
    end_pos := least(text_len, start_pos + chunk_chars - 1);
    IF end_pos < text_len AND end_pos > start_pos THEN
      slice_text := substring(p_text from start_pos for (end_pos - start_pos + 1));
      newline_at := length(slice_text) - position(E'\n' in reverse(slice_text));
      IF newline_at > 1500 THEN
        end_pos := start_pos + newline_at - 1;
      END IF;
    END IF;
    part := btrim(substring(p_text from start_pos for (end_pos - start_pos + 1)));
    IF part <> '' THEN
      IF char_length(part) > 3000 THEN
        part := left(part, 3000);
      END IF;
      chunk_index := idx;
      content := part;
      RETURN NEXT;
      idx := idx + 1;
    END IF;
    EXIT WHEN end_pos >= text_len;
    start_pos := greatest(start_pos + 1, end_pos - overlap + 1);
  END LOOP;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.chunk_room_file_text(text) FROM PUBLIC;--> statement-breakpoint
-- Existing room_files (pre-Files V2) may have extracted_text without chunk rows. Safe to re-run.
INSERT INTO public.room_file_chunks (file_id, user_id, room_id, chunk_index, content)
SELECT f.id, f.user_id, f.room_id, c.chunk_index, c.content
FROM public.room_files f
CROSS JOIN LATERAL public.chunk_room_file_text(f.extracted_text) AS c
WHERE coalesce(btrim(f.extracted_text), '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.room_file_chunks existing WHERE existing.file_id = f.id
  )
ON CONFLICT (file_id, chunk_index) DO NOTHING;
