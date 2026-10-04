import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WorkbenchDocument, WorkbenchSummary } from "@/lib/workbench/types";
import { validateWorkbenchId } from "@/lib/workbench/validation";

const loadFailed = "Documents couldn't be loaded. Refresh to try again.";

type DocumentRow = {
  id: string;
  title: string;
  content: string;
  room_id: string | null;
  created_at: string;
  updated_at: string;
};

type SummaryRow = Omit<DocumentRow, "content">;
type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function roomNames(supabase: SupabaseClient, roomIds: string[]) {
  if (!roomIds.length) return new Map<string, string>();
  const { data, error } = await supabase.from("rooms").select("id,name").in("id", roomIds);
  if (error || !data) return new Map<string, string>();
  return new Map(data.map((room) => [room.id, room.name]));
}

export async function listWorkbenchDocuments(): Promise<{ documents: WorkbenchSummary[]; error: string | null }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("workbench_documents")
    .select("id,title,room_id,created_at,updated_at")
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true });
  if (error) return { documents: [], error: loadFailed };
  const rows = (data ?? []) as SummaryRow[];
  const names = await roomNames(supabase, [...new Set(rows.flatMap((row) => row.room_id ? [row.room_id] : []))]);
  return {
    documents: rows.map((row) => ({
      ...row,
      room_name: row.room_id ? names.get(row.room_id) ?? null : null,
    })),
    error: null,
  };
}

export async function getWorkbenchDocument(id: unknown): Promise<{ document: WorkbenchDocument | null; error: string | null }> {
  const parsed = validateWorkbenchId(id);
  if (!parsed.success) return { document: null, error: null };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("workbench_documents")
    .select("id,title,content,room_id,created_at,updated_at")
    .eq("id", parsed.data)
    .maybeSingle();
  if (error) return { document: null, error: loadFailed };
  if (!data) return { document: null, error: null };
  const row = data as DocumentRow;
  const names = await roomNames(supabase, row.room_id ? [row.room_id] : []);
  return {
    document: { ...row, room_name: row.room_id ? names.get(row.room_id) ?? null : null },
    error: null,
  };
}
