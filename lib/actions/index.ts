export type {
  ActionCapability,
  ActionDefinition,
  ActionErrorCode,
  ActionExecutionContext,
  ActionResult,
  ActionResultItem,
  ActionRunRecord,
  ActionRunStatus,
  ActionRuntimeOutcome,
} from "@/lib/actions/types";

export {
  assertRegisteredAction,
  getAction,
  isRegisteredAction,
  listRegisteredActions,
  UnknownActionError,
} from "@/lib/actions/registry";

export { evaluateActionPermission, isMutatingCapability } from "@/lib/actions/permissions";

export {
  ACTION_TIMEOUT_MS,
  executeAction,
  MAX_ACTIONS_PER_GENERATION,
} from "@/lib/actions/runtime";

export {
  completeActionRun,
  insertActionRun,
  sanitizeActionInputSummary,
} from "@/lib/actions/audit";

export {
  ACTION_FAILED_TRUTHFULNESS_INSTRUCTION,
  ACTION_RESULT_PREFACE,
  actionSucceeded,
  fenceActionText,
  formatActionResultForModel,
} from "@/lib/actions/context";

export {
  actionRunningLabel,
  actionStatusLabel,
  actionUsedLabel,
} from "@/lib/actions/labels";

export { WEB_SEARCH_ACTION_ID } from "@/lib/actions/ids";

export {
  loadMessageActionsByConversation,
  type MessageActionView,
} from "@/lib/actions/persist";

export {
  webSearchAction,
  webSearchInputSchema,
  webSourcesFromActionResult,
} from "@/lib/actions/tools/web-search";
