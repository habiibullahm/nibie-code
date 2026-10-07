import {
  boolean,
  check,
  customType,
  date,
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
  vector,
} from "drizzle-orm/pg-core";
import { type AnyColumn, sql } from "drizzle-orm";

export const messageRole = pgEnum("message_role", ["user", "assistant"]);
export const messageStatus = pgEnum("message_status", ["complete", "streaming", "interrupted", "error"]);
export const preferredLanguage = pgEnum("preferred_language", ["auto", "en", "id"]);
export const preferenceModel = pgEnum("preference_model", ["fast", "balanced", "reasoning"]);
export const responseLength = pgEnum("response_length", ["concise", "balanced", "detailed"]);
export const responseStyle = pgEnum("response_style", ["natural", "professional", "direct"]);
export const weeklyUsageMode = pgEnum("weekly_usage_mode", ["Fast", "Balanced", "High"]);
export const memoryType = pgEnum("memory_type", ["preference", "project", "instruction", "fact"]);
export const citationSourceKind = pgEnum("citation_source_kind", ["web", "room_file", "attachment"]);

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
    extractedTruncated: boolean("extracted_truncated").notNull().default(false),
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
    check("room_files_mime_allowlist", sql`${table.mimeType} in ('text/plain','text/markdown','text/csv','application/json','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/typescript','text/javascript','text/x-python','text/x-java-source','text/x-go','text/x-rust','application/sql','text/html','text/css','application/yaml','application/xml')`),
    check("room_files_size_bounds", sql`${table.sizeBytes} between 1 and 5242880`),
    check("room_files_text_bounds", sql`char_length(${table.extractedText}) between 1 and 24000`),
    check(
      "room_files_owner_path",
      sql`${table.storagePath} like (${table.userId})::text || '/' || (${table.roomId})::text || '/' || (${table.id})::text || '/%'`,
    ),
  ],
);

export const roomFileChunks = pgTable("room_file_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id").notNull(),
  userId: uuid("user_id").notNull(),
  roomId: uuid("room_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 512 }),
  searchVector: customType<{ data: string }>({ dataType: () => "tsvector" })("search_vector").generatedAlwaysAs(sql`to_tsvector('simple', content)`),
}, (table) => [
  unique("room_file_chunks_file_index_key").on(table.fileId, table.chunkIndex),
  foreignKey({ name: "room_file_chunks_file_fk", columns: [table.fileId, table.userId], foreignColumns: [roomFiles.id, roomFiles.userId] }).onDelete("cascade"),
  foreignKey({ name: "room_file_chunks_room_owner_fk", columns: [table.roomId, table.userId], foreignColumns: [rooms.id, rooms.userId] }).onDelete("cascade"),
  index("room_file_chunks_scope_idx").on(table.userId, table.roomId, table.fileId),
  index("room_file_chunks_search_idx").using("gin", table.searchVector),
  index("room_file_chunks_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  check("room_file_chunks_embedding_nonzero", sql`${table.embedding} IS NULL OR vector_norm(${table.embedding}) > 0`),
  check("room_file_chunks_index_check", sql`${table.chunkIndex} >= 0`),
  check("room_file_chunks_content_bounds", sql`char_length(${table.content}) between 1 and 3000`),
]);

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

const summaryFieldBounds = (column: AnyColumn) => sql`char_length(${column}) <= 3200`;

// One rolling summary per conversation. It represents messages up to covers_through_position, which only moves forward.
// Original messages are never deleted. The summary is derived, untrusted data, and is deleted with its conversation.
export const threadSummaries = pgTable(
  "thread_summaries",
  {
    conversationId: uuid("conversation_id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    objective: text("objective").notNull(),
    importantContext: text("important_context").notNull(),
    decisions: text("decisions").notNull(),
    completedWork: text("completed_work").notNull(),
    currentState: text("current_state").notNull(),
    openQuestions: text("open_questions").notNull(),
    coversThroughPosition: integer("covers_through_position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "thread_summaries_conversation_owner_fk",
      columns: [table.conversationId, table.userId],
      foreignColumns: [conversations.id, conversations.userId],
    }).onDelete("cascade"),
    index("thread_summaries_user_idx").on(table.userId),
    check("thread_summaries_coverage_positive", sql`${table.coversThroughPosition} >= 1`),
    check("thread_summaries_objective_length", summaryFieldBounds(table.objective)),
    check("thread_summaries_important_context_length", summaryFieldBounds(table.importantContext)),
    check("thread_summaries_decisions_length", summaryFieldBounds(table.decisions)),
    check("thread_summaries_completed_work_length", summaryFieldBounds(table.completedWork)),
    check("thread_summaries_current_state_length", summaryFieldBounds(table.currentState)),
    check("thread_summaries_open_questions_length", summaryFieldBounds(table.openQuestions)),
  ],
);

// Exactly-once generation-level reservation records prevent a logical provider generation from being charged twice.
export const weeklyUsageReservations = pgTable(
  "weekly_usage_reservations",
  {
    generationId: uuid("generation_id").primaryKey().references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "date" }).notNull(),
    logicalMode: weeklyUsageMode("logical_mode").notNull(),
    creditsCharged: integer("credits_charged").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true, mode: "date" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("weekly_usage_reservations_user_week_idx").on(table.userId, table.weekStart),
    check("weekly_usage_reservations_credits_positive", sql`${table.creditsCharged} > 0`),
  ],
);

// Per-user weekly totals. Database functions own reservation/release writes; users can only read their row through RLS.
export const weeklyAiUsage = pgTable(
  "weekly_ai_usage",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "date" }).notNull(),
    creditsUsed: integer("credits_used").notNull().default(0),
    fastRequests: integer("fast_requests").notNull().default(0),
    balancedRequests: integer("balanced_requests").notNull().default(0),
    highRequests: integer("high_requests").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("weekly_ai_usage_user_week_key").on(table.userId, table.weekStart),
    check("weekly_ai_usage_credits_nonnegative", sql`${table.creditsUsed} between 0 and 100`),
    check("weekly_ai_usage_fast_nonnegative", sql`${table.fastRequests} >= 0`),
    check("weekly_ai_usage_balanced_nonnegative", sql`${table.balancedRequests} >= 0`),
    check("weekly_ai_usage_high_nonnegative", sql`${table.highRequests} >= 0`),
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
    recallEnabled: boolean("recall_enabled").notNull().default(true),
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

// Explicit cross-conversation memories. Owner-scoped; never shared across users.
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: memoryType("type").notNull(),
    content: text("content").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    sourceConversationId: uuid("source_conversation_id"),
    sourceMessageId: uuid("source_message_id"),
    isActive: boolean("is_active").notNull().default(true),
    embedding: vector("embedding", { dimensions: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("memories_id_user_id_key").on(table.id, table.userId),
    unique("memories_user_key_unique").on(table.userId, table.normalizedKey),
    index("memories_user_active_idx").on(table.userId, table.isActive),
    index("memories_user_updated_idx").on(table.userId, table.updatedAt, table.id),
    index("memories_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    // Single-column FK so conversation delete nulls only the source id (composite SET NULL would also null user_id).
    foreignKey({
      name: "memories_source_conversation_fk",
      columns: [table.sourceConversationId],
      foreignColumns: [conversations.id],
    }).onDelete("set null"),
    check("memories_content_length", sql`char_length(${table.content}) between 1 and 1000 and ${table.content} = btrim(${table.content})`),
    check("memories_normalized_key_length", sql`char_length(${table.normalizedKey}) between 1 and 200 and ${table.normalizedKey} = btrim(${table.normalizedKey})`),
    check("memories_embedding_nonzero", sql`${table.embedding} IS NULL OR vector_norm(${table.embedding}) > 0`),
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

// A chat attachment: text extracted from a file the owner attached to one of their messages.
// A draft has no conversation or message yet. Once sent, the same-owner composite key ties it to exactly one user
// message in one conversation. It is not room knowledge and is never shared with other threads.
export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id"),
    messageId: uuid("message_id"),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    extractedText: text("extracted_text").notNull(),
    truncated: boolean("truncated").notNull().default(false),
    pageCount: integer("page_count"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "message_attachments_message_owner_fk",
      columns: [table.messageId, table.conversationId, table.userId],
      foreignColumns: [messages.id, messages.conversationId, messages.userId],
    }).onDelete("cascade"),
    index("message_attachments_message_idx").on(table.conversationId, table.messageId),
    index("message_attachments_draft_idx").on(table.userId, table.createdAt).where(sql`${table.messageId} IS NULL`),
    check("message_attachments_link_pair", sql`(${table.conversationId} IS NULL) = (${table.messageId} IS NULL)`),
    check("message_attachments_name_length", sql`char_length(${table.originalName}) between 1 and 120 and ${table.originalName} = btrim(${table.originalName})`),
    check(
      "message_attachments_mime_allowlist",
      sql`${table.mimeType} in ('text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf', 'text/x-typescript', 'text/javascript', 'text/x-python', 'text/x-java', 'text/x-go', 'text/x-rust', 'application/sql', 'text/html', 'text/css', 'application/yaml', 'application/xml')`,
    ),
    check("message_attachments_size_bounds", sql`${table.sizeBytes} between 1 and 4194304`),
    check("message_attachments_text_bounds", sql`char_length(${table.extractedText}) between 1 and 24000`),
    check("message_attachments_page_bounds", sql`${table.pageCount} IS NULL OR ${table.pageCount} between 1 and 100000`),
  ],
);

// Citation metadata for an assistant message. Server-owned SourceReference rows so reload
// does not re-run web search. Memory is never a citation source.
export const messageSources = pgTable(
  "message_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    messageId: uuid("message_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    kind: citationSourceKind("kind").notNull(),
    handle: text("handle").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    domain: text("domain"),
    excerpt: text("excerpt"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true, mode: "date" }),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "message_sources_message_owner_fk",
      columns: [table.messageId, table.conversationId, table.userId],
      foreignColumns: [messages.id, messages.conversationId, messages.userId],
    }).onDelete("cascade"),
    unique("message_sources_message_ordinal_key").on(table.messageId, table.ordinal),
    unique("message_sources_message_handle_key").on(table.messageId, table.handle),
    index("message_sources_conversation_idx").on(table.conversationId, table.messageId),
    check("message_sources_ordinal_positive", sql`${table.ordinal} >= 1 AND ${table.ordinal} <= 20`),
    check(
      "message_sources_handle_format",
      sql`${table.handle} ~ '^(web|room_file|attachment):[1-9][0-9]*$'`,
    ),
    check(
      "message_sources_title_length",
      sql`char_length(${table.title}) between 1 and 200 and ${table.title} = btrim(${table.title})`,
    ),
    check(
      "message_sources_url_safe",
      sql`${table.url} IS NULL OR (char_length(${table.url}) between 1 and 2048 AND ${table.url} ~ '^https?://' AND position('@' in split_part(substr(${table.url}, 1, 64), '/', 3)) = 0)`,
    ),
    check(
      "message_sources_domain_length",
      sql`${table.domain} IS NULL OR (char_length(${table.domain}) between 1 and 253 AND ${table.domain} = btrim(${table.domain}))`,
    ),
    check(
      "message_sources_excerpt_length",
      sql`${table.excerpt} IS NULL OR char_length(${table.excerpt}) between 1 and 480`,
    ),
    check(
      "message_sources_source_id_length",
      sql`${table.sourceId} IS NULL OR (char_length(${table.sourceId}) between 1 and 200 AND ${table.sourceId} = btrim(${table.sourceId}))`,
    ),
    check(
      "message_sources_web_requires_url",
      sql`${table.kind} <> 'web' OR (${table.url} IS NOT NULL AND ${table.domain} IS NOT NULL)`,
    ),
  ],
);
