/**
 * `@warn` / `@debug` / `@error` statements inside rules and blocks: they
 * evaluate on the matched element and report to the logger and the
 * DevTools hook; `@warn` / `@error` once per element and rule, `@debug` on
 * every application. Nothing is written to the document.
 */
import { Quark } from "../../index";
import { QuarkLogger } from "../../src/utils";
import type { QuarkRenderer } from "../../src/devtools-hook";
import {
  type DevtoolsHook,
  NUCLEUS_DEVTOOLS_HOOK_KEY,
  pathMatches,
  type PublicizeMeta,
  type PublicizePath,
} from "@excom/kit-devtools";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { createSheet, flush, mount, unregisterAll } from "./helpers";

type Spy = ReturnType<typeof vi.spyOn>;
type LogArg = { message?: string; values?: unknown[] };

const messages = (spy: Spy) =>
  spy.mock.calls
    .map(([arg]) => String((arg as LogArg)?.message ?? arg))
    .filter((m) => m.startsWith("Quark @"));
const values = (spy: Spy) =>
  spy.mock.calls
    .map(([arg]) => arg as LogArg)
    .filter((arg) => String(arg?.message).startsWith("Quark @"))
    .map((arg) => arg.values);

describe("@warn / @debug / @error", () => {
  let warn: Spy;
  let debug: Spy;
  let error: Spy;
  beforeEach(() => {
    warn = vi.spyOn(QuarkLogger, "warn").mockImplementation(() => {});
    debug = vi.spyOn(QuarkLogger, "debug").mockImplementation(() => {});
    error = vi.spyOn(QuarkLogger, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>)[
      NUCLEUS_DEVTOOLS_HOOK_KEY
    ];
  });

  it("warns once per element and rule, naming the selector; the selector is the condition", async () => {
    const { root } = mount(
      `<img id="a" src="a.png"><img id="b" src="b.png" alt="fine">`,
      `img:not([alt]) { @warn "img needs alt"; }`
    );
    await flush();
    expect(messages(warn)).toEqual([
      "Quark @warn (img:not([alt])): img needs alt",
    ]);
    expect(values(warn)).toEqual([["img needs alt"]]);
    const a = root.querySelector("#a")!;
    const b = root.querySelector("#b")!;
    // `a` stops and starts matching again: no second warning for it
    a.setAttribute("alt", "");
    await flush();
    a.removeAttribute("alt");
    await flush();
    expect(messages(warn)).toHaveLength(1);
    // a new offender is its own warning
    b.removeAttribute("alt");
    await flush();
    expect(messages(warn)).toHaveLength(2);
    // nothing was written to the document
    expect([...a.attributes].map((attr) => attr.name)).toEqual(["id", "src"]);
  });

  it("@debug reports every application and again when a binding it reads changes", async () => {
    const { root } = mount(
      `<section id="host" data-count="1"><span bind-count></span></section>`,
      `#host {
        $count: +attr("data-count");
        @debug "count", $count;
        [bind-count] { content: $count; }
      }`
    );
    await flush();
    expect(values(debug)).toEqual([["count", 1]]);
    root.querySelector("#host")!.setAttribute("data-count", "2");
    await flush();
    expect(values(debug).at(-1)).toEqual(["count", 2]);
    expect(values(debug)).toHaveLength(2);
    expect(root.querySelector("[bind-count]")!.textContent).toBe("2");
  });

  it("@error reports at error level, inside an @on block with event data", async () => {
    const { root } = mount(
      `<form id="f"><button type="button">go</button></form>`,
      `#f { @on request-failed { @error "request failed", event.detail.code; } }`
    );
    await flush();
    expect(messages(error)).toEqual([]);
    root
      .querySelector("#f")!
      .dispatchEvent(
        new CustomEvent("request-failed", {
          bubbles: true,
          detail: { code: 502 },
        })
      );
    await flush();
    expect(messages(error)).toEqual(["Quark @error (#f): request failed 502"]);
    expect(values(error)).toEqual([["request failed", 502]]);
  });

  it("reports one value per comma-list item and a single expression as one value", async () => {
    mount(
      `<p id="p"></p>`,
      `#p { $pair: (1, 2); @debug $pair; @debug "a", "b"; @debug (x: 1); }`
    );
    await flush();
    expect(values(debug)).toEqual([[[1, 2]], ["a", "b"], [{ x: 1 }]]);
    expect(messages(debug)[2]).toBe('Quark @debug (#p): {"x":1}');
  });

  it("publishes quark/diagnostic with level, values, expression and the element", async () => {
    const publications: { path: PublicizePath; meta: PublicizeMeta }[] = [];
    const hook: DevtoolsHook = {
      version: 1,
      publicize: (path, meta) => {
        publications.push({ path, meta });
      },
    };
    Quark.attachDevtools(hook);
    const { root } = mount(
      `<img id="a" src="a.png">`,
      `img:not([alt]) { @warn "img needs alt", attr("src"); }`
    );
    await flush();
    const records = publications
      .filter((p) => pathMatches(p.path, ["quark", "diagnostic"]))
      .map((p) => p.meta);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "warn",
      key: "@warn",
      tag: "img",
      selector: "img:not([alt])",
      expression: '"img needs alt", attr("src")',
      values: ["img needs alt", "a.png"],
      message: "img needs alt a.png",
    });
    expect((records[0].weakElement as WeakRef<Element>).deref()).toBe(
      root.querySelector("#a")
    );
  });

  it("lists diagnostics on the rule for DevTools", async () => {
    const renderers: QuarkRenderer[] = [];
    Quark.attachDevtools({
      version: 1,
      inject: (renderer) => {
        renderers.push(renderer as QuarkRenderer);
      },
    });
    const { quark, register } = createSheet(
      `<p id="p"></p>`,
      `#p { data-a: 1; @warn "w"; @debug "d", 1; }`
    );
    register();
    await flush();
    const sheet = renderers
      .find((r) => r.kind === "quark")!
      .sheets()
      .find((s) => s.sheetId === quark.id)!;
    expect(sheet.rules[0].diagnostics).toEqual([
      { level: "warn", expression: '"w"' },
      { level: "debug", expression: '"d", 1' },
    ]);
    expect(sheet.rules[0].declarations).toEqual([
      { key: "data-a", value: "1" },
    ]);
  });

  it("rejects statements outside a rule at build", () => {
    new Quark({ src: '@warn "top"; @delay 10 { x: 1; }' });
    const built = error.mock.calls.map(([arg]) =>
      String((arg as LogArg)?.message)
    );
    expect(built).toContain("Quark: @warn must be written inside a rule");
    expect(built).toContain("Quark: @delay must be written inside a rule");
  });

  it("reports a failing expression as an error, not a diagnostic", async () => {
    mount(`<p id="p"></p>`, `#p { @warn nope(); }`);
    await flush();
    expect(messages(warn)).toEqual([]);
    expect(
      error.mock.calls.some(([arg]) =>
        String((arg as LogArg)?.message).includes(
          "Could not resolve expression"
        )
      )
    ).toBe(true);
  });

  it("works inside @view-transition blocks and nested rules", async () => {
    mount(
      `<div id="host"><span></span><span></span></div>`,
      `#host { @view-transition { span { @warn "in block"; } } }`
    );
    await flush();
    expect(messages(warn)).toEqual([
      "Quark @warn (#host span): in block",
      "Quark @warn (#host span): in block",
    ]);
  });
});
