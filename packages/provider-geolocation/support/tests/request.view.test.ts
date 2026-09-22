import { invokeCommand } from "@excom/neutron";
import "@excom/event-handler";
import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  flush,
  installDemoModules,
  mountView,
  readDemo,
  restoreDemoModules,
} from "@excom/quark/support/tests/view-helpers";

describe("request view", () => {
  beforeEach(() => installDemoModules());
  afterEach(() => {
    document.body.innerHTML = "";
    restoreDemoModules();
  });

  it("starts paused and accepts a request click", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "request"));
    const provider = root.querySelector("provider-geolocation")!;
    expect(provider.hasAttribute("is-paused")).toBe(true);
    const button = root.querySelector<HTMLButtonElement>("button[command]")!;
    expect(button.getAttribute("command")).toBe("--request");
    // happy-dom has no Command API: dispatch what the button would have
    invokeCommand(root.querySelector("provider-geolocation")!, "--request", button);
    await flush();
    expect(root.querySelector("output")).toBeTruthy();
  });
});
