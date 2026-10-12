export type HistoryRecallIntent = {
  topic: string;
  terms: string[];
  language: "en" | "id";
  unsupportedScope: boolean;
};

// Deliberately narrow, anchored phrases. Ordinary chat and saved Memory commands
// do not grant permission to read another conversation.
const prefixes = [
  { pattern: /^(?:please\s+)?what did we (?:decide|agree)(?: previously| earlier)? (?:about|on)\s+/i, language: "en" as const },
  { pattern: /^(?:please\s+)?(?:find|search|look up|recall) (?:our |my |the )?(?:past|previous|earlier) (?:decisions?|conversations?|chats?|threads?)(?: (?:about|on|for))?\s+/i, language: "en" as const },
  { pattern: /^(?:tolong\s+)?apa (?:yang )?(?:kita|kami) (?:putuskan|sepakati)(?: sebelumnya| dulu)? (?:tentang|soal|untuk)\s+/i, language: "id" as const },
  { pattern: /^(?:tolong\s+)?(?:cari|telusuri) (?:keputusan|percakapan|obrolan|chat) (?:sebelumnya|lama|terdahulu)(?: (?:tentang|soal|untuk))?\s+/i, language: "id" as const },
];

export function detectHistoryRecallIntent(message: string): HistoryRecallIntent | null {
  const text = message.replace(/\s+/g, " ").trim();
  const prefix = prefixes.find(({ pattern }) => pattern.test(text));
  if (!prefix) return null;
  const body = text.replace(prefix.pattern, "");
  const scopedBody = body.replace(/\b(?:in|from)\s+(?:this|(?:the\s+)?current)\s+room\b|\b(?:di|dari)\s+(?:room|ruang)\s+(?:ini|saat ini)\b/gi, "");
  // V1 accepts only the current scope. Named Rooms, archives and global searches
  // need a separate explicit scope picker, never an inferred scope expansion.
  const unsupportedScope = /\b(?:all|other|another|archived|deleted)\s+(?:rooms?|chats?|threads?|conversations?)\b|\b(?:semua|lain|arsip|dihapus)\b/i.test(scopedBody)
    || /\b(?:in|from|di|dari)\s+(?:(?:my|the|our|room|ruang)\s+)?[^?.;]*\b(?:room|ruang)\b/i.test(scopedBody)
    || /\b(?:room|ruang)\s+[\p{L}\p{N}]/iu.test(scopedBody);
  const topic = scopedBody
    .split(/[?!;\n]|\.\s/, 1)[0]
    .replace(/\s+(?:in|from|di|dari)\s+(?:this|the current|current|room ini|ruang ini)\s*(?:room|thread|conversation|chat|ruang)?\s*$/i, "")
    .replace(/\s+(?:dulu|sebelumnya)\s*$/i, "")
    .trim()
    .slice(0, 100);
  // Alphanumeric tokens only: never interpolate PostgREST filter grammar or LIKE
  // wildcards from a user's request. No semantic or synonym expansion in V1.
  const terms = [...new Set(topic.toLowerCase().match(/[\p{L}\p{N}]{2,32}/gu) ?? [])].slice(0, 6);
  return { topic, terms, language: prefix.language, unsupportedScope };
}
