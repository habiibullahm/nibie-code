export const workbenchTitleLimit = 120;
export const workbenchContentLimit = 100_000;
export const workbenchInstructionLimit = 4_000;
export const untitledWorkbenchTitle = "Untitled";
export const workbenchAutosaveMs = 800;
/** Max retained version snapshots per document (oldest pruned after insert). */
export const workbenchVersionLimit = 50;

export type WorkbenchVersionSource = "manual" | "ai";

export type WorkbenchVersionSummary = {
  id: string;
  source: WorkbenchVersionSource;
  title: string;
  document_revision: number;
  created_at: string;
};

export type WorkbenchVersion = WorkbenchVersionSummary & {
  content: string;
  revision_run_id: string | null;
};

export type WorkbenchDraft = {
  title: string;
  content: string;
};

export type WorkbenchDocument = {
  id: string;
  title: string;
  content: string;
  revision: number;
  room_id: string | null;
  room_name: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkbenchSummary = {
  id: string;
  title: string;
  room_id: string | null;
  room_name: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkbenchCreateInput = {
  title?: string;
  content?: string;
  roomId?: string | null;
};

export type WorkbenchWriteInput = WorkbenchDraft & {
  expectedRevision: number;
};
