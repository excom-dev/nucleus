import "@excom/quark-sheet";
import "../../index";
import {
  expectComplexity,
  flush,
  measureComplexity,
} from "@excom/quark/support/tests/helpers";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  spyFetch,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const demoHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../demos/simple.html"),
  "utf8",
);

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("echoes the submitted name and stays within the complexity budget", async () => {
    spyFetch({
      status: 200,
      body: JSON.stringify({ json: { name: "Ada" } }),
    });
    const root = fixture<HTMLElement>(demoHtml);
    const sheet = root.querySelector<HTMLQuarkSheetElement>("quark-sheet")!;
    const superForm = root.querySelector<HTMLSuperFormElement>("super-form")!;
    await flush();
    expect(sheet.quarkInstance).toBeDefined();

    const nameInput = root.querySelector<HTMLInputElement>(
      'input[name="name"]',
    )!;
    nameInput.value = "Ada";

    const meter = measureComplexity(sheet.quarkInstance!);
    await waitForEvent(superForm, "super-form-success", () => {
      superForm
        .getFormElement()!
        .dispatchEvent(new Event("submit", { bubbles: true }));
    });
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(root.querySelector("h4")?.textContent).toBe("Echoed name: Ada");
    expect(root.querySelector("span")?.textContent).toBe(
      "HTTP status code: 200",
    );
    expectComplexity(budget);
  });
});
