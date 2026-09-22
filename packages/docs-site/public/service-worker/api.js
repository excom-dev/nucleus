import { handleEcho } from "./echo.js";
import { handleReturns } from "./returns.js";
import { handleSandbox } from "./sandbox.js";
import { handleTodos } from "./todos.js";
import { handleWebAuthn } from "./webauthn.js";

/*
 * Only demo routes are mocked. Anything else under `/api/` (e.g.
 * `/api/release-subscribers`) goes to the network; the deployed site
 * has a real worker there.
 */
export async function handleApi(request) {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/todos")) return handleTodos(request);
  if (path.startsWith("/api/webauthn")) return handleWebAuthn(request);
  if (path === "/api/echo") return handleEcho(request);
  if (path.startsWith("/api/returns")) return handleReturns(request);
  if (path.startsWith("/api/sandbox/")) return handleSandbox(request);
  return fetch(request);
}
