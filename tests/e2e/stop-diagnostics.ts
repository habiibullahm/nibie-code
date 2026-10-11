import { test as base, expect, type Page, type Request } from "@playwright/test";
import { writeFile } from "node:fs/promises";

type Metadata = Record<string, string | number | boolean | null>;
type TimelineEntry = { at: number; kind: string; metadata: Metadata };

declare global {
  interface Window {
    recordStopDiagnostic: (kind: string, metadata: Metadata) => Promise<void>;
  }
}

export function createStopDiagnostics(page: Page) {
  const timeline: TimelineEntry[] = [];
  const snapshots: { at: number; label: string; state: unknown }[] = [];
  // Keep diagnostics bounded even when a development reload/console loop occurs.
  const record = (kind: string, metadata: Metadata = {}) => {
    if (timeline.length < 256) timeline.push({ at: Date.now(), kind, metadata });
  };
  const capture = async (label: string) => {
    try {
      const snapshot = await page.evaluate(() => {
        const state = window.userStopHarness;
        const stop = document.querySelector<HTMLButtonElement>('button[aria-label="Stop response"]');
        const send = document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
        return {
          pathname: location.pathname,
          timeOrigin: performance.timeOrigin,
          readyState: document.readyState,
          visibility: document.visibilityState,
          stopVisible: Boolean(stop?.getClientRects().length),
          sendVisible: Boolean(send?.getClientRects().length),
          sendDisabled: send?.disabled ?? null,
          draftChars: document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message Nibie"]')?.value.length ?? 0,
          assistantRows: document.querySelectorAll(".message-row.assistant").length,
          partialSaves: state?.partialSaves ?? null,
          requests: state?.requests.map((request) => ({
            userMessageId: request.body.userMessageId,
            model: request.body.model,
            signalAborted: request.signal.aborted,
            abortObserved: request.aborted,
            abortReason: request.signal.reason === "user_stopped" ? "user_stopped" : request.signal.aborted ? "other" : null,
          })) ?? [],
        };
      });
      record("snapshot", { label, timeOrigin: snapshot.timeOrigin, stopVisible: snapshot.stopVisible, requestCount: snapshot.requests.length });
      if (snapshots.length < 32) snapshots.push({ at: Date.now(), label, state: snapshot });
      return snapshot;
    } catch {
      record("snapshot-unavailable", { label, closed: page.isClosed() });
      return null;
    }
  };
  return { timeline, snapshots, record, capture };
}

export type StopDiagnostics = ReturnType<typeof createStopDiagnostics>;

export const test = base.extend<{ stopDiagnostics: StopDiagnostics }>({
  stopDiagnostics: [async ({ page }, provide, testInfo) => {
    const diagnostics = createStopDiagnostics(page);
    const { record } = diagnostics;
    const networkMetadata = (request: Request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname !== "/api/chat/stop" && !(pathname === "/preview/chat-core" && request.method() === "POST")) return null;
      return { pathname, method: request.method(), serverAction: Boolean(request.headers()["next-action"]) };
    };
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) record("navigation", { pathname: new URL(frame.url()).pathname });
    });
    page.on("pageerror", (error) => record("pageerror", { name: error.name }));
    page.on("console", (message) => {
      if (message.type() === "error" || /\[Fast Refresh\]/.test(message.text())) {
        record(message.type() === "error" ? "console-error" : "fast-refresh", { line: message.location().lineNumber ?? -1 });
      }
    });
    page.on("request", (request) => {
      const metadata = networkMetadata(request);
      if (metadata) record("request", metadata);
    });
    page.on("requestfailed", (request) => {
      const metadata = networkMetadata(request);
      if (metadata) record("requestfailed", metadata);
    });
    page.on("response", (response) => {
      const metadata = networkMetadata(response.request());
      if (metadata) record("response", { ...metadata, status: response.status() });
    });
    // Synthetic stream events use a binding so evidence survives document reloads.
    await page.exposeBinding("recordStopDiagnostic", ({ frame }, kind: string, metadata: Metadata) => {
      if (frame === page.mainFrame()) record(kind, metadata);
    });
    try {
      await provide(diagnostics);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        const finalSnapshot = await diagnostics.capture("failure");
        const path = testInfo.outputPath("stop-diagnostics.json");
        await writeFile(path, JSON.stringify({ retry: testInfo.retry, workerIndex: testInfo.workerIndex, timeline: diagnostics.timeline, snapshots: diagnostics.snapshots, finalSnapshot }, null, 2));
        await testInfo.attach("stop-diagnostics", {
          contentType: "application/json",
          path,
        });
      }
    }
  }, { auto: true }],
});

export { expect };

export async function clickStop(page: Page, diagnostics: StopDiagnostics) {
  await diagnostics.capture("before-stop");
  await test.step("Stop the partial response", async () => {
    await page.getByRole("button", { name: "Stop response" }).click();
  });
}
