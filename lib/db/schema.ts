import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { type AnyColumn, sql } from "drizzle-orm";

export const messageRole = pgEnum("message_role", ["user", "assistant"]);
export const messageStatus = pgEnum("message_status", ["complete", "streaming", "interrupted", "error"]);
export const preferredLanguage = pgEnum("preferred_language", ["auto", "en", "id"]);
export const preferenceModel = pgEnum("preference_model", ["fast", "balanced", "reasoning"]);
export const responseLength = pgEnum("response_length", ["concise", "balanced", "detailed"]);
export const responseStyle = pgEnum("response_style", ["natural", "professional", "direct"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

const trimmedText = (column: AnyColumn, min: number, max: number) =>
  sql`${column} is null or (char_length(${column}) between ${sql.raw(String(min))} and ${sql.raw(String(max))} and ${column} = btrim(${column}))`;

// A room is the owner's persistent working context. Threads stay valid without one.
export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    instructions: text("instructions"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("rooms_id_user_id_key").on(table.id, table.userId),
    index("rooms_user_updated_idx").on(table.userId, table.updatedAt),
    check("rooms_name_length", sql`char_length(${table.name}) between 1 and 80 and ${table.name} = btrim(${table.name})`),
    check("rooms_description_length", trimmedText(table.description, 1, 500)),
    check("rooms_instructions_length", trimmedText(table.instructions, 1, 2000)),
  ],
);

// User-owned understanding of the room. Empty sections stay null. Not inferred memory.
export const roomBriefs = pgTable(
  "room_briefs",
  {
    roomId: uuid("room_id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    goal: text("goal"),
    currentFocus: text("current_focus"),
    importantDecisions: text("important_decisions"),
    openQuestions: text("open_questions"),
    nextStep: text("next_step"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "room_briefs_room_owner_fk",
      columns: [table.roomId, table.userId],
      foreignColumns: [rooms.id, rooms.userId],
    }).onDelete("cascade"),
    check("room_briefs_goal_length", trimmedText(table.goal, 1, 500)),
    check("room_briefs_current_focus_length", trimmedText(table.currentFocus, 1, 500)),
    check("room_briefs_important_decisions_length", trimmedText(table.importantDecisions, 1, 500)),
    check("room_briefs_open_questions_length", trimmedText(table.openQuestions, 1, 500)),
    check("room_briefs_next_step_length", trimmedText(table.nextStep, 1, 500)),
  ],
);

// A pin is one user-owned fact kept on purpose inside a room. Deleting the room deletes its pins.
export const pins = pgTable(
  "pins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("pins_id_user_id_key").on(table.id, table.userId),
    index("pins_room_updated_idx").on(table.roomId, table.updatedAt, table.id),
    foreignKey({
      name: "pins_room_owner_fk",
      columns: [table.roomId, table.userId],
      foreignColumns: [rooms.id, rooms.userId],
    }).onDelete("cascade"),
    check("pins_title_length", sql`char_length(${table.title}) between 1 and 80 and ${table.title} = btrim(${table.title})`),
    check("pins_content_length", sql`char_length(${table.content}) between 1 and 1000 and ${table.content} = btrim(${table.content})`),
  ],
);

// Explicit room source material. Extracted text is untrusted data, never an authorization input.
export const roomFiles = pgTable(
  "room_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storagePath: text("storage_path").notNull(),
    extractedText: text("extracted_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("room_files_id_user_id_key").on(table.id, table.userId),
    unique("room_files_storage_path_key").on(table.storagePath),
    foreignKey({
      name: "room_files_room_owner_fk",
      columns: [table.roomId, table.userId],
      foreignColumns: [rooms.id, rooms.userId],
    }).onDelete("cascade"),
    index("room_files_user_room_idx").on(table.userId, table.roomId, table.createdAt),
    check("room_files_name_length", sql`char_length(${table.originalName}) between 1 and 120 and ${table.originalName} = btrim(${table.originalName})`),
    check("room_files_mime_allowlist", sql`${table.mimeType} in ('text/plain', 'text/markdown', 'text/csv')`),
    check("room_files_size_bounds", sql`${table.sizeBytes} between 1 and 5242880`),
    check("room_files_text_bounds", sql`char_length(${table.extractedText}) between 1 and 24000`),
    check(
      "room_files_owner_path",
      sql`${table.storagePath} like (${table.userId})::text || '/' || (${table.roomId})::text || '/' || (${table.id})::text || '/%'`,
    ),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roomId: uuid("room_id"),
    title: text("title").notNull().default("New chat"),
    selectedModel: text("selected_model").notNull().default("default"),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("conversations_user_updated_idx").on(table.userId, table.updatedAt),
    index("conversations_user_room_idx").on(table.userId, table.roomId),
    unique("conversations_id_user_id_key").on(table.id, table.userId),
    // Same-owner link. The migration nulls only room_id when the room is deleted; user_id stays.
    foreignKey({
      name: "conversations_room_owner_fk",
      columns: [table.roomId, table.userId],
      foreignColumns: [rooms.id, rooms.userId],
    }).onDelete("set null"),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull(),
    replyToMessageId: uuid("reply_to_message_id"),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    status: messageStatus("status").notNull().default("complete"),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "messages_conversation_owner_fk",
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
    }).onDelete("cascade"),
    unique("messages_conversation_position_key").on(table.conversationId, table.position),
    unique("messages_id_conversation_owner_key").on(table.id, table.conversationId, table.userId),
    unique("messages_conversation_reply_key").on(table.conversationId, table.replyToMessageId),
    foreignKey({
      name: "messages_reply_owner_fk",
      columns: [table.replyToMessageId, table.conversationId, table.userId],
      foreignColumns: [table.id, table.conversationId, table.userId],
    }),
    uniqueIndex("messages_one_active_response_idx").on(table.conversationId).where(sql`${table.role} = 'assistant' AND ${table.status} = 'streaming'`),
    index("messages_user_conversation_idx").on(table.userId, table.conversationId),
    check("messages_content_not_blank", sql`${table.content} <> ''`),
  ],
);

// Account-level defaults. One row per owner. Conversation rows keep their own selected_model.
export const userPreferences = pgTable(
  "user_preferences",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    preferredName: text("preferred_name"),
    preferredLanguage: preferredLanguage("preferred_language").notNull().default("auto"),
    defaultModel: preferenceModel("default_model").notNull().default("balanced"),
    responseLength: responseLength("response_length").notNull().default("balanced"),
    responseStyle: responseStyle("response_style").notNull().default("natural"),
    aboutYou: text("about_you"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "user_preferences_preferred_name_length",
      sql`${table.preferredName} is null or (char_length(${table.preferredName}) between 1 and 80 and ${table.preferredName} = btrim(${table.preferredName}))`,
    ),
    check(
      "user_preferences_about_you_length",
      sql`${table.aboutYou} is null or (char_length(${table.aboutYou}) between 1 and 1500 and ${table.aboutYou} = btrim(${table.aboutYou}))`,
    ),
  ],
);

// A workbench document is the owner's editable text. Room is optional.
// Deleting a room nulls only room_id; the document stays with its owner.
export const workbenchDocuments = pgTable(
  "workbench_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roomId: uuid("room_id"),
    title: text("title").notNull().default("Untitled"),
    content: text("content").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("workbench_documents_user_updated_idx").on(table.userId, table.updatedAt),
    index("workbench_documents_user_room_idx").on(table.userId, table.roomId),
    foreignKey({
      name: "workbench_documents_room_owner_fk",
      columns: [table.roomId, table.userId],
      foreignColumns: [rooms.id, rooms.userId],
    }).onDelete("set null"),
    check(
      "workbench_documents_title_length",
      sql`char_length(${table.title}) between 1 and 120 and ${table.title} = btrim(${table.title})`,
    ),
    check("workbench_documents_content_length", sql`char_length(${table.content}) <= 100000`),
  ],
);
