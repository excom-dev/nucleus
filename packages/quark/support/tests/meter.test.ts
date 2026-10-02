import { Quark } from "../../index";
import { flush, mount, unregisterAll } from "./helpers";
import {
  afterEach,
  click,
  describe,
  expect,
  it,
  wait,
} from "@excom/nucleus-test";

afterEach(() => {
  unregisterAll();
  document.body.innerHTML = "";
});

/** What `scopeSelectors()` yields for one sheet. */
const selectorsOf = (quark: Quark) =>
  quark.rules.flatMap((rule) => [rule.matchSelector, rule.scopedSelector()]);

describe("Quark.meter", () => {
  it("counts every sheet's work until reset", async () => {
    Quark.meter.reset();
    mount(`<p bind-a></p>`, `[bind-a] { $a: "a"; content: $a; }`);
    mount(
      `<p bind-b></p>`,
      `[bind-b] { content: "b"; @on click { data-clicked: ""; } }`
    );
    await flush();
    expect(Quark.meter.counts).toEqual({
      quarkRuns: 2,
      ruleRuns: 2,
      variableRuns: 1,
      attributeRuns: 2,
      listenerRuns: 1,
      setVar: 1,
      getVar: 1,
      schedulePaint: 2,
    });
    Quark.meter.reset();
    expect(Object.values(Quark.meter.counts).every((n) => n === 0)).toBe(true);
  });

  it("leaves @on block rules out of ruleRuns", async () => {
    const { root } = mount(
      `<button></button>`,
      `button { @on click { data-clicked: ""; } }`
    );
    await flush();
    Quark.meter.reset();
    click(root.querySelector("button") as Element);
    await flush();
    expect(Quark.meter.counts).toMatchObject({
      ruleRuns: 0,
      attributeRuns: 1,
    });
    expect(root.querySelector("button[data-clicked]")).not.toBeNull();
  });

  it("leaves @delay block rules out of ruleRuns", async () => {
    // long enough to fire after the reset, even when timers run late
    const { root } = mount(`<p></p>`, `p { @delay 100 { data-late: ""; } }`);
    await flush();
    Quark.meter.reset();
    await wait(120);
    await flush();
    expect(root.querySelector("p[data-late]")).not.toBeNull();
    expect(Quark.meter.counts).toMatchObject({
      ruleRuns: 0,
      attributeRuns: 1,
    });
  });

  it("names the subtree-query selectors of every registered sheet", async () => {
    const a = mount(`<p bind-a></p>`, `[bind-a] { content: "a"; }`);
    const b = mount(`<p bind-b></p>`, `[bind-b] { content: "b"; }`);
    await flush();
    expect(selectorsOf(a.quark)[1]).toContain("[q-scope=");
    expect([...Quark.meter.scopeSelectors()]).toEqual([
      ...selectorsOf(a.quark),
      ...selectorsOf(b.quark),
    ]);
    a.quark.unregister();
    b.quark.unregister();
    expect([...Quark.meter.scopeSelectors()]).toEqual([]);
  });
});
