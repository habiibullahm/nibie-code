-- Conversation-scoped Chat role and optional custom instructions (soft guidance only).
-- Additive columns inherit existing owner-only conversations RLS. Defaults preserve prior behavior.

CREATE TYPE "public"."chat_role" AS ENUM('general', 'developer', 'researcher', 'writer', 'product_lead', 'custom');
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "chat_role" "public"."chat_role" DEFAULT 'general' NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "custom_instructions" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_custom_instructions_length" CHECK (
  "custom_instructions" is null
  or (
    char_length("custom_instructions") between 1 and 2000
    and "custom_instructions" = btrim("custom_instructions")
  )
);
--> statement-breakpoint
GRANT USAGE ON TYPE "public"."chat_role" TO authenticated;
