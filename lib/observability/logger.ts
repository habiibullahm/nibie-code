import "server-only";
import { readReleaseIdentity } from "@/lib/observability/release";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;
type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
type LogValue = string | number | boolean | null | string[];

const reservedKeys = new Set(["event", "release", "sha", "branch", "environment", "level"]);
const sensitiveKeys = new Set([
  "authorization",
  "cookie",
  "cookies",
  "setcookie",
  "password",
  "passwd",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "jwt",
  "apikey",
  "secret",
  "email",
  "prompt",
  "prompts",
  "content",
  "message",
  "messages",
  "body",
  "requestbody",
  "instructions",
  "brief",
  "pin",
  "pins",
  "profile",
  "aboutyou",
  "file",
  "files",
  "filename",
  "workbench",
  "databaseurl",
  "supabasekey",
]);

const secretText = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|bearer\s+\S+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9]{8,}/i;
const safeToken = /^[A-Za-z0-9_.:-]{1,64}$/;
const safeKey = /^[A-Za-z][A-Za-z0-9]{0,40}$/;
const safeEvent = /^[a-z][a-z0-9.]{0,80}$/;

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sanitizeValue(value: unknown): LogValue | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === null) return value;
  if (typeof value === "string") {
    if (!value || value.length > 200 || secretText.test(value)) return undefined;
    return value;
  }
  if (Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every((item) => typeof item === "string" && safeToken.test(item) && !secretText.test(item))) {
    return value;
  }
  return undefined;
}

export function sanitizeLogFields(fields: LogFields | undefined): Record<string, LogValue> {
  const safe: Record<string, LogValue> = {};
  if (!fields) return safe;
  for (const [key, value] of Object.entries(fields)) {
    if (!safeKey.test(key) || reservedKeys.has(key) || sensitiveKeys.has(normalizeKey(key))) continue;
    const cleaned = sanitizeValue(value);
    if (cleaned !== undefined) safe[key] = cleaned;
  }
  return safe;
}

export function buildLogRecord(level: LogLevel, event: string, fields?: LogFields, env: Env = process.env) {
  const identity = readReleaseIdentity(env);
  return {
    event,
    release: identity.shortSha,
    sha: identity.sha,
    branch: identity.branch,
    environment: identity.environment,
    ...sanitizeLogFields(fields),
    level,
  };
}

function emit(level: LogLevel, event: string, fields?: LogFields) {
  if (!safeEvent.test(event)) return;
  const line = JSON.stringify({ ...buildLogRecord(level, event, fields), time: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export function logInfo(event: string, fields?: LogFields) {
  emit("info", event, fields);
}

export function logWarn(event: string, fields?: LogFields) {
  emit("warn", event, fields);
}

export function logError(event: string, fields?: LogFields) {
  emit("error", event, fields);
}
