import { AGENT_TOOL_GROUP, type AgentToolDefinition, type AgentToolInput } from "./agent-tools";

/**
 * chrome-devtools-mcp "third-party developer tools" registration.
 *
 * The MCP server dispatches `devtoolstooldiscovery` on `window` (after
 * navigation, on page selection, and on `list_3p_developer_tools`) and
 * expects a synchronous `event.respondWith(toolGroup)`. It then lists the
 * tools to the agent and runs `execute_3p_developer_tool` against them
 * (input validated against `inputSchema`). Requires the server flag
 * `--categoryExperimentalThirdParty`.
 *
 * The listener must be on the real `window` (the server checks for one
 * via `DOMDebugger.getEventListeners`), so the MAIN-world script owns it.
 */
export const DISCOVERY_EVENT = "devtoolstooldiscovery";

export type ToolGroup = {
  name: string;
  description: string;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (input: AgentToolInput) => unknown;
  }>;
};

export type DiscoveryEvent = Event & { respondWith?: (group: ToolGroup) => void };

export const toToolGroup = (definitions: AgentToolDefinition[]): ToolGroup => ({
  name: AGENT_TOOL_GROUP.name,
  description: AGENT_TOOL_GROUP.description,
  tools: definitions.map(({ name, description, inputSchema, execute }) => ({
    name,
    description,
    inputSchema,
    execute: (input) => execute(input ?? {}),
  })),
});

/** Listen for discovery and answer with the tool group. Returns a disposer. */
export const registerAgentTools = (
  definitions: AgentToolDefinition[],
  target: EventTarget = window,
): (() => void) => {
  const listener = (event: Event) => {
    const respondWith = (event as DiscoveryEvent).respondWith;
    if (typeof respondWith !== "function") return;
    respondWith(toToolGroup(definitions));
  };
  target.addEventListener(DISCOVERY_EVENT, listener);
  return () => target.removeEventListener(DISCOVERY_EVENT, listener);
};
