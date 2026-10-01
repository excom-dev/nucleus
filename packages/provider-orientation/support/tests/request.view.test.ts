import { invokeCommand } from "@excom/neutron";
import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
  waitForEvent,
} from "@excom/nucleus-test";
import {
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
} from "@excom/quark/support/tests/view-helpers";

/** What an Android sensor reports: `alpha` from north, `absolute` set. */
const turnTo = (alpha: number) =>
  window.dispatchEvent(
    Object.assign(new Event("deviceorientation"), { alpha, absolute: true }),
  );

describe("request view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("listens on request, then prints the heading", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "request"));
    const provider = root.querySelector("provider-orientation")!;
    const output = root.querySelector("output")!;
    const button = root.querySelector<HTMLButtonElement>("button[command]")!;
    expect(provider.hasAttribute("is-paused")).toBe(true);
    expect(button.getAttribute("command")).toBe("--request");
    // happy-dom has no sensor permission API: the request starts listening
    invokeCommand(provider, "--request", button);
    await flush();
    expect(provider.hasAttribute("is-success")).toBe(true);
    expect(output.textContent).toBe("Listening — no reading yet.");
    const meter = measureComplexity(quark!);
    await waitForEvent(provider, "provider-orientation-success", () => turnTo(270));
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(output.textContent).toBe("Heading 90°");
    expectComplexity(budget);
  });
});
