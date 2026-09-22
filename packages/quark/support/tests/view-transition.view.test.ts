import "@excom/quark-sheet";
import { Quark } from "../../index";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { installViewTransitionStub } from "./helpers";
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

const names = (root: Element) =>
  [...root.querySelectorAll("[bind-name]")].map((el) => el.textContent);

const settle = async () => {
  await flush();
  await Quark.whenSettled();
};

describe("view-transition view", () => {
  let restoreStub: (() => void) | undefined;
  beforeEach(() => installDemoModules());
  afterEach(() => {
    restoreStub?.();
    restoreStub = undefined;
    document.body.innerHTML = "";
    restoreDemoModules();
  });

  it("adds and removes planets without the API, within the complexity budget", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "view-transition"));
    await settle();
    expect(names(root)).toEqual(["Mercury", "Venus"]);
    const meter = measureComplexity(quark!);
    click(root.querySelector("[data-add]"));
    await settle();
    const budget = meter.take();
    meter.stop();
    expect(names(root)).toEqual(["Mercury", "Venus", "Earth"]);
    expectComplexity(budget);
  });

  it("runs each add / remove in one view transition and never the first render", async () => {
    const stub = installViewTransitionStub();
    restoreStub = stub.restore;
    const { root } = await mountView(readDemo(import.meta.url, "view-transition"));
    await settle();
    expect(stub.calls).toHaveLength(0);
    const add = root.querySelector<HTMLButtonElement>("[data-add]")!;
    const remove = root.querySelector<HTMLButtonElement>("[data-remove]")!;
    click(add);
    await settle();
    await stub.calls[0].finished;
    click(add);
    await settle();
    await stub.calls[1].finished;
    expect(names(root)).toEqual(["Mercury", "Venus", "Earth", "Mars"]);
    expect(add.disabled).toBe(true);
    click(remove);
    await settle();
    await stub.calls[2].finished;
    expect(names(root)).toEqual(["Mercury", "Venus", "Earth"]);
    expect(stub.calls.map((call) => [...call.types])).toEqual([["planets"], ["planets"], ["planets"]]);
    expect(stub.calls.every((call) => call.isUpdated)).toBe(true);
  });
});
