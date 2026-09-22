import "@excom/include-content";
import "@excom/quark-sheet";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  click,
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
  readViewFile,
} from "@excom/quark/support/tests/view-helpers";

const html = readViewFile(import.meta.url, "../../public/views/timer-app/timer-app.html");
const quarkSrc = readViewFile(
  import.meta.url,
  "../../public/views/timer-app/timer-app.quark",
);

describe("timer-app view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("writes duration from the slider and reset reloads the bar", async () => {
    const { root, quark } = await mountView(html, quarkSrc);
    const slider = root.querySelector<HTMLInputElement>('input[name="data-duration"]')!;
    const include = root.querySelector("include-content")!;

    expect(root.getAttribute("data-duration")).toBe("10");
    expect(root.querySelector("[bind-duration]")?.textContent).toBe("10s");
    expect(include.hasAttribute("is-active")).toBe(true);
    expect(root.querySelector(".timer-bar")).toBeTruthy();

    const meter = measureComplexity(quark!);
    slider.value = "20";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(root.getAttribute("data-duration")).toBe("20");
    expect(root.querySelector("[bind-duration]")?.textContent).toBe("20s");

    // plain <button>; the sheet's `@on click` sends `--reload` to the bar
    click(root.querySelector("button"));
    await flush();
    expect(root.querySelector(".timer-bar")).toBeTruthy();
    expectComplexity(budget);
  });
});
