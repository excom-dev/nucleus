import { emptyDiagnostics } from "../../src/diagnostics";
import { sha256 } from "../../src/node";
import type { RendererHandle } from "../../src/renderer";
import { keyOf, perform, type Reply, type Task } from "../../src/worker";
import { afterEach, describe, expect, it, vi } from "@excom/nucleus-test";

const diagnostics = { ...emptyDiagnostics(), errors: ["stopped"] };

const fakeRenderer = () =>
  ({
    key: "renderer-digest",
    budgetMs: 1234,
    renderPage: vi.fn(async () => ({ html: "<p>page</p>", diagnostics: emptyDiagnostics(), shell: "s" })),
    shellPage: vi.fn(async () => ({ html: "<p>shell</p>", diagnostics: emptyDiagnostics() })),
    lost: vi.fn(async () => ({ html: "<p>lost</p>", diagnostics })),
    changed: vi.fn(async (): Promise<string | undefined> => undefined),
  }) as unknown as RendererHandle & Record<"renderPage" | "shellPage" | "lost" | "changed", ReturnType<typeof vi.fn>>;

describe("keyOf", () => {
  it("digests the renderer's key with the worker's, so a different worker key gives a different digest", () => {
    const renderer = fakeRenderer();
    expect(keyOf(renderer, "app")).toBe(sha256(JSON.stringify(["renderer-digest", "app"])));
    expect(keyOf(renderer)).toBe(sha256(JSON.stringify(["renderer-digest", null])));
    expect(new Set([keyOf(renderer), keyOf(renderer, "app"), keyOf(renderer, "other")]).size).toBe(3);
  });
});

describe("perform", () => {
  it("answers each task with the renderer's method for it", async () => {
    const renderer = fakeRenderer();
    expect(await perform(renderer, { type: "render", url: "/a", notFound: true })).toEqual({
      type: "page",
      outcome: { html: "<p>page</p>", diagnostics: emptyDiagnostics(), shell: "s" },
    });
    expect(renderer.renderPage).toHaveBeenCalledWith("/a", { notFound: true });
    expect(await perform(renderer, { type: "shell", url: "/b" })).toMatchObject({ outcome: { html: "<p>shell</p>" } });
    expect(renderer.shellPage).toHaveBeenCalledWith("/b");
    expect(await perform(renderer, { type: "lost", url: "/c", diagnostics })).toMatchObject({ outcome: { html: "<p>lost</p>" } });
    expect(renderer.lost).toHaveBeenCalledWith("/c", diagnostics);
    renderer.changed.mockResolvedValueOnce("its shell changed");
    const inputs = { shell: "s", requests: [] };
    expect(await perform(renderer, { type: "check", url: "/d", inputs })).toEqual({ type: "checked", changed: "its shell changed" });
    expect(renderer.changed).toHaveBeenCalledWith("/d", inputs);
  });

  it("keeps the diagnostics of a page that failed, and reports any other error as fatal", async () => {
    const renderer = fakeRenderer();
    renderer.renderPage.mockRejectedValueOnce(Object.assign(new Error("page failed"), { diagnostics }));
    expect(await perform(renderer, { type: "render", url: "/" })).toEqual({ type: "page", outcome: { diagnostics } });
    const error = new Error("no memory");
    renderer.renderPage.mockRejectedValueOnce(error);
    expect(await perform(renderer, { type: "render", url: "/" })).toEqual({ type: "fatal", error });
  });
});

describe("serveRenderer", () => {
  afterEach(() => {
    vi.doUnmock("../../src/node");
    vi.doUnmock("../../src/renderer");
    vi.resetModules();
  });

  /** `serveRenderer()` with a channel to a parent and a renderer opening as `open` says. */
  const load = async (open: () => Promise<unknown>) => {
    const handlers: ((task: Task) => Promise<void>)[] = [];
    const parent = {
      send: vi.fn(),
      on: vi.fn((_event: string, handler: (task: Task) => Promise<void>) => void handlers.push(handler)),
    };
    const openRenderer = vi.fn(open);
    vi.resetModules();
    vi.doMock("../../src/node", async (original) => ({ ...(await original<object>()), parentChannel: () => parent }));
    vi.doMock("../../src/renderer", async (original) => ({ ...(await original<object>()), openRenderer }));
    const { serveRenderer } = await import("../../src/worker");
    return { serveRenderer, parent, openRenderer, handlers };
  };

  it("opens the renderer with the options but the cache key, and announces its key and time budget", async () => {
    const renderer = fakeRenderer();
    const { serveRenderer, parent, openRenderer } = await load(async () => renderer);
    const options = { root: "dist", origin: "https://wren.test", entry: async () => ({}) };
    await serveRenderer({ ...options, cacheKey: async () => "app-digest" });
    expect(openRenderer).toHaveBeenCalledWith(options);
    expect(parent.send).toHaveBeenCalledTimes(1);
    expect(parent.send).toHaveBeenCalledWith({ type: "ready", key: keyOf(renderer, "app-digest"), budgetMs: 1234 });
  });

  it("announces the renderer's own key when the worker adds none", async () => {
    const renderer = fakeRenderer();
    const { serveRenderer, parent } = await load(async () => renderer);
    await serveRenderer({ root: "dist", origin: "https://wren.test", entry: async () => ({}) });
    expect(parent.send).toHaveBeenCalledWith({ type: "ready", key: keyOf(renderer), budgetMs: 1234 });
  });

  it("answers each task the parent sends with the reply for it", async () => {
    const renderer = fakeRenderer();
    const { serveRenderer, parent, handlers } = await load(async () => renderer);
    await serveRenderer({ root: "dist", origin: "https://wren.test", entry: async () => ({}) });
    expect(parent.on).toHaveBeenCalledWith("message", expect.any(Function));
    await handlers[0]!({ type: "shell", url: "/menu" });
    expect(parent.send).toHaveBeenLastCalledWith({
      type: "page",
      outcome: { html: "<p>shell</p>", diagnostics: emptyDiagnostics() },
    } satisfies Reply);
  });

  it("tells the parent when the renderer cannot open or the cache key cannot be made, and takes no task", async () => {
    const failure = new Error("entry threw");
    const opening = await load(async () => Promise.reject(failure));
    await opening.serveRenderer({ root: "dist", origin: "https://wren.test", entry: async () => ({}) });
    expect(opening.parent.send).toHaveBeenCalledTimes(1);
    expect(opening.parent.send).toHaveBeenCalledWith({ type: "fatal", error: failure });
    expect(opening.parent.on).not.toHaveBeenCalled();

    const keying = await load(async () => fakeRenderer());
    await keying.serveRenderer({
      root: "dist",
      origin: "https://wren.test",
      entry: async () => ({}),
      cacheKey: () => {
        throw failure;
      },
    });
    expect(keying.parent.send).toHaveBeenCalledTimes(1);
    expect(keying.parent.send).toHaveBeenCalledWith({ type: "fatal", error: failure });
    expect(keying.parent.on).not.toHaveBeenCalled();
  });
});
