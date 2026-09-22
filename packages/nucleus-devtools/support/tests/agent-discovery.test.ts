/**
 * chrome-devtools-mcp discovery: the `devtoolstooldiscovery` listener
 * answers synchronously with a tool group built from the definitions, and
 * `installPageProbe` wires it (plus the attach announcement) on the page.
 */
import {
  DISCOVERY_EVENT,
  type DiscoveryEvent,
  registerAgentTools,
  toToolGroup,
  type ToolGroup,
} from "../../lib/agent-discovery";
import { AGENT_TOOL_GROUP, type AgentToolDefinition } from "../../lib/agent-tools";
import { installPageProbe } from "../../lib/install";
import { ATTACH_EVENT, HOOK_KEY, PAGE_API_KEY, type PageDevtoolsApi } from "../../lib/protocol";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const definitions: AgentToolDefinition[] = [
  {
    name: "echo",
    description: "Echoes its input.",
    inputSchema: { type: "object", properties: { x: { type: "number" } } },
    execute: (input) => ({ got: input }),
  },
];

/** What the MCP server does: dispatch with a `respondWith` attached. */
const discover = (target: EventTarget): ToolGroup | undefined => {
  let group: ToolGroup | undefined;
  const event = new Event(DISCOVERY_EVENT) as DiscoveryEvent;
  event.respondWith = (g) => {
    group = g;
  };
  target.dispatchEvent(event);
  return group;
};

describe("agent discovery", () => {
  it("builds a tool group whose execute defaults missing input to {}", () => {
    const group = toToolGroup(definitions);
    expect(group.name).toBe(AGENT_TOOL_GROUP.name);
    expect(group.description).toBe(AGENT_TOOL_GROUP.description);
    expect(group.tools).toHaveLength(1);
    expect(group.tools[0]).toMatchObject({ name: "echo", inputSchema: definitions[0].inputSchema });
    expect(group.tools[0].execute({ x: 1 })).toEqual({ got: { x: 1 } });
    expect(group.tools[0].execute(undefined as never)).toEqual({ got: {} });
  });

  it("answers discovery events synchronously and stops after dispose", () => {
    const target = new EventTarget();
    const dispose = registerAgentTools(definitions, target);
    expect(discover(target)?.tools.map((t) => t.name)).toEqual(["echo"]);
    // an event without respondWith (someone else's) is ignored
    expect(() => target.dispatchEvent(new Event(DISCOVERY_EVENT))).not.toThrow();
    dispose();
    expect(discover(target)).toBeUndefined();
  });

  it("defaults to window", () => {
    const dispose = registerAgentTools(definitions);
    expect(discover(window)?.name).toBe(AGENT_TOOL_GROUP.name);
    dispose();
    expect(discover(window)).toBeUndefined();
  });
});

describe("installPageProbe", () => {
  const g = globalThis as Record<string, unknown>;

  afterEach(() => {
    delete g[HOOK_KEY];
    delete g[PAGE_API_KEY];
  });

  it("installs hook, API, tools and discovery on the page global; second call is a no-op", () => {
    const probe = installPageProbe()!;
    expect(probe).not.toBeNull();
    expect(g[HOOK_KEY]).toBe(probe.hook);
    const api = g[PAGE_API_KEY] as PageDevtoolsApi;
    expect(api).toBe(probe.api);
    expect(api.listTools!().map((t) => t.name)).toContain("state_snapshot");
    expect(typeof api.tools!.dump).toBe("function");
    expect(discover(window)?.tools.map((t) => t.name)).toEqual(api.listTools!().map((t) => t.name));
    expect(installPageProbe()).toBeNull();
    probe.unregister();
    expect(discover(window)).toBeUndefined();
  });

  it("announces itself only when asked and posts records through `post`", () => {
    const attach = vi.fn();
    globalThis.addEventListener(ATTACH_EVENT, attach);
    const silent = installPageProbe()!;
    expect(attach).not.toHaveBeenCalled();
    silent.unregister();
    delete g[HOOK_KEY];

    const posted: string[] = [];
    const loud = installPageProbe({ announce: true, post: (json) => posted.push(json) })!;
    expect(attach).toHaveBeenCalledTimes(1);
    loud.hook.publicize(["quark", "error"], { errorMessage: "x" });
    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0])).toMatchObject({ path: ["quark", "error"] });
    expect((loud.tools.tools.diagnostics() as { total: number }).total).toBe(1);
    loud.unregister();
    globalThis.removeEventListener(ATTACH_EVENT, attach);
  });

  it("accepts a custom target object", () => {
    const target = Object.assign(new EventTarget(), {}) as Record<string, unknown> & EventTarget;
    const probe = installPageProbe({ target })!;
    expect(target[HOOK_KEY]).toBe(probe.hook);
    expect(g[HOOK_KEY]).toBeUndefined();
    expect(discover(target)?.tools.length).toBeGreaterThan(0);
    probe.unregister();
  });
});
