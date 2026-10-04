-- Pins V1. A pin is a small user-owned fact kept on purpose inside one room.
-- Deleting the room deletes its pins. Threads stay, and become general threads, so they stop receiving those pins.

CREATE TABLE "pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pins_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "pins_title_length" CHECK (char_length("pins"."title") between 1 and 80 and "pins"."title" = btrim("pins"."title")),
	CONSTRAINT "pins_content_length" CHECK (char_length("pins"."content") between 1 and 1000 and "pins"."content" = btrim("pins"."content"))
);
--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_room_owner_fk" FOREIGN KEY ("room_id","user_id") REFERENCES "public"."rooms"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pins_room_updated_idx" ON "pins" USING btree ("room_id","updated_at","id");--> statement-breakpoint
ALTER TABLE public.pins ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.pins FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY pins_select_own ON public.pins FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY pins_insert_own ON public.pins FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY pins_update_own ON public.pins FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY pins_delete_own ON public.pins FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pins TO authenticated;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_pins_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN NEW.updated_at = pg_catalog.clock_timestamp(); RETURN NEW; END; $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.set_pins_updated_at() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.set_pins_updated_at() TO authenticated;--> statement-breakpoint
CREATE TRIGGER pins_set_updated_at BEFORE UPDATE ON public.pins FOR EACH ROW EXECUTE FUNCTION public.set_pins_updated_at();
