import "@excom/quark-sheet";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { DEMO_FLAGS } from "../../../docs-site/public/demo-utils";
import {
  click,
  expectComplexity,
  flush,
  installDemoModules,
  measureComplexity,
  mountView,
  readDemo,
  restoreDemoModules,
} from "./view-helpers";

const visibleFlags = (root: Element) =>
  [...root.querySelectorAll("[data-flag]:not([hidden])")].map((el) =>
    el.getAttribute("data-flag"),
  );

describe("js-api view", () => {
  beforeEach(() => installDemoModules());
  afterEach(() => {
    document.body.innerHTML = "";
    restoreDemoModules();
  });

  it("re-runs the rules reading $app-flags when JS hands the flags over", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "js-api"));
    expect(visibleFlags(root)).toEqual([]);
    const meter = measureComplexity(quark!);
    click(root.querySelector("button"));
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(root.quark.getPropertyValue("$app-flags")).toBe(DEMO_FLAGS);
    expect(visibleFlags(root)).toEqual(["new-checkout"]);
    expectComplexity(budget);
  });

  it("reads flags written before the sheet registers", async () => {
    const wrap = document.createElement("div");
    wrap.innerHTML = readDemo(import.meta.url, "js-api");
    const root = wrap.firstElementChild as HTMLElement;
    const sheet = root.querySelector("quark-sheet")!;
    sheet.remove();
    document.body.append(wrap);
    // boot code: app JS writes before any sheet runs
    root.quark.setProperty("$app-flags", { "new-checkout": false, "gift-cards": true });
    await waitForEvent(sheet, "quark-sheet-success", () => root.append(sheet));
    await flush();
    expect(visibleFlags(root)).toEqual(["gift-cards"]);
  });
});
