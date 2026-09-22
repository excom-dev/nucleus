import "@excom/event-handler";
import "@excom/quark-sheet";
import "@excom/super-input";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
  readViewFile,
} from "@excom/quark/support/tests/view-helpers";
const html = readViewFile(
  import.meta.url,
  "../../public/views/temperature-app/temperature-app.html",
);
const quarkSrc = readViewFile(
  import.meta.url,
  "../../public/views/temperature-app/temperature-app.quark",
);

const typeNumber = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("temperature-app view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("writes each field onto the host and converts the other side", async () => {
    const { root, quark } = await mountView(html, quarkSrc);
    const celsius = root.querySelector<HTMLInputElement>('input[name="data-celsius"]')!;
    const fahrenheit = root.querySelector<HTMLInputElement>(
      'input[name="data-fahrenheit"]',
    )!;

    expect(Number(celsius.value)).toBeCloseTo(0, 0);
    expect(Number(fahrenheit.value)).toBeCloseTo(32, 0);

    const meter = measureComplexity(quark!);
    typeNumber(celsius, "100");
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(root.getAttribute("data-source")).toBe("celsius");
    expect(root.getAttribute("data-celsius")).toBe("100");
    expect(Number(celsius.value)).toBeCloseTo(100, 0);
    expect(Number(fahrenheit.value)).toBeCloseTo(212, 0);

    typeNumber(fahrenheit, "32");
    await flush();
    expect(root.getAttribute("data-source")).toBe("fahrenheit");
    expect(root.getAttribute("data-fahrenheit")).toBe("32");
    expect(Number(celsius.value)).toBeCloseTo(0, 0);
    expect(celsius.getAttribute("value")).toBe("0.0");
    expectComplexity(budget);
  });

  it("keeps overriding a field the user edited, even to the value its attribute already holds", async () => {
    /*
     * celsius starts at value="0.0"; the user types 100, then fahrenheit is
     * set to 32 → the rule resolves celsius to "0.0" again. The attribute
     * never changed, but the live value must still be restored.
     */
    const { root } = await mountView(html, quarkSrc);
    const celsius = root.querySelector<HTMLInputElement>('input[name="data-celsius"]')!;
    const fahrenheit = root.querySelector<HTMLInputElement>(
      'input[name="data-fahrenheit"]',
    )!;
    typeNumber(celsius, "100");
    await flush();
    expect(Number(fahrenheit.value)).toBeCloseTo(212, 0);
    typeNumber(fahrenheit, "32");
    await flush();
    expect(celsius.getAttribute("value")).toBe("0.0");
    expect(celsius.value).toBe("0.0");
    expect(celsius.defaultValue).toBe("0.0");
  });
});
