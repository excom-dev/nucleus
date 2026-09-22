import { invokeCommand } from "@excom/neutron";
import "@excom/event-handler";
import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  spyFetch,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
  readDemo,
} from "@excom/quark/support/tests/view-helpers";

describe("external-trigger view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists the echo after an outside trigger", async () => {
    spyFetch({
      status: 200,
      body: JSON.stringify({ json: { nickname: "Ada" } }),
    });
    const { root, quark } = await mountView(
      readDemo(import.meta.url, "external-trigger"),
    );
    const form = root.querySelector<HTMLSuperFormElement>("super-form")!;
    const trigger = root.querySelector<HTMLButtonElement>("button[command]")!;
    root.querySelector<HTMLInputElement>('input[name="nickname"]')!.value =
      "Ada";

    expect(trigger.getAttribute("command")).toBe("--submit");
    expect(trigger.getAttribute("commandfor")).toBe(form.id);

    // happy-dom has no Command API: dispatch what the button would have
    const meter = measureComplexity(quark!);
    await waitForEvent(form, "super-form-success", () => {
      invokeCommand(form, "--submit", trigger);
    });
    // `[is-success]` is observed as an attribute change (deferred run), then
    // the iterate rows render and their own rule runs: two settle cycles
    await flush();
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(form.hasAttribute("is-success")).toBe(true);
    expect(root.querySelector("ul")?.textContent).toMatch(/Ada/);
    expectComplexity(budget);
  });
});
