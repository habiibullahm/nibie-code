-- Conversation-scoped custom instructions (soft guidance only).
-- Additive column inherits existing owner-only conversations RLS. Null means no extra guidance.

ALTER TABLE "conversations" ADD COLUMN "custom_instructions" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_custom_instructions_length" CHECK (
  "custom_instructions" is null
  or (
    char_length("custom_instructions") between 1 and 2000
    and "custom_instructions" = btrim("custom_instructions")
  )
);
