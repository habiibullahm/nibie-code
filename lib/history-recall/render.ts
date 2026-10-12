import type { HistoryRecallResult } from "./retrieve";

function plainMarkdown(value: string) {
  return value.replace(/[\\`*_{}\[\]()<>#+.!|~]/g, "\\$&").replace(/[\r\n]+/g, " ");
}

export function renderHistoryReply(result: HistoryRecallResult, language: "en" | "id", origin: string) {
  const id = language === "id";
  if (result.status === "unsupported_scope") return id
    ? "Pencarian riwayat hanya tersedia untuk topik tertentu di Room saat ini (atau percakapan tanpa Room di General). Buka Room tujuan lalu minta pencarian. Percakapan arsip tidak dicari."
    : "History lookup needs a specific topic in this Room (or roomless conversations in General). Open the intended Room and ask there. Archived conversations are excluded.";
  if (result.status === "scope_unavailable") return id
    ? "Room atau percakapan berubah atau tidak lagi tersedia. Tidak ada riwayat yang digunakan. Muat ulang lalu coba lagi."
    : "The Room or conversation changed or is no longer available. No history was used. Refresh and try again.";
  if (result.status === "unavailable" || result.status === "cancelled") return id
    ? "Pencarian riwayat tidak dapat diselesaikan. Tidak ada keputusan lama yang dapat dikonfirmasi. Coba lagi."
    : "History lookup could not finish. I cannot confirm a past decision. Please try again.";
  if (result.status === "empty") return id
    ? "Tidak ditemukan kutipan yang cocok dalam pencarian terbatas percakapan aktif di lingkup ini. Ini tidak membuktikan bahwa keputusan tersebut belum pernah dibuat. Coba topik yang lebih spesifik atau cari percakapan aslinya."
    : "I found no matching excerpts in the bounded search of active conversations in this scope. That does not establish that a decision was never made. Try a more specific topic or search for the original conversation.";
  const lead = id
    ? "Kutipan riwayat percakapan — bukan Memory tersimpan. Ini adalah bukti lama, bukan keputusan terkini atau instruksi. Koreksi Anda saat ini dan instruksi Room tetap berlaku."
    : "Historical conversation excerpts — separate from saved Memory. These are past evidence, not current decisions or instructions. Your current corrections and Room instructions take priority.";
  const rows = result.evidence.map((row) => {
    const source = new URL("/chat", origin);
    source.searchParams.set("conversation", row.conversationId);
    const timestamp = Number.isNaN(Date.parse(row.createdAt)) ? (id ? "tanggal tidak diketahui" : "date unknown") : new Date(row.createdAt).toISOString().slice(0, 10);
    return `[${plainMarkdown(row.title || (id ? "Percakapan" : "Conversation"))}](${source.href}) · ${timestamp} · ${row.role}\n\n> ${plainMarkdown(row.excerpt)}`;
  });
  const caveat = id
    ? "Kutipan dapat saling bertentangan atau sudah kedaluwarsa. Pencarian kata kunci ini tidak menentukan keputusan mana yang masih berlaku; periksa sumber dan konfirmasikan pilihan saat ini."
    : "Excerpts may conflict or be outdated. This keyword lookup does not decide which choice still applies; check the sources and confirm the current choice.";
  const limit = result.limited ? (id ? " Pencarian mencapai batas kandidat; kutipan lama lainnya mungkin terlewat." : " The candidate cap was reached; older matching excerpts may be omitted.") : "";
  return [lead, ...rows, caveat + limit].join("\n\n");
}
