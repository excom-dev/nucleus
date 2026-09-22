import "@excom/dialog-anchor";
import "@excom/event-handler";
import "@excom/quark-sheet";
import "@excom/super-form";
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
  readViewFile,
} from "@excom/quark/support/tests/view-helpers";

const html = readViewFile(
  import.meta.url,
  "../../public/views/flight-booker-app/flight-booker-app.html",
);
const quarkSrc = readViewFile(
  import.meta.url,
  "../../public/views/flight-booker-app/flight-booker-app.quark",
);

describe("flight-booker-app view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("disables return and book until dates are valid, then confirms", async () => {
    spyFetch({
      status: 200,
      body: JSON.stringify({
        json: { "data-trip": "return", "data-outbound": "2026-09-10", "data-inbound": "2026-09-20" },
      }),
    });
    const { root, quark } = await mountView(html, quarkSrc);
    const trip = root.querySelector<HTMLSelectElement>('select[name="data-trip"]')!;
    const outbound = root.querySelector<HTMLInputElement>(
      'input[name="data-outbound"]',
    )!;
    const inbound = root.querySelector<HTMLInputElement>(
      'input[name="data-inbound"]',
    )!;
    const book = root.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const superForm = root.querySelector<HTMLSuperFormElement>("super-form")!;
    const dialog = root.querySelector("dialog")!;

    expect(root.getAttribute("data-trip")).toBe("one-way");
    expect(inbound.disabled).toBe(true);
    expect(book.disabled).toBe(true);

    trip.value = "return";
    trip.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(root.getAttribute("data-trip")).toBe("return");
    expect(inbound.disabled).toBe(false);

    outbound.value = "2026-09-10";
    outbound.dispatchEvent(new Event("input", { bubbles: true }));
    inbound.value = "2026-09-20";
    inbound.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(book.disabled).toBe(false);

    const meter = measureComplexity(quark!);
    await waitForEvent(superForm, "super-form-success", () => {
      superForm
        .getFormElement()!
        .dispatchEvent(new Event("submit", { bubbles: true }));
    });
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(dialog.querySelector("[bind-confirmation]")?.textContent).toMatch(
      /return flight from 2026-09-10 to 2026-09-20/,
    );
    // Confirmation copy is written; opening the dialog uses command-name
    // show-modal, which happy-dom does not implement.
    expect(dialog.open).toBe(false);
    expectComplexity(budget);
  });

  it("keeps Book disabled when return is before departure", async () => {
    const { root } = await mountView(html, quarkSrc);
    const trip = root.querySelector<HTMLSelectElement>('select[name="data-trip"]')!;
    const outbound = root.querySelector<HTMLInputElement>(
      'input[name="data-outbound"]',
    )!;
    const inbound = root.querySelector<HTMLInputElement>(
      'input[name="data-inbound"]',
    )!;
    const book = root.querySelector<HTMLButtonElement>('button[type="submit"]')!;

    trip.value = "return";
    trip.dispatchEvent(new Event("change", { bubbles: true }));
    outbound.value = "2026-09-20";
    outbound.dispatchEvent(new Event("input", { bubbles: true }));
    inbound.value = "2026-09-10";
    inbound.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(book.disabled).toBe(true);
  });

  it("books a one-way flight once departure is set", async () => {
    spyFetch({
      status: 200,
      body: JSON.stringify({
        json: { "data-trip": "one-way", "data-outbound": "2026-09-10" },
      }),
    });
    const { root } = await mountView(html, quarkSrc);
    const outbound = root.querySelector<HTMLInputElement>(
      'input[name="data-outbound"]',
    )!;
    const inbound = root.querySelector<HTMLInputElement>(
      'input[name="data-inbound"]',
    )!;
    const book = root.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const superForm = root.querySelector<HTMLSuperFormElement>("super-form")!;

    expect(inbound.disabled).toBe(true);
    outbound.value = "2026-09-10";
    outbound.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(book.disabled).toBe(false);

    await waitForEvent(superForm, "super-form-success", () => {
      superForm
        .getFormElement()!
        .dispatchEvent(new Event("submit", { bubbles: true }));
    });
    await flush();
    expect(
      root.querySelector("[bind-confirmation]")?.textContent,
    ).toMatch(/one-way flight on 2026-09-10/);
  });
});
