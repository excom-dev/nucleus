import { installPageProbe } from "../lib/install";
import { PAGE_API_KEY, type PageDevtoolsApi } from "../lib/protocol";

/**
 * Injectable agent-tools bundle (`agent-tools.js`, an unlisted WXT script).
 *
 * For browsers without the extension: an agent evaluates this file in the
 * page (chrome-devtools-mcp `evaluate_script`, Playwright `evaluate`, a
 * `<script>` tag when CSP allows) and gets the same page API + tools the
 * extension installs, minus what happened before injection: histories
 * start now, and `neutron/defined` records already published are missed.
 *
 * Installing late, it announces itself so producers hand over their
 * renderers. When the extension is present this is a no-op.
 */
export default defineUnlistedScript(() => {
  const g = globalThis as Record<string, unknown>;
  const installed = installPageProbe({ announce: true });
  const api = g[PAGE_API_KEY] as PageDevtoolsApi | undefined;
  const tools = api?.listTools?.().map((tool) => tool.name) ?? [];
  const summary = {
    source: "nucleus-devtools",
    installed: installed !== null,
    tools,
    hint: installed
      ? "Tools ready: __NUCLEUS_DEVTOOLS__.tools.<name>(input). chrome-devtools-mcp: call list_3p_developer_tools to discover them. History starts now; reload with the extension for boot-time records."
      : "A hook was already installed (the extension or an earlier injection); using it.",
  };
  console.info(`[nucleus-devtools] ${summary.hint}`);
  return summary;
});
