// Every local file the page links ships (public/ is copied into the build as it is), and the page's one script.
import { afterEach, describe, expect, it, readFileRelative, serveStatic, vi } from "@excom/nucleus-test";
import { ROOT } from "./backend/worker.mjs";

const html = readFileRelative(import.meta.url, "../../index.html");
// and the worker it registers; `route-href` and `api-url` name routes and the API, not files
const links = [...html.matchAll(/(?:(?<![\w-])(?:href|src|src-url|template-ref)=|register\()"(\/[^"?#]+)/g)].map(
  ([, link]) => link,
);

const KIT = 'import("@excom/nucleus-kit/nucleus-kit.progressive")';
const BOOT = html.match(/<script type="module">([\s\S]*?)<\/script>/)![1]!;
type Run = (navigator: object, document: Document, importKit: () => Promise<void>) => Promise<void>;
const AsyncFunction = (async () => {}).constructor as new (...names: string[]) => Run;

/** Runs the page's module script with `serviceWorker` as `navigator.serviceWorker`; its kit import is `imported`. */
const boot = (serviceWorker?: object) => {
  expect(BOOT).toContain(KIT);
  const imported = vi.fn(async () => {});
  const run = new AsyncFunction("navigator", "document", "importKit", BOOT.replace(KIT, "importKit()"));
  return { imported, done: run({ serviceWorker }, document, imported) };
};

/** A `navigator.serviceWorker` with no controller yet. */
const container = (register = vi.fn(async () => ({}))) => Object.assign(new EventTarget(), { controller: null as object | null, register });

afterEach(() => document.body.removeAttribute("needs-service-worker"));

describe("index.html", () => {
  it("imports the Nucleus Kit once the service worker controls the page", async () => {
    const worker = container();
    const { imported, done } = boot(worker);
    await vi.waitFor(() => expect(worker.register).toHaveBeenCalledWith("/service-worker/service-worker.js", { scope: "/", updateViaCache: "none" }));
    await new Promise((resolve) => setTimeout(resolve));
    expect(imported).not.toHaveBeenCalled();
    worker.controller = {};
    worker.dispatchEvent(new Event("controllerchange"));
    await done;
    expect(imported).toHaveBeenCalledOnce();
    // a reload: in control from the start, the kit waits for no registration
    const controlled = Object.assign(container(vi.fn(() => new Promise<object>(() => {}))), { controller: {} });
    const reload = boot(controlled);
    await reload.done;
    expect(reload.imported).toHaveBeenCalledOnce();
  });

  it("asks the active worker to claim a page a hard reload left uncontrolled, then imports the kit", async () => {
    const active = { postMessage: vi.fn() };
    const worker = container(vi.fn(async () => ({ active })));
    const { imported, done } = boot(worker);
    await vi.waitFor(() => expect(active.postMessage).toHaveBeenCalledWith("claim"));
    expect(imported).not.toHaveBeenCalled();
    worker.controller = {};
    worker.dispatchEvent(new Event("controllerchange"));
    await done;
    expect(imported).toHaveBeenCalledOnce();
  });

  it("says the shop needs a service worker where it has none, and loads no kit", async () => {
    const { imported, done } = boot();
    await done;
    expect(imported).not.toHaveBeenCalled();
    expect(document.body.hasAttribute("needs-service-worker")).toBe(true);
    document.body.removeAttribute("needs-service-worker");
    // one the browser refuses to register, e.g. in a private window
    const refused = boot(container(vi.fn(async () => Promise.reject(new Error("refused")))));
    await vi.waitFor(() => expect(document.body.hasAttribute("needs-service-worker")).toBe(true));
    expect(refused.imported).not.toHaveBeenCalled();
    document.body.removeAttribute("needs-service-worker");
    // refused while a worker already controls the page: the app works on
    const working = Object.assign(container(vi.fn(async () => Promise.reject(new Error("refused")))), { controller: {} });
    const kept = boot(working);
    await kept.done;
    await new Promise((resolve) => setTimeout(resolve));
    expect(kept.imported).toHaveBeenCalledOnce();
    expect(document.body.hasAttribute("needs-service-worker")).toBe(false);
  });

  it("keeps a form from submitting until the element that takes it over is defined", async () => {
    await boot(Object.assign(container(), { controller: {} })).done;
    document.body.innerHTML = `
      <super-form><form id="add" action="/api/bag" method="post"><button>Add</button></form></super-form>
      <spa-a><form id="search"><input name="q"></form></spa-a>
      <form id="plain"></form>`;
    const submitted = (id: string) => document.getElementById(id)!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(["add", "search", "plain"].map(submitted)).toEqual([false, false, true]);
    // once defined, the element's own handling is all there is
    customElements.define("spa-a", class extends HTMLElement {});
    expect(submitted("search")).toBe(true);
    document.body.innerHTML = "";
  });

  it("links only files public/ serves", async () => {
    const serve = serveStatic(ROOT);
    expect(links).toEqual(expect.arrayContaining(["/service-worker/service-worker.js", "/shell.quark", "/manifest.webmanifest", "/img/icons.svg", "/views/home/home.html"]));
    const served = await Promise.all([...new Set(links)].map(async (link) => ({ link, ok: (await serve(link)).ok })));
    expect(served.filter(({ ok }) => !ok).map(({ link }) => link)).toEqual([]);
  });

  it("builds its stylesheet from the package root", () => {
    expect([...html.matchAll(/(?:href|src)="(\.[^"]+)"/g)].map(([, link]) => link)).toEqual(["./shell.css"]);
    expect(readFileRelative(import.meta.url, "../../shell.css")).toContain('@import "@excom/nucleus-kit/basic.css"');
  });
});
