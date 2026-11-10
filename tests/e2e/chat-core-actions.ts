import type { Route } from "@playwright/test";

/** RSC Server Action response body used by chat-core e2e mocks. */
export function rscActionBody(result: unknown) {
  return '0:{"a":"$@1","f":[],"b":"development"}\n1:' + JSON.stringify(result) + "\n";
}

/** Workspace mount calls listAgentsAction() with no args (`[]`). */
export async function fulfillAgentsList(route: Route, args: unknown[]) {
  if (args.length !== 0) return false;
  await route.fulfill({ contentType: "text/x-component", body: rscActionBody({ data: [] }) });
  return true;
}
