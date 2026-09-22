import { registerAgentTools } from "./agent-discovery";
import { attachAgentTools, createAgentTools } from "./agent-tools";
import { createHeatmap, type Heatmap } from "./heatmap";
import { createPageHook, type PageHookOptions } from "./page-hook-core";
import { ATTACH_EVENT, HOOK_KEY, PAGE_API_KEY } from "./protocol";

export type InstallOptions = {
  /** Deliver records to the isolated bridge; the injected bundle has none. */
  post?: PageHookOptions["post"];
  heatmap?: Heatmap;
  /** `globalThis` of the page; tests hand in a fake. */
  target?: Record<string, unknown> & EventTarget;
  doc?: Document;
  /**
   * Dispatch `nucleus-devtools-attach` after installing, so producers
   * that already loaded hand over their renderers (late install only; at
   * `document_start` nothing has loaded yet).
   */
  announce?: boolean;
};

/**
 * Install the MAIN-world probe: hook global, page API, agent tools and the
 * chrome-devtools-mcp discovery listener. Shared by the extension content
 * script (`document_start`) and the injectable `agent-tools.js` (late).
 * A second install on the same global is a no-op returning `null`.
 */
export const installPageProbe = ({
  post = () => {},
  heatmap = createHeatmap(),
  target = globalThis as unknown as Record<string, unknown> & EventTarget,
  doc = document,
  announce = false,
}: InstallOptions = {}) => {
  if (target[HOOK_KEY]) return null;
  const probe = createPageHook({ post, heatmap });
  const tools = attachAgentTools(
    probe.api,
    createAgentTools({
      api: probe.api,
      renderers: probe.renderers,
      log: probe.log,
      heatmap,
      doc,
    }),
  );
  target[PAGE_API_KEY] = probe.api;
  target[HOOK_KEY] = probe.hook;
  const unregister = registerAgentTools(tools.definitions, target);
  if (announce) target.dispatchEvent(new Event(ATTACH_EVENT));
  return { ...probe, tools, unregister };
};
