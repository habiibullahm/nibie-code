export const workbenchTitleLimit = 120;
export const workbenchContentLimit = 100_000;
export const workbenchInstructionLimit = 4_000;
export const untitledWorkbenchTitle = "Untitled";
export const workbenchAutosaveMs = 800;

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
