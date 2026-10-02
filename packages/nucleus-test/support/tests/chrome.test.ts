import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// `vi` must come from "vitest" itself so `vi.mock` is hoisted with it
import { vi } from "vitest";
import { afterAll, afterEach, describe, expect, it } from "../../index";
import { open, serve, until } from "../../chrome.mjs";

// serve() would listen on a port: the test keeps the request handler and calls it with a stand-in request
type Handler = (req: { url: string }, res: Reply) => Promise<void>;
type Reply = { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: unknown) => void };
const http = vi.hoisted(() => ({ handlers: [] as Handler[] }));
vi.mock("node:http", () => {
  const createServer = (handler: Handler) => {
    http.handlers.push(handler);
    const server = { once: () => server, listen: (_port: number, ready: () => void) => ready() };
    return Object.assign(server, { address: () => ({ port: 4000 }), closeAllConnections: () => {}, close: () => {} });
  };
  return { createServer, default: { createServer } };
});

// open() checks where Chrome is, then starts it: the test decides what exists and stops at the start
const chrome = vi.hoisted(() => ({ exists: (_path: string) => false, started: [] as string[] }));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  const existsSync = (path: string) => chrome.exists(path);
  return { ...original, existsSync, default: { ...original, existsSync } };
});
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  const spawn = (path: string) => {
    chrome.started.push(path);
    throw new Error(`started ${path}`);
  };
  return { ...original, spawn, default: { ...original, spawn } };
});

// <root>/index.html, <root>/app.js, <root>/docs/index.html
const root = mkdtempSync(join(tmpdir(), "nucleus-test-chrome-"));
mkdirSync(join(root, "docs"));
writeFileSync(join(root, "index.html"), "<p>shell</p>");
writeFileSync(join(root, "app.js"), "export {};");
writeFileSync(join(root, "docs/index.html"), "<p>docs</p>");

afterAll(() => rmSync(root, { recursive: true, force: true }));

const request = async (handler: Handler, url: string) => {
  const reply = { status: 0, type: "", body: "" };
  await handler(
    { url },
    {
      writeHead: (status, headers) => Object.assign(reply, { status, type: headers["content-type"] }),
      end: (body) => (reply.body = String(body)),
    },
  );
  return reply;
};

describe("serve", () => {
  it("serves files typed by extension and a folder's index.html", async () => {
    const { port } = await serve({ root });
    expect(port).toBe(4000);
    const handler = http.handlers.at(-1)!;
    expect(await request(handler, "/app.js?delay=1")).toEqual({
      status: 200,
      type: "text/javascript; charset=utf-8",
      body: "export {};",
    });
    expect(await request(handler, "/docs/")).toMatchObject({ status: 200, body: "<p>docs</p>" });
  });

  it("answers an extensionless path without a file with index.html, any other missing file with 404", async () => {
    await serve({ root });
    const handler = http.handlers.at(-1)!;
    expect(await request(handler, "/shop/tables")).toMatchObject({ status: 200, body: "<p>shell</p>" });
    expect(await request(handler, "/img/missing.png")).toMatchObject({ status: 404, body: "Not found: /img/missing.png" });
  });

  it("offers each request to intercept first, and falls through when it declines", async () => {
    const intercept = ({ pathname }: URL) =>
      pathname.startsWith("/api/") && { status: 503, body: "refused", type: "text/plain" };
    await serve({ root, intercept });
    const handler = http.handlers.at(-1)!;
    expect(await request(handler, "/api/me")).toEqual({ status: 503, type: "text/plain", body: "refused" });
    expect(await request(handler, "/app.js")).toMatchObject({ status: 200 });
  });
});

describe("open", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const on = (name: string) => Object.defineProperty(process, "platform", { ...platform, value: name });
  // an existing profile: open() makes no folder of its own
  const start = () => open({ port: 1, profile: root });

  afterEach(() => {
    Object.defineProperty(process, "platform", platform);
    vi.unstubAllEnvs();
    chrome.exists = () => false;
    chrome.started = [];
  });

  it("starts the first Chrome found where the platform keeps it", async () => {
    vi.stubEnv("CHROME", undefined);
    on("linux");
    chrome.exists = (path) => path === "/usr/bin/google-chrome";
    await expect(start()).rejects.toThrow("started /usr/bin/google-chrome");
    on("darwin");
    chrome.exists = () => true;
    await expect(start()).rejects.toThrow("started /Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  });

  it("names every place it tried when there is no Chrome, before it starts anything", async () => {
    vi.stubEnv("CHROME", undefined);
    on("linux");
    await expect(start()).rejects.toThrow(
      "Google Chrome not found (tried /usr/bin/google-chrome-stable, /usr/bin/google-chrome): install it, or set CHROME to its path"
    );
    on("win32");
    vi.stubEnv("PROGRAMFILES", "C:\\Program Files");
    vi.stubEnv("PROGRAMFILES(X86)", undefined);
    vi.stubEnv("LOCALAPPDATA", "C:\\Users\\runner\\AppData\\Local");
    await expect(start()).rejects.toThrow(
      "(tried C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe, C:\\Users\\runner\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe)"
    );
    on("aix");
    await expect(start()).rejects.toThrow("Google Chrome not found (no usual place on aix)");
    expect(chrome.started).toEqual([]);
  });

  it("takes CHROME over the usual places, and only CHROME", async () => {
    vi.stubEnv("CHROME", "/opt/chrome-dev/chrome");
    on("linux");
    chrome.exists = (path) => path !== "/opt/chrome-dev/chrome";
    await expect(start()).rejects.toThrow("Google Chrome not found (tried /opt/chrome-dev/chrome)");
    chrome.exists = () => true;
    await expect(start()).rejects.toThrow("started /opt/chrome-dev/chrome");
  });
});

describe("until", () => {
  it("resolves true as soon as the function is truthy, and false after the time given", async () => {
    let calls = 0;
    expect(await until(() => ++calls === 3, 1000, 1)).toBe(true);
    expect(await until(() => false, 20, 5)).toBe(false);
  });

  it("counts a throwing or rejecting function as not yet", async () => {
    const fail = () => {
      throw new Error("not yet");
    };
    expect(await until(fail, 20, 5)).toBe(false);
    expect(await until(async () => fail(), 20, 5)).toBe(false);
  });
});

describe("command", () => {
  const chrome = join(import.meta.dirname, "../../chrome.mjs");
  const run = (...args: string[]) => spawnSync(process.execPath, [chrome, ...args], { encoding: "utf8" });

  it("prints its header for --help, which names what it needs", () => {
    const { status, stdout } = run("--help");
    expect(status).toBe(0);
    expect(stdout).toContain("Needs Google Chrome (CHROME overrides its path) and");
    expect(stdout).toContain("cannot start inside a sandbox");
  });

  it("exits 2 on bad arguments, before it starts anything", () => {
    expect(run()).toMatchObject({ status: 2, stderr: "error: expected one <path>\n" });
    expect(run("--size", "big", "/")).toMatchObject({ status: 2, stderr: "error: --size needs <W>x<H>\n" });
  });
});
