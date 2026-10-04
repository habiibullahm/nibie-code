-- Workbench V1. A document may keep a null room_id. Deleting a room detaches the document; it does not delete it.
-- Nulls only room_id. A plain SET NULL on this composite key would also clear user_id.

CREATE TABLE "workbench_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"room_id" uuid,
	"title" text DEFAULT 'Untitled' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workbench_documents_title_length" CHECK (char_length("workbench_documents"."title") between 1 and 120 and "workbench_documents"."title" = btrim("workbench_documents"."title")),
	CONSTRAINT "workbench_documents_content_length" CHECK (char_length("workbench_documents"."content") <= 100000)
);
--> statement-breakpoint
ALTER TABLE "workbench_documents" ADD CONSTRAINT "workbench_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench_documents" ADD CONSTRAINT "workbench_documents_room_owner_fk" FOREIGN KEY ("room_id","user_id") REFERENCES "public"."rooms"("id","user_id") ON DELETE SET NULL ("room_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workbench_documents_user_updated_idx" ON "workbench_documents" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "workbench_documents_user_room_idx" ON "workbench_documents" USING btree ("user_id","room_id");--> statement-breakpoint
ALTER TABLE public.workbench_documents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.workbench_documents FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workbench_documents_select_own ON public.workbench_documents FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY workbench_documents_insert_own ON public.workbench_documents FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY workbench_documents_update_own ON public.workbench_documents FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY workbench_documents_delete_own ON public.workbench_documents FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workbench_documents TO authenticated;--> statement-breakpoint
CREATE TRIGGER workbench_documents_set_updated_at BEFORE UPDATE ON public.workbench_documents FOR EACH ROW EXECUTE FUNCTION public.set_rooms_updated_at();
