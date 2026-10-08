import "@excom/dialog-anchor";
import "@excom/event-handler";
import "@excom/quark-sheet";
import "@excom/super-form";
import {
  afterEach,
  describe,
  expect,
  it,
  readFileRelative,
  spyFetch,
  waitForEvent,
} from "@excom/nucleus-test";
import {
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
} from "@excom/quark/support/tests/view-helpers";

const html = readFileRelative(
  import.meta.url,
  "../../public/views/flight-booker-app/flight-booker-app.html",
);
const quarkSrc = readFileRelative(
  import.meta.url,
  "../../public/views/flight-booker-app/flight-booker-app.quark",
);

const DATE = "2027-04-04";

const mountApp = async () => {
  const mounted = await mountView(html, quarkSrc);
  const { root } = mounted;
  const edit = (control: HTMLInputElement | HTMLSelectElement, value: string) => {
    control.value = value;
    control.dispatchEvent(
      new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
    return flush();
  };
  return {
    ...mounted,
    edit,
    trip: root.querySelector<HTMLSelectElement>('select[name="data-trip"]')!,
    outbound: root.querySelector<HTMLInputElement>('input[name="data-outbound"]')!,
    inbound: root.querySelector<HTMLInputElement>('input[name="data-inbound"]')!,
    book: root.querySelector<HTMLButtonElement>('button[type="submit"]')!,
    superForm: root.querySelector<HTMLSuperFormElement>("super-form")!,
    confirmation: root.querySelector("[bind-confirmation]")!,
  };
};

const submit = async (superForm: HTMLSuperFormElement) => {
  await waitForEvent(superForm, "super-form-success", () => {
    superForm.getFormElement()!.dispatchEvent(new Event("submit", { bubbles: true }));
  });
  await flush();
};

describe("flight-booker-app view (7GUIs task 3)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("initially: one-way flight, T1 and T2 hold the same date, T2 is disabled, B is enabled", async () => {
    // the served markup, then the same once the sheet has run
    const served = document.createElement("div");
    served.innerHTML = html;
    const state = (root: ParentNode) => ({
      trip: root.querySelector<HTMLSelectElement>("select")!.value,
      types: [...root.querySelectorAll("input")].map((input) => input.type),
      dates: [...root.querySelectorAll("input")].map((input) => input.value),
      inboundDisabled: root.querySelector<HTMLInputElement>('[name="data-inbound"]')!.disabled,
      bookDisabled: root.querySelector<HTMLButtonElement>("button")!.disabled,
      invalid: root.querySelectorAll("[aria-invalid]").length,
    });
    const initial = {
      trip: "one-way",
      types: ["text", "text"],
      dates: [DATE, DATE],
      inboundDisabled: true,
      bookDisabled: false,
      invalid: 0,
    };
    expect(state(served)).toEqual(initial);
    expect(
      [...served.querySelectorAll("option")].map((option) => option.textContent),
    ).toEqual(["one-way flight", "return flight"]);

    const { root } = await mountApp();
    expect(state(root)).toEqual(initial);
  });

  it("T2 is enabled iff C is 'return flight'", async () => {
    const { edit, trip, inbound } = await mountApp();
    expect(inbound.disabled).toBe(true);
    await edit(trip, "return");
    expect(inbound.disabled).toBe(false);
    await edit(trip, "one-way");
    expect(inbound.disabled).toBe(true);
  });

  it("B is disabled when a return flight's T2 is strictly before T1", async () => {
    const { edit, trip, outbound, inbound, book } = await mountApp();
    await edit(trip, "return");
    // the same day is not before
    expect(book.disabled).toBe(false);

    await edit(outbound, "2027-04-05");
    expect(book.disabled).toBe(true);
    expect(inbound.hasAttribute("aria-invalid")).toBe(false);

    await edit(inbound, "2027-04-06");
    expect(book.disabled).toBe(false);
    await edit(inbound, "2026-12-31");
    expect(book.disabled).toBe(true);

    // a one-way flight ignores T2
    await edit(trip, "one-way");
    expect(book.disabled).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["another format", "04.04.2027"],
    ["unpadded", "2027-4-4"],
    ["no such day", "2027-02-30"],
    ["no such month", "2027-13-01"],
    ["words", "tomorrow"],
    ["a date and more", "2027-04-04T10:00"],
  ])("an ill-formatted date (%s) in an enabled field marks it invalid and disables B", async (_label, text) => {
    const { edit, trip, outbound, inbound, book } = await mountApp();

    await edit(outbound, text);
    expect(outbound.getAttribute("aria-invalid")).toBe("true");
    expect(book.disabled).toBe(true);
    await edit(outbound, DATE);
    expect(outbound.hasAttribute("aria-invalid")).toBe(false);
    expect(book.disabled).toBe(false);

    await edit(trip, "return");
    await edit(inbound, text);
    expect(inbound.getAttribute("aria-invalid")).toBe("true");
    expect(outbound.hasAttribute("aria-invalid")).toBe(false);
    expect(book.disabled).toBe(true);

    // disabled again, T2 no longer counts: not marked, B enabled
    await edit(trip, "one-way");
    expect(inbound.disabled).toBe(true);
    expect(inbound.hasAttribute("aria-invalid")).toBe(false);
    expect(book.disabled).toBe(false);

    // and counts again as soon as it is enabled
    await edit(trip, "return");
    expect(inbound.getAttribute("aria-invalid")).toBe("true");
    expect(book.disabled).toBe(true);
    await edit(inbound, DATE);
    expect(inbound.hasAttribute("aria-invalid")).toBe(false);
    expect(book.disabled).toBe(false);
  });

  it("clicking B displays a message with the selection (return flight)", async () => {
    spyFetch({
      status: 200,
      body: JSON.stringify({
        json: { "data-trip": "return", "data-outbound": "2027-04-10", "data-inbound": "2027-04-20" },
      }),
    });
    const { root, quark, edit, trip, outbound, inbound, book, superForm, confirmation } =
      await mountApp();
    const dialog = root.querySelector("dialog")!;

    await edit(trip, "return");
    await edit(outbound, "2027-04-10");
    await edit(inbound, "2027-04-20");
    expect(book.disabled).toBe(false);

    const meter = measureComplexity(quark!);
    await submit(superForm);
    const budget = meter.take();
    meter.stop();

    expect(confirmation.textContent).toBe(
      "You have booked a return flight from 2027-04-10 to 2027-04-20.",
    );
    // Confirmation copy is written; opening the dialog uses command-name
    // show-modal, which happy-dom does not implement.
    expect(dialog.open).toBe(false);
    expectComplexity(budget);
  });

  it("clicking B displays a message with the selection (one-way flight, as served)", async () => {
    spyFetch({
      status: 200,
      body: JSON.stringify({ json: { "data-trip": "one-way", "data-outbound": DATE } }),
    });
    const { book, superForm, confirmation } = await mountApp();
    expect(book.disabled).toBe(false);

    await submit(superForm);
    expect(confirmation.textContent).toBe(`You have booked a one-way flight on ${DATE}.`);
  });
});
