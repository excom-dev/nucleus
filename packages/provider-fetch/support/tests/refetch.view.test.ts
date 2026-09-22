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
  vi,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
  readDemo,
} from "@excom/quark/support/tests/view-helpers";

describe("refetch view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("loads then refetches", async () => {
    spyFetch({
      status: 200,
      body: JSON.stringify({ id: 1, title: "Once" }),
    });
    const { root, quark } = await mountView(readDemo(import.meta.url, "refetch"));
    const provider = root.querySelector("provider-fetch")!;
    if (!provider.hasAttribute("is-success")) {
      await waitForEvent(provider, "provider-fetch-success");
    }
    await flush();
    expect([...root.querySelectorAll("li")].some((li) => /Once/.test(li.textContent || ""))).toBe(
      true,
    );
    const button = root.querySelector<HTMLButtonElement>("button")!;
    expect(button.getAttribute("command")).toBe("--fetch");
    expect(button.getAttribute("commandfor")).toBe(provider.id);
    const meter = measureComplexity(quark!);
    // happy-dom has no Command API: dispatch what the button would have
    await waitForEvent(provider, "provider-fetch-success", () => {
      invokeCommand(provider, "--fetch", button);
    });
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(provider.hasAttribute("is-success")).toBe(true);
    expectComplexity(budget);
  });
});
