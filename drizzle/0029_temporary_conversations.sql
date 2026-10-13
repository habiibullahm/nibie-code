-- Temporary chats: a conversation with temporary_expires_at set is hidden from history, search and past-chat recall,
-- never reads or writes Memory or thread summaries, and is deleted when its owner leaves it or at this time at the latest.
-- Additive only: one nullable column and a partial index for the expiry sweep. Existing conversations stay NULL (ordinary).

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "temporary_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_temporary_expiry_idx" ON "conversations" USING btree ("temporary_expires_at") WHERE "conversations"."temporary_expires_at" IS NOT NULL;
