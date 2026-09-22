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

const html = readViewFile(import.meta.url, "../../public/views/counter-app/counter-app.html");
const quarkSrc = readViewFile(
  import.meta.url,
  "../../public/views/counter-app/counter-app.quark",
);

describe("counter-app view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("starts at 0 and increments on each click", async () => {
    const { root, quark } = await mountView(html, quarkSrc);
    const button = root.querySelector("button")!;
    const count = () => button.querySelector("span")?.textContent;
    expect(count()).toBe("0");

    const meter = measureComplexity(quark!);
    click(button);
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(count()).toBe("1");

    click(button);
    await flush();
    expect(count()).toBe("2");
    expectComplexity(budget);
  });
});
