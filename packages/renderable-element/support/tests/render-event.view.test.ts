import "@excom/include-content";
import "@excom/quark-sheet";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { installViewTransitionStub } from "@excom/quark/support/tests/helpers";
import {
  expectComplexity,
  flush,
  installDemoModules,
  measureComplexity,
  mountView,
  restoreDemoModules,
} from "@excom/quark/support/tests/view-helpers";

const toggle = (checkbox: HTMLInputElement, checked: boolean) => {
  checkbox.checked = checked;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("render-event view", () => {
  let restoreStub: (() => void) | undefined;
  beforeEach(() => installDemoModules());
  afterEach(() => {
    restoreStub?.();
    restoreStub = undefined;
    document.body.innerHTML = "";
    restoreDemoModules();
  });

  it("renders and unrenders inside a view transition", async () => {
    const stub = installViewTransitionStub();
    restoreStub = stub.restore;
    const { root, quark } = await mountView(readDemo(import.meta.url, "render-event"));
    const include = root.querySelector("include-content")!;
    const checkbox = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const meter = measureComplexity(quark!);
    toggle(checkbox, true);
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(include.hasAttribute("is-active")).toBe(true);
    expect(stub.calls).toHaveLength(1);
    await stub.calls[0].updateCallbackDone;
    expect(include.querySelector("article")).toBeTruthy();
    toggle(checkbox, false);
    await flush();
    expect(stub.calls).toHaveLength(2);
    await stub.calls[1].updateCallbackDone;
    expect(include.querySelector("article")).toBeNull();
    expectComplexity(budget);
  });

  it("renders directly without the View Transition API", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "render-event"));
    const include = root.querySelector("include-content")!;
    toggle(root.querySelector<HTMLInputElement>('input[type="checkbox"]')!, true);
    await flush();
    expect(include.querySelector("article")).toBeTruthy();
  });
});
