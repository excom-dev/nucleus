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

  it("keeps the list and did-load while a refetch is in flight", async () => {
    const todo = (title: string) =>
      new Response(JSON.stringify({ id: 1, title }), {
        headers: { "content-type": "application/json" },
      });
    let answer!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(todo("Once"))
      .mockImplementationOnce(
        () => new Promise((resolve) => (answer = resolve)),
      );
    const { root } = await mountView(readDemo(import.meta.url, "refetch"));
    const provider = root.querySelector("provider-fetch")!;
    if (!provider.hasAttribute("is-success")) {
      await waitForEvent(provider, "provider-fetch-success");
    }
    await flush();
    const titles = () =>
      [...root.querySelectorAll("li")].map((li) => li.textContent).join();

    invokeCommand(provider, "--fetch", root.querySelector("button")!);
    await flush();
    expect(provider.hasAttribute("is-loading")).toBe(true);
    expect(provider.hasAttribute("is-success")).toBe(false);
    expect(provider.hasAttribute("did-load")).toBe(true);
    expect(titles()).toContain("Once");

    await waitForEvent(provider, "provider-fetch-success", () => {
      answer(todo("Twice"));
    });
    await flush();
    expect(provider.hasAttribute("did-load")).toBe(true);
    expect(titles()).toContain("Twice");
  });
});
