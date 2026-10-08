import "@excom/event-handler";
import "@excom/quark-sheet";
import "@excom/super-input";
import {
  afterEach,
  describe,
  expect,
  it,
  readFileRelative,
} from "@excom/nucleus-test";
import {
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
} from "@excom/quark/support/tests/view-helpers";
const html = readFileRelative(
  import.meta.url,
  "../../public/views/temperature-app/temperature-app.html",
);
const quarkSrc = readFileRelative(
  import.meta.url,
  "../../public/views/temperature-app/temperature-app.quark",
);

const typeNumber = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const mountApp = async () => {
  const mounted = await mountView(html, quarkSrc);
  const field = (unit: string) =>
    mounted.root.querySelector<HTMLInputElement>(`[bind-${unit}] input`)!;
  return { ...mounted, celsius: field("celsius"), fahrenheit: field("fahrenheit") };
};

describe("temperature-app view (7GUIs task 2)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("initially both fields are empty", async () => {
    // the served markup, then the same once the sheet has run
    const served = document.createElement("div");
    served.innerHTML = html;
    expect(
      [...served.querySelectorAll("input")].map((input) => input.getAttribute("value")),
    ).toEqual([null, null]);

    const { root, celsius, fahrenheit } = await mountApp();
    expect(celsius.value).toBe("");
    expect(fahrenheit.value).toBe("");
    expect(root.hasAttribute("data-entry")).toBe(false);
  });

  it("a numeric entry in one field updates the other", async () => {
    const { root, quark, celsius, fahrenheit } = await mountApp();

    const meter = measureComplexity(quark!);
    typeNumber(celsius, "100");
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(root.getAttribute("data-unit")).toBe("celsius");
    expect(root.getAttribute("data-entry")).toBe("100");
    expect(celsius.value).toBe("100");
    expect(fahrenheit.value).toBe("212.0");

    typeNumber(fahrenheit, "32");
    await flush();
    expect(root.getAttribute("data-unit")).toBe("fahrenheit");
    expect(root.getAttribute("data-entry")).toBe("32");
    expect(fahrenheit.value).toBe("32");
    expect(celsius.value).toBe("0.0");

    // the same number typed into the other field converts the other way
    typeNumber(celsius, "32");
    await flush();
    expect(fahrenheit.value).toBe("89.6");
    expectComplexity(budget);
  });

  it("an empty or non-numeric entry leaves the other field as it is", async () => {
    // A browser's number field reports "" while its text is empty or not a
    // number (happy-dom does not sanitise): both entries are this one event.
    const { root, celsius, fahrenheit } = await mountApp();
    typeNumber(celsius, "100");
    await flush();
    expect(fahrenheit.value).toBe("212.0");

    typeNumber(celsius, "");
    await flush();
    expect(fahrenheit.value).toBe("212.0");
    expect(root.getAttribute("data-entry")).toBe("");

    // and vice versa
    typeNumber(fahrenheit, "50");
    await flush();
    expect(celsius.value).toBe("10.0");
    typeNumber(fahrenheit, "");
    await flush();
    expect(celsius.value).toBe("10.0");

    // the next number converts again
    typeNumber(fahrenheit, "212");
    await flush();
    expect(celsius.value).toBe("100.0");
  });

  it("keeps overriding a field the user edited, even to the value its attribute already holds", async () => {
    /*
     * 32 F writes value="0.0" on celsius; the user types 100 there, then 32 F
     * again resolves celsius to "0.0". The attribute never changed, but the
     * live value must still be restored.
     */
    const { celsius, fahrenheit } = await mountApp();
    typeNumber(fahrenheit, "32");
    await flush();
    expect(celsius.getAttribute("value")).toBe("0.0");
    typeNumber(celsius, "100");
    await flush();
    expect(fahrenheit.value).toBe("212.0");
    typeNumber(fahrenheit, "32");
    await flush();
    expect(celsius.getAttribute("value")).toBe("0.0");
    expect(celsius.value).toBe("0.0");
    expect(celsius.defaultValue).toBe("0.0");
  });
});
