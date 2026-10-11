-- Workbench V2.1: owner-scoped document version snapshots (manual checkpoints + AI Apply).
-- Additive only: new table + RLS. Atomic document writes and database-enforced retention (50 versions/document).

CREATE TABLE IF NOT EXISTS "workbench_document_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "source" text NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "document_revision" integer NOT NULL,
  "revision_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT "workbench_document_versions_source_check" CHECK ("source" IN ('manual', 'ai')),
  CONSTRAINT "workbench_document_versions_title_length" CHECK (char_length("title") between 1 and 120 and "title" = btrim("title")),
  CONSTRAINT "workbench_document_versions_content_length" CHECK (char_length("content") <= 100000),
  CONSTRAINT "workbench_document_versions_document_revision_positive" CHECK ("document_revision" >= 1)
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "workbench_document_versions" ADD CONSTRAINT "workbench_document_versions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "workbench_document_versions" ADD CONSTRAINT "workbench_document_versions_document_owner_fk"
    FOREIGN KEY ("document_id", "user_id") REFERENCES "public"."workbench_documents"("id", "user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "workbench_document_versions" ADD CONSTRAINT "workbench_document_versions_revision_run_fk"
    FOREIGN KEY ("revision_run_id") REFERENCES "public"."workbench_revision_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "workbench_document_versions_document_created_idx"
  ON "workbench_document_versions" USING btree ("document_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workbench_document_versions_user_created_idx"
  ON "workbench_document_versions" USING btree ("user_id", "created_at");--> statement-breakpoint

ALTER TABLE "workbench_document_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workbench_document_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS "workbench_document_versions_select_own" ON "workbench_document_versions";--> statement-breakpoint
CREATE POLICY "workbench_document_versions_select_own" ON "workbench_document_versions"
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
DROP POLICY IF EXISTS "workbench_document_versions_insert_own" ON "workbench_document_versions";--> statement-breakpoint
CREATE POLICY "workbench_document_versions_insert_own" ON "workbench_document_versions"
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
DROP POLICY IF EXISTS "workbench_document_versions_update_own" ON "workbench_document_versions";--> statement-breakpoint
CREATE POLICY "workbench_document_versions_update_own" ON "workbench_document_versions"
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
DROP POLICY IF EXISTS "workbench_document_versions_delete_own" ON "workbench_document_versions";--> statement-breakpoint
CREATE POLICY "workbench_document_versions_delete_own" ON "workbench_document_versions"
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "workbench_document_versions" TO authenticated;

--> statement-breakpoint
-- Serialize every snapshot write on its document, including direct authenticated inserts.
-- Database retention cannot be skipped by an application failure or concurrent checkpoint.
CREATE OR REPLACE FUNCTION public.guard_workbench_version_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- FK ON DELETE SET NULL may clear a run during document cascade deletion.
  IF TG_OP = 'UPDATE' AND NEW.revision_run_id IS NULL AND OLD.revision_run_id IS NOT NULL
     AND (to_jsonb(NEW) - 'revision_run_id') = (to_jsonb(OLD) - 'revision_run_id') THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.workbench_documents
    WHERE id = NEW.document_id AND user_id = NEW.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Document unavailable.';
  END IF;
  IF NEW.revision_run_id IS NOT NULL THEN
    PERFORM 1 FROM public.workbench_revision_runs
      WHERE id = NEW.revision_run_id AND document_id = NEW.document_id AND user_id = NEW.user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Suggestion unavailable.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER workbench_version_write_guard BEFORE INSERT OR UPDATE ON public.workbench_document_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_workbench_version_write();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.prune_workbench_versions()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.workbench_document_versions
    WHERE id IN (
      SELECT id FROM public.workbench_document_versions
      WHERE document_id = NEW.document_id AND user_id = NEW.user_id
      ORDER BY created_at DESC, id DESC OFFSET 50
    );
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER workbench_version_retention AFTER INSERT OR UPDATE ON public.workbench_document_versions
  FOR EACH ROW EXECUTE FUNCTION public.prune_workbench_versions();--> statement-breakpoint

-- One transaction owns revision validation, recovery snapshot, write, and retention.
-- A failure anywhere rolls back both snapshots and document changes.
CREATE OR REPLACE FUNCTION public.commit_workbench_version(
  p_document_id uuid,
  p_expected_revision integer,
  p_version_id uuid DEFAULT NULL,
  p_revision_run_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_content text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_document public.workbench_documents;
  v_target public.workbench_document_versions;
  v_snapshot public.workbench_document_versions;
  v_run public.workbench_revision_runs;
  v_title text;
  v_content text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required.';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 1 OR
     (p_version_id IS NOT NULL AND p_revision_run_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid version request.';
  END IF;
  SELECT * INTO v_document FROM public.workbench_documents
    WHERE id = p_document_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Document unavailable.'; END IF;
  IF v_document.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Document changed elsewhere.';
  END IF;

  IF p_version_id IS NOT NULL THEN
    SELECT * INTO v_target FROM public.workbench_document_versions
      WHERE id = p_version_id AND document_id = p_document_id AND user_id = v_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Version unavailable.'; END IF;
    v_title := v_target.title;
    v_content := v_target.content;
    IF v_title = v_document.title AND v_content = v_document.content THEN
      RETURN jsonb_build_object('document', to_jsonb(v_document));
    END IF;
  ELSIF p_revision_run_id IS NOT NULL THEN
    SELECT * INTO v_run FROM public.workbench_revision_runs
      WHERE id = p_revision_run_id AND document_id = p_document_id AND user_id = v_user_id FOR UPDATE;
    IF NOT FOUND OR v_run.status <> 'complete' OR v_run.proposed_content IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Suggestion unavailable.';
    END IF;
    IF v_run.base_revision <> p_expected_revision THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Document changed elsewhere.';
    END IF;
    v_title := coalesce(v_run.proposed_title, v_document.title);
    v_content := v_run.proposed_content;
    IF p_title IS DISTINCT FROM v_title OR p_content IS DISTINCT FROM v_content THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Suggestion is incomplete.';
    END IF;
  END IF;

  SELECT * INTO v_snapshot FROM public.workbench_document_versions
    WHERE document_id = p_document_id AND user_id = v_user_id
    ORDER BY created_at DESC, id DESC LIMIT 1;
  IF NOT FOUND OR v_snapshot.title <> v_document.title OR v_snapshot.content <> v_document.content THEN
    INSERT INTO public.workbench_document_versions
      (user_id, document_id, source, title, content, document_revision)
      VALUES (v_user_id, p_document_id, 'manual', v_document.title, v_document.content, v_document.revision)
      RETURNING * INTO v_snapshot;
  END IF;

  IF p_version_id IS NOT NULL OR p_revision_run_id IS NOT NULL THEN
    UPDATE public.workbench_documents SET title = v_title, content = v_content,
      revision = revision + 1 WHERE id = p_document_id AND user_id = v_user_id
      RETURNING * INTO v_document;
    IF p_revision_run_id IS NOT NULL THEN
      INSERT INTO public.workbench_document_versions
        (user_id, document_id, source, title, content, document_revision, revision_run_id)
        VALUES (v_user_id, p_document_id, 'ai', v_document.title, v_document.content,
          v_document.revision, p_revision_run_id)
        RETURNING * INTO v_snapshot;
    END IF;
  END IF;
  RETURN jsonb_build_object('document', to_jsonb(v_document), 'version', to_jsonb(v_snapshot));
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commit_workbench_version(uuid, integer, uuid, uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commit_workbench_version(uuid, integer, uuid, uuid, text, text) TO authenticated;
