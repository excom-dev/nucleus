/**
 * `@delay <ms> { … }`: the block applies once after the pause, if the
 * element is still in the document and the rule still matches; applying
 * the rule again restarts the timer. Real timers with short pauses.
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
  describe,
  expect,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { LoopGuard } from "@excom/kit-utils";
import { createSheet, flush, mount, unregisterAll } from "./helpers";

const waitFor = async (condition: () => boolean, ticks = 60) => {
  for (let i = 0; i < ticks && !condition(); i++) await wait(5);
  expect(condition()).toBe(true);
};

/**
 * `flush()` under fake timers: advance the clock by `ms`, then drain whatever
 * the due timers queued. Advancing also flushes microtasks, so this covers
 * the paint queue and the observer callbacks `flush()` waits on.
 */
const tick = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(0);
};

describe("@delay", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
    LoopGuard.reset();
    delete (globalThis as Record<string, unknown>)[
      NUCLEUS_DEVTOOLS_HOOK_KEY
    ];
  });

  // Fake timers: `is-visible` is asserted while the 30ms pause is still
  // running, and a real `flush()` can outlast it on a loaded machine.
  it("applies the block after the pause; declarations write the element, nested rules its descendants", async () => {
    vi.useFakeTimers();
    const { root } = mount(
      `<output id="o" is-visible><span>hi</span></output>`,
      `#o[is-visible] { @delay 30 { is-visible: none; span { data-late: ""; } } }`
    );
    await tick();
    const out = root.querySelector("#o")!;
    expect(out.hasAttribute("is-visible")).toBe(true);
    await tick(35);
    expect(out.hasAttribute("is-visible")).toBe(false);
    expect(out.querySelector("span")!.hasAttribute("data-late")).toBe(true);
  });

  // Fake timers: the assertion below is that p has *not* fired yet, so the
  // re-application has to land inside the 80ms pause. On a loaded machine a
  // real `wait(40)` can overshoot it and p fires on its first timer.
  it("restarts on every application of the rule, one timer per element", async () => {
    vi.useFakeTimers();
    const { root } = mount(
      `<p id="p" data-tick="1"></p><p id="q" data-tick="1"></p>`,
      `[data-tick] { @delay 80 { data-done: attr("data-tick"); } }`
    );
    await tick();
    const p = root.querySelector("#p")!;
    const q = root.querySelector("#q")!;
    await tick(40);
    p.setAttribute("data-tick", "2");
    await tick();
    await tick(45);
    // 85ms after the first application, but p restarted at 40ms
    expect(p.hasAttribute("data-done")).toBe(false);
    expect(q.getAttribute("data-done")).toBe("1");
    await tick(40);
    expect(p.getAttribute("data-done")).toBe("2");
  });

  // Fake timers: the drops have to be decided while the 30ms pause is still
  // running, so the removals must land inside it.
  it("drops the block when the element left, the rule stopped matching, or the sheet unregistered", async () => {
    vi.useFakeTimers();
    const { root, quark } = mount(
      `<p id="a" data-x></p><p id="b" data-x></p><p id="c" data-x></p>`,
      `[data-x] { @delay 30 { is-late: ""; } }`
    );
    await tick();
    const a = root.querySelector("#a")!;
    const b = root.querySelector("#b")!;
    const c = root.querySelector("#c")!;
    a.remove();
    b.removeAttribute("data-x");
    await tick();
    await tick(60);
    expect(a.hasAttribute("is-late")).toBe(false);
    expect(b.hasAttribute("is-late")).toBe(false);
    expect(c.hasAttribute("is-late")).toBe(true);
    // unregister clears pending timers
    c.removeAttribute("is-late");
    c.setAttribute("data-x", "again");
    await tick();
    quark.unregister();
    await tick(60);
    expect(c.hasAttribute("is-late")).toBe(false);
    expect(quark.delayTimers.size).toBe(0);
  });

  // Fake timers: `data-copied` is asserted while the 50ms pause is still
  // running, both for the single click and between the rapid pair.
  it("inside an @on block: fires per event with event data; rapid events restart", async () => {
    vi.useFakeTimers();
    const { root } = mount(
      `<button id="b" type="button">copy</button>`,
      `#b { @on click { data-copied: ""; @delay 50 { data-copied: none; data-last: event.type; } } }`
    );
    await tick();
    const button = root.querySelector("#b")!;
    const click = () =>
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    click();
    await tick();
    expect(button.getAttribute("data-copied")).toBe("");
    await tick(55);
    expect(button.hasAttribute("data-copied")).toBe(false);
    expect(button.getAttribute("data-last")).toBe("click");
    // rapid clicks: one flash, cleared once after the last click
    click();
    await tick(25);
    click();
    await tick();
    await tick(35);
    // 60ms after the first click, but only 35ms after the one that restarted it
    expect(button.getAttribute("data-copied")).toBe("");
    await tick(25);
    expect(button.hasAttribute("data-copied")).toBe(false);
  });

  it("chains: a delay inside a delay keeps `target` from the enclosing @on", async () => {
    const { root } = mount(
      `<ul id="list"><li><span>a</span></li></ul>`,
      `#list {
        @on click (target: "span") {
          @delay 10 { data-step: "1"; @delay 10 { data-step: "2"; data-target: target.localName; } }
        }
      }`
    );
    await flush();
    const list = root.querySelector("#list")!;
    list
      .querySelector("span")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitFor(() => list.getAttribute("data-step") === "2");
    expect(list.getAttribute("data-target")).toBe("span");
  });

  it("takes the duration from an expression and warns about non-numbers", async () => {
    const warn = vi.spyOn(QuarkLogger, "warn").mockImplementation(() => {});
    const { root } = mount(
      `<p id="a" data-ms="20"></p><p id="bad"></p>`,
      `[data-ms] { $ms: +attr("data-ms"); @delay $ms { is-late: ""; } }
       #bad { @delay "soon" { is-late: ""; } }`
    );
    await flush();
    await waitFor(() => root.querySelector("#a")!.hasAttribute("is-late"));
    await wait(30);
    expect(root.querySelector("#bad")!.hasAttribute("is-late")).toBe(false);
    expect(
      warn.mock.calls.some(([arg]) =>
        String((arg as { message?: string })?.message).includes(
          '@delay "soon" needs a number of milliseconds'
        )
      )
    ).toBe(true);
  });

  it("keeps the loop guard's causal depth: a self-retriggering chain is cut", async () => {
    LoopGuard.configure({ limit: 4, log: () => {} });
    const { root } = mount(
      `<p id="n" data-n="0"></p>`,
      `[data-n] { @delay 1 { data-n: +attr("data-n") + 1; } }`
    );
    await flush();
    await wait(150);
    await flush();
    const n = Number(root.querySelector("#n")!.getAttribute("data-n"));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(LoopGuard.limit + 1);
  });

  it("publishes quark/delay scheduled, fired and dropped records, and lists delays on the rule", async () => {
    const publications: { path: PublicizePath; meta: PublicizeMeta }[] = [];
    const renderers: QuarkRenderer[] = [];
    const hook: DevtoolsHook = {
      version: 1,
      inject: (renderer) => {
        renderers.push(renderer as QuarkRenderer);
      },
      publicize: (path, meta) => {
        publications.push({ path, meta });
      },
    };
    Quark.attachDevtools(hook);
    const { root, quark, register } = createSheet(
      `<p id="a" data-x></p><p id="b" data-x></p>`,
      // 100ms, not 10: under a loaded test runner the `#b` removal below must
      // land before the timer fires or the `dropped` record becomes `fired`
      `[data-x] { @delay 100 { is-late: ""; } }`
    );
    register();
    await flush();
    root.querySelector("#b")!.remove();
    await waitFor(() => root.querySelector("#a")!.hasAttribute("is-late"));
    await wait(20);
    const records = publications
      .filter((p) => pathMatches(p.path, ["quark", "delay"]))
      .map(({ meta }) => [meta.tag, meta.phase, meta.ms, meta.reason ?? null]);
    expect(records).toEqual([
      ["p", "scheduled", 100, null],
      ["p", "scheduled", 100, null],
      ["p", "fired", 100, null],
      ["p", "dropped", 100, "disconnected"],
    ]);
    const sheet = renderers
      .find((r) => r.kind === "quark")!
      .sheets()
      .find((s) => s.sheetId === quark.id)!;
    expect(sheet.rules[0].delays).toEqual([{ duration: "100" }]);
    expect(sheet.rules[0].declarations).toEqual([]);
  });
});
