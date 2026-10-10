-- Workbench V2.1: owner-scoped document version snapshots (manual checkpoints + AI Apply).
-- Additive only: new table + RLS. Retention pruning is application-side (bounded version count).

CREATE TABLE IF NOT EXISTS "workbench_document_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "source" text NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "document_revision" integer NOT NULL,
  "revision_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
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
