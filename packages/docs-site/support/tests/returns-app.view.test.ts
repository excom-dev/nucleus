import "@excom/provider-fetch";
import "@excom/quark-sheet";
import "@excom/super-form";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  spyFetch,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  bypassSelectorCache,
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
  readViewFile,
} from "@excom/quark/support/tests/view-helpers";

const html = readViewFile(
  import.meta.url,
  "../../public/views/returns-app/returns-app.html"
);
const quarkSrc = readViewFile(
  import.meta.url,
  "../../public/views/returns-app/returns-app.quark"
);

const item = (overrides: Record<string, unknown>) => ({
  price: 100,
  memberPrice: 90,
  weightKg: 10,
  returnWindowDays: 30,
  warrantyDays: 365,
  isFinalSale: false,
  isAssembled: false,
  restockingFeePct: 10,
  refundMember: 90,
  refundGuest: 90,
  feeMember: 0,
  feeGuest: 10,
  ...overrides,
});

// Delivered 21 days ago on a Friday (2026-09-11). 09-12 is a Saturday,
// 09-14 the next Monday.
const order = {
  id: "#1",
  today: "2026-09-11",
  deliveredDaysAgo: 21,
  items: [
    item({
      sku: "SOFA",
      name: "Sofa",
      category: "sofa",
      weightKg: 68,
      isAssembled: true,
      feeMember: 0,
  feeGuest: 129,
      components: [
        {
          sku: "SOFA-BASE",
          name: "Base frame",
          weightKg: 40,
          isAssembled: true,
          feeMember: 0,
  feeGuest: 79,
        },
        {
          sku: "SOFA-BACK",
          name: "Back cushions",
          weightKg: 9,
          isAssembled: false,
          feeMember: 0,
  feeGuest: 39,
        },
        {
          sku: "SOFA-LEGS",
          name: "Legs",
          weightKg: 3,
          isAssembled: false,
          feeMember: 0,
  feeGuest: 19,
        },
      ],
    }),
    item({
      sku: "LAMP",
      name: "Lamp",
      category: "lamp",
      price: 160,
      memberPrice: 144,
      restockingFeePct: 0,
      warrantyDays: 180,
      refundMember: 144,
  refundGuest: 160,
      feeMember: 0,
  feeGuest: 16,
    }),
    item({
      sku: "SHELF",
      name: "Shelf",
      category: "shelf",
      returnWindowDays: 14,
      isAssembled: true,
      components: [
        {
          sku: "SHELF-SIDE",
          name: "Side panel",
          weightKg: 8,
          isAssembled: false,
          feeMember: 0,
  feeGuest: 22,
        },
      ],
    }),
    item({
      sku: "MATT",
      name: "Mattress",
      category: "mattress",
      isFinalSale: true,
      feeMember: 0,
  feeGuest: 62,
    }),
    item({
      sku: "RUG",
      name: "Rug",
      category: "rug",
      warrantyDays: 14,
      feeMember: 0,
  feeGuest: 99,
    }),
  ],
};

const mount = async () => {
  spyFetch({ status: 200, body: JSON.stringify(order) });
  const { root, quark } = await mountView(html, quarkSrc);
  const provider = root.querySelector<HTMLElement>("#order")!;
  if (!provider.hasAttribute("is-success")) {
    await waitForEvent(provider, "provider-fetch-success");
  }
  await settle();
  return { root, quark: quark! };
};

// A change → paint → host fact → rule re-run chain spans
// several macrotasks; wait until two consecutive flushes see no mutation.
const settle = async () => {
  let mutations = 0;
  const observer = new MutationObserver(
    (records) => (mutations += records.length)
  );
  observer.observe(document.body, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  try {
    let quiet = 0;
    for (let i = 0; i < 40 && quiet < 2; i++) {
      mutations = 0;
      await flush();
      quiet = mutations === 0 ? quiet + 1 : 0;
    }
  } finally {
    observer.disconnect();
  }
};

const row = (root: HTMLElement, sku: string) =>
  root.querySelector<HTMLElement>(
    `:is(data-item, data-part)[sku-id="${sku}"]`
  )!;
const box = (root: HTMLElement, sku: string) =>
  row(root, sku).querySelector<HTMLInputElement>(
    ":scope > .line input[type=checkbox]"
  )!;
const radio = (root: HTMLElement, name: string, value: string) =>
  root.querySelector<HTMLInputElement>(
    `.options input[name="${name}"][value="${value}"]`
  )!;
const hidden = (root: HTMLElement, name: string) =>
  root.querySelector<HTMLInputElement>(`input[type=hidden][name="${name}"]`)!
    .value;
const summary = (root: HTMLElement) =>
  root.querySelector<HTMLElement>(".summary")!;
const submit = (root: HTMLElement) =>
  root.querySelector<HTMLButtonElement>(".summary button")!;
const change = (el: Element, value?: string) => {
  if (value !== undefined) (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const tick = async (root: HTMLElement, sku: string, checked = true) => {
  const input = box(root, sku);
  input.checked = checked;
  change(input);
  await settle();
};
const pick = async (root: HTMLElement, name: string, value: string) => {
  const input = radio(root, name, value);
  input.checked = true;
  change(input);
  await settle();
};
const setMode = (root: HTMLElement, mode: "return" | "replace") =>
  pick(root, "return-mode", mode);
const setMethod = (root: HTMLElement, method: string) =>
  pick(root, "return-method", method);
const setViewer = async (root: HTMLElement, membership: "member" | "guest") => {
  change(root.querySelector('select[name="membership-level"]')!, membership);
  await settle();
};
const setDate = async (root: HTMLElement, iso: string) => {
  change(root.querySelector('input[type="date"]')!, iso);
  await settle();
};

/*
 * happy-dom caches `Element.matches()` / `querySelectorAll()` per node and
 * never invalidates a `:has()` answer when a descendant changes, so the host's
 * `:scope:has(…)` facts would freeze on their first answer. Bypassed for this
 * suite; Chrome caches nothing and needs no shim.
 */
let restoreSelectorCache: () => void;

describe("returns-app view", () => {
  beforeAll(() => {
    restoreSelectorCache = bypassSelectorCache();
  });
  afterAll(() => restoreSelectorCache());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("facts", () => {
    it("stamps every line — items and the components of a bundle", async () => {
      const { root } = await mount();
      expect(root.querySelector('[bind-order="id"]')?.textContent).toBe("#1");
      expect(root.querySelectorAll(".items > data-item").length).toBe(5);
      expect(
        root
          .querySelector<HTMLInputElement>('input[type="date"]')
          ?.getAttribute("min")
      ).toBe("2026-09-11");

      const sofa = row(root, "SOFA");
      expect(sofa.getAttribute("component-count")).toBe("3");
      expect(sofa.getAttribute("refund-member")).toBe("90");
      expect(sofa.getAttribute("warranty-days")).toBe("365");
      expect(sofa.hasAttribute("is-in-warranty")).toBe(true);
      expect(sofa.hasAttribute("is-oversized")).toBe(true);
      expect(sofa.querySelectorAll(".components > data-part").length).toBe(3);
      expect(
        sofa.querySelector(':scope > .line [bind-field="name"]')?.textContent
      ).toBe("Sofa");

      const base = row(root, "SOFA-BASE");
      expect(base.localName).toBe("data-part");
      expect(row(root, "SOFA").localName).toBe("data-item");
      expect(base.getAttribute("weight-kg")).toBe("40");
      expect(base.hasAttribute("is-oversized")).toBe(true);
      expect(base.hasAttribute("is-assembled")).toBe(true);
      expect(base.querySelector('[bind-field="name"]')?.textContent).toBe("Base frame");
      expect(base.querySelector('[bind-field="weightKg"]')?.textContent).toBe("40");
      expect(base.getAttribute("fee-guest")).toBe("79");
      expect(box(root, "SOFA-BASE").name).toBe("SOFA-BASE");
      expect(row(root, "SOFA-LEGS").hasAttribute("is-oversized")).toBe(
        false
      );

      // a plain item has no bundle facts and renders no component rows
      const lamp = row(root, "LAMP");
      expect(lamp.hasAttribute("component-count")).toBe(false);
      expect(lamp.querySelectorAll(".components > data-part").length).toBe(0);
      // the rug's warranty is over, its return window is not
      expect(row(root, "RUG").hasAttribute("is-in-warranty")).toBe(false);
      expect(row(root, "RUG").hasAttribute("is-in-window")).toBe(true);
    });

    it("starts in return mode with the hidden inputs mirroring the host", async () => {
      const { root } = await mount();
      expect(root.getAttribute("return-mode")).toBe("return");
      expect(hidden(root, "mode")).toBe("return");
      expect(hidden(root, "membership")).toBe("member");
      expect(hidden(root, "return-method")).toBe("home-pickup");
      expect(hidden(root, "pickup-date")).toBe("");
      expect(root.hasAttribute("has-selection")).toBe(false);
      expect(root.hasAttribute("has-bundle-selected")).toBe(false);
    });
  });

  describe("return mode", () => {
    it("derives eligibility from window, final sale and method; components are not returnable", async () => {
      const { root } = await mount();
      expect(row(root, "SOFA").hasAttribute("is-eligible")).toBe(true);
      expect(box(root, "SOFA").disabled).toBe(false);
      // 21 days since delivery > a 14-day window
      expect(row(root, "SHELF").hasAttribute("is-in-window")).toBe(false);
      expect(row(root, "SHELF").hasAttribute("is-eligible")).toBe(false);
      expect(box(root, "SHELF").disabled).toBe(true);
      expect(row(root, "MATT").hasAttribute("is-eligible")).toBe(false);
      // components only exist for replacements
      for (const sku of ["SOFA-BASE", "SOFA-BACK", "SOFA-LEGS", "SHELF-SIDE"]) {
        expect(row(root, sku).hasAttribute("is-eligible")).toBe(false);
        expect(box(root, sku).disabled).toBe(true);
        expect(row(root, sku).hasAttribute("line-amount")).toBe(false);
      }
    });

    it("prices a return as a refund per membership", async () => {
      const { root } = await mount();
      expect(row(root, "LAMP").getAttribute("line-amount")).toBe("144");
      expect(
        row(root, "LAMP").querySelector("[bind-amount]")?.textContent
      ).toBe("144");
      await setViewer(root, "guest");
      expect(root.getAttribute("membership-level")).toBe("guest");
      expect(row(root, "LAMP").getAttribute("line-amount")).toBe("160");
      expect(
        row(root, "LAMP").querySelector("[bind-amount]")?.textContent
      ).toBe("160");
      expect(hidden(root, "membership")).toBe("guest");
    });

    it("blocks oversized items for UPS drop-off, unticks them and re-enables them on the way back", async () => {
      const { root, quark } = await mount();
      await tick(root, "SOFA");
      expect(row(root, "SOFA").hasAttribute("is-selected")).toBe(true);

      const meter = measureComplexity(quark);
      await setMethod(root, "ups-dropoff");
      const budget = meter.take();
      meter.stop();

      expect(root.getAttribute("return-method")).toBe("ups-dropoff");
      expect(row(root, "SOFA").hasAttribute("is-blocked-by-method")).toBe(
        true
      );
      expect(row(root, "SOFA").hasAttribute("is-eligible")).toBe(false);
      expect(row(root, "SOFA").hasAttribute("is-selected")).toBe(false);
      expect(box(root, "SOFA").disabled).toBe(true);
      expect(box(root, "SOFA").checked).toBe(false);
      expect(row(root, "LAMP").hasAttribute("is-blocked-by-method")).toBe(
        false
      );
      expect(hidden(root, "return-method")).toBe("ups-dropoff");
      expectComplexity(budget);

      await setMethod(root, "home-pickup");
      expect(row(root, "SOFA").hasAttribute("is-blocked-by-method")).toBe(
        false
      );
      expect(row(root, "SOFA").hasAttribute("is-eligible")).toBe(true);
      expect(box(root, "SOFA").disabled).toBe(false);
    });
  });

  describe("replace mode", () => {
    it("opens the components, judges lines by warranty and prices them as fees", async () => {
      const { root, quark } = await mount();
      const meter = measureComplexity(quark);
      await setMode(root, "replace");
      const budget = meter.take();
      meter.stop();

      expect(root.getAttribute("return-mode")).toBe("replace");
      expect(hidden(root, "mode")).toBe("replace");
      // components and bundles are replaceable
      for (const sku of [
        "SOFA",
        "SOFA-BASE",
        "SOFA-BACK",
        "SOFA-LEGS",
        "SHELF",
        "SHELF-SIDE",
      ]) {
        expect(row(root, sku).hasAttribute("is-eligible")).toBe(true);
        expect(box(root, sku).disabled).toBe(false);
      }
      // a final-sale item can still be replaced; an expired warranty cannot
      expect(row(root, "MATT").hasAttribute("is-eligible")).toBe(true);
      expect(row(root, "RUG").hasAttribute("is-eligible")).toBe(false);
      expect(box(root, "RUG").disabled).toBe(true);
      // members replace for free, guests pay the fee
      expect(row(root, "SOFA-BASE").getAttribute("line-amount")).toBe("0");
      expect(row(root, "LAMP").getAttribute("line-amount")).toBe("0");
      await setViewer(root, "guest");
      expect(row(root, "SOFA-BASE").getAttribute("line-amount")).toBe("79");
      expect(
        row(root, "SOFA-BASE").querySelector("[bind-amount]")?.textContent
      ).toBe("79");
      expect(row(root, "SOFA").getAttribute("line-amount")).toBe("129");
      expect(row(root, "LAMP").getAttribute("line-amount")).toBe("16");
      expectComplexity(budget);
    });

    it("selecting a component is a fact on its line and an aggregate on the host", async () => {
      const { root, quark } = await mount();
      await setMode(root, "replace");
      const meter = measureComplexity(quark);
      await tick(root, "SOFA-BASE");
      const budget = meter.take();
      meter.stop();

      expect(row(root, "SOFA-BASE").hasAttribute("is-selected")).toBe(
        true
      );
      expect(row(root, "SOFA").hasAttribute("is-selected")).toBe(false);
      expect(root.hasAttribute("has-selection")).toBe(true);
      expect(root.hasAttribute("has-bundle-selected")).toBe(true);
      expectComplexity(budget);

      await tick(root, "SOFA-BASE", false);
      expect(row(root, "SOFA-BASE").hasAttribute("is-selected")).toBe(
        false
      );
      expect(root.hasAttribute("has-selection")).toBe(false);
      expect(root.hasAttribute("has-bundle-selected")).toBe(false);
    });

    it("selecting a part locks the whole bundle, and back", async () => {
      const { root } = await mount();
      await setMode(root, "replace");
      await tick(root, "SOFA-BACK");
      expect(row(root, "SOFA").hasAttribute("is-locked-by-part")).toBe(true);
      expect(row(root, "SOFA").hasAttribute("is-eligible")).toBe(false);
      expect(box(root, "SOFA").disabled).toBe(true);
      await tick(root, "SOFA-BACK", false);
      expect(row(root, "SOFA").hasAttribute("is-locked-by-part")).toBe(false);
      expect(row(root, "SOFA").hasAttribute("is-eligible")).toBe(true);
      expect(box(root, "SOFA").disabled).toBe(false);
    });

    it("selecting the whole bundle locks and unticks its components", async () => {
      const { root } = await mount();
      await setMode(root, "replace");
      await tick(root, "SOFA");
      for (const sku of ["SOFA-BASE", "SOFA-BACK", "SOFA-LEGS"]) {
        expect(row(root, sku).hasAttribute("is-locked-by-bundle")).toBe(
          true
        );
        expect(row(root, sku).hasAttribute("is-eligible")).toBe(false);
        expect(row(root, sku).hasAttribute("is-selected")).toBe(false);
        expect(box(root, sku).disabled).toBe(true);
        expect(box(root, sku).checked).toBe(false);
      }
      expect(root.hasAttribute("has-bundle-selected")).toBe(true);

      await tick(root, "SOFA", false);
      for (const sku of ["SOFA-BASE", "SOFA-BACK", "SOFA-LEGS"]) {
        expect(row(root, sku).hasAttribute("is-locked-by-bundle")).toBe(
          false
        );
        expect(row(root, sku).hasAttribute("is-eligible")).toBe(true);
        expect(box(root, sku).disabled).toBe(false);
      }
      expect(root.hasAttribute("has-bundle-selected")).toBe(false);
    });

    it("the method blocks components by their own facts", async () => {
      const { root } = await mount();
      await setMode(root, "replace");
      await tick(root, "SOFA-BASE");
      await setMethod(root, "ups-dropoff");
      // the 40 kg base is oversized, the 9 kg cushions are not
      expect(
        row(root, "SOFA-BASE").hasAttribute("is-blocked-by-method")
      ).toBe(true);
      expect(row(root, "SOFA-BASE").hasAttribute("is-selected")).toBe(
        false
      );
      expect(box(root, "SOFA-BASE").checked).toBe(false);
      expect(
        row(root, "SOFA-BACK").hasAttribute("is-blocked-by-method")
      ).toBe(false);
      await setMethod(root, "store-dropoff");
      // the base is assembled, the cushions are not
      expect(
        row(root, "SOFA-BASE").hasAttribute("is-blocked-by-method")
      ).toBe(true);
      expect(
        row(root, "SOFA-BACK").hasAttribute("is-blocked-by-method")
      ).toBe(false);
      expect(row(root, "SOFA-BACK").hasAttribute("is-eligible")).toBe(
        true
      );
    });

    it("going back to return mode drops the component selection", async () => {
      const { root } = await mount();
      await setMode(root, "replace");
      await tick(root, "SOFA-LEGS");
      await setMode(root, "return");
      expect(row(root, "SOFA-LEGS").hasAttribute("is-eligible")).toBe(
        false
      );
      expect(row(root, "SOFA-LEGS").hasAttribute("is-selected")).toBe(
        false
      );
      expect(box(root, "SOFA-LEGS").checked).toBe(false);
      expect(root.hasAttribute("has-selection")).toBe(false);
      expect(root.hasAttribute("has-bundle-selected")).toBe(false);
    });
  });

  describe("home pickup for guests", () => {
    it("is closed until a bundle or one of its components is selected", async () => {
      const { root } = await mount();
      await setViewer(root, "guest");
      expect(root.getAttribute("home-pickup-block")).toBe("members-only");
      expect(radio(root, "return-method", "home-pickup").disabled).toBe(
        true
      );
      // the method that just closed falls back to UPS
      expect(root.getAttribute("return-method")).toBe("ups-dropoff");
      expect(radio(root, "return-method", "ups-dropoff").checked).toBe(
        true
      );
      expect(hidden(root, "return-method")).toBe("ups-dropoff");

      // a plain item does not open it
      await tick(root, "LAMP");
      expect(root.getAttribute("home-pickup-block")).toBe("members-only");

      // a bundle does
      await tick(root, "SOFA");
      expect(root.hasAttribute("has-bundle-selected")).toBe(true);
      expect(root.hasAttribute("home-pickup-block")).toBe(false);
      expect(radio(root, "return-method", "home-pickup").disabled).toBe(
        false
      );
      await setMethod(root, "home-pickup");
      expect(root.getAttribute("return-method")).toBe("home-pickup");

      // dropping the bundle closes it again and the method falls back
      await tick(root, "SOFA", false);
      expect(root.getAttribute("home-pickup-block")).toBe("members-only");
      expect(root.getAttribute("return-method")).toBe("ups-dropoff");
      expect(radio(root, "return-method", "home-pickup").disabled).toBe(
        true
      );
    });

    it("a component opens it too, and a member never needs one", async () => {
      const { root } = await mount();
      await setViewer(root, "guest");
      await setMode(root, "replace");
      await tick(root, "SOFA-LEGS");
      expect(root.hasAttribute("home-pickup-block")).toBe(false);
      expect(radio(root, "return-method", "home-pickup").disabled).toBe(
        false
      );
      await tick(root, "SOFA-LEGS", false);
      expect(root.getAttribute("home-pickup-block")).toBe("members-only");
      await setViewer(root, "member");
      expect(root.hasAttribute("home-pickup-block")).toBe(false);
      expect(radio(root, "return-method", "home-pickup").disabled).toBe(
        false
      );
    });
  });

  describe("the date", () => {
    it("closes home pickup and store drop-off on weekends", async () => {
      const { root, quark } = await mount();
      const meter = measureComplexity(quark);
      await setDate(root, "2026-09-12");
      const budget = meter.take();
      meter.stop();

      expect(root.getAttribute("pickup-date")).toBe("2026-09-12");
      expect(root.getAttribute("pickup-weekday")).toBe("Sat");
      expect(root.querySelector("[bind-pickup-weekday]")?.textContent).toBe(
        "Sat"
      );
      expect(root.hasAttribute("is-weekend")).toBe(true);
      expect(root.getAttribute("home-pickup-block")).toBe("weekend");
      expect(root.getAttribute("store-dropoff-block")).toBe("weekend");
      expect(radio(root, "return-method", "home-pickup").disabled).toBe(
        true
      );
      expect(radio(root, "return-method", "store-dropoff").disabled).toBe(
        true
      );
      expect(radio(root, "return-method", "ups-dropoff").disabled).toBe(
        false
      );
      expect(root.getAttribute("return-method")).toBe("ups-dropoff");
      expect(hidden(root, "pickup-date")).toBe("2026-09-12");
      expectComplexity(budget);

      await setDate(root, "2026-09-14");
      expect(root.getAttribute("pickup-weekday")).toBe("Mon");
      expect(root.hasAttribute("is-weekend")).toBe(false);
      expect(root.hasAttribute("home-pickup-block")).toBe(false);
      expect(root.hasAttribute("store-dropoff-block")).toBe(false);
      expect(radio(root, "return-method", "home-pickup").disabled).toBe(
        false
      );
      expect(radio(root, "return-method", "store-dropoff").disabled).toBe(
        false
      );
      await setMethod(root, "store-dropoff");
      expect(root.getAttribute("return-method")).toBe("store-dropoff");

      // Sunday closes the store again
      await setDate(root, "2026-09-13");
      expect(root.getAttribute("pickup-weekday")).toBe("Sun");
      expect(root.getAttribute("return-method")).toBe("ups-dropoff");
    });

    it("clearing the date clears its facts", async () => {
      const { root } = await mount();
      await setDate(root, "2026-09-12");
      await setDate(root, "");
      expect(root.hasAttribute("pickup-date")).toBe(false);
      expect(root.hasAttribute("pickup-weekday")).toBe(false);
      expect(root.hasAttribute("is-weekend")).toBe(false);
      expect(root.hasAttribute("home-pickup-block")).toBe(false);
      expect(hidden(root, "pickup-date")).toBe("");
    });

    it("the weekend reason yields to the membership reason once a weekday is picked", async () => {
      const { root } = await mount();
      await setViewer(root, "guest");
      await setDate(root, "2026-09-12");
      expect(root.getAttribute("home-pickup-block")).toBe("weekend");
      await setDate(root, "2026-09-14");
      expect(root.getAttribute("home-pickup-block")).toBe("members-only");
      await tick(root, "SOFA");
      expect(root.hasAttribute("home-pickup-block")).toBe(false);
      await setDate(root, "2026-09-12");
      expect(root.getAttribute("home-pickup-block")).toBe("weekend");
      await setViewer(root, "member");
      expect(root.getAttribute("home-pickup-block")).toBe("weekend");
    });

    it("a weekend can cascade: forced to UPS, the oversized part is dropped, and pickup closes for the guest", async () => {
      const { root } = await mount();
      await setViewer(root, "guest");
      await setMode(root, "replace");
      await tick(root, "SOFA-BASE");
      await setMethod(root, "home-pickup");
      expect(root.getAttribute("return-method")).toBe("home-pickup");

      await setDate(root, "2026-09-12");
      expect(root.getAttribute("return-method")).toBe("ups-dropoff");
      expect(
        row(root, "SOFA-BASE").hasAttribute("is-blocked-by-method")
      ).toBe(true);
      expect(row(root, "SOFA-BASE").hasAttribute("is-selected")).toBe(
        false
      );
      expect(root.hasAttribute("has-bundle-selected")).toBe(false);
      expect(root.getAttribute("home-pickup-block")).toBe("weekend");

      await setDate(root, "2026-09-14");
      expect(root.getAttribute("home-pickup-block")).toBe("members-only");
      expect(radio(root, "return-method", "home-pickup").disabled).toBe(
        true
      );
    });
  });

  describe("the request", () => {
    it("is gated on a selection and a date, each with its reason", async () => {
      const { root } = await mount();
      expect(submit(root).disabled).toBe(true);
      expect(summary(root).getAttribute("disabled-reason")).toBe(
        "Pick at least one line"
      );
      await tick(root, "LAMP");
      expect(submit(root).disabled).toBe(true);
      expect(summary(root).getAttribute("disabled-reason")).toBe(
        "Pick a date"
      );
      await setDate(root, "2026-09-14");
      expect(submit(root).disabled).toBe(false);
      expect(summary(root).hasAttribute("disabled-reason")).toBe(false);
      await tick(root, "LAMP", false);
      expect(submit(root).disabled).toBe(true);
      expect(summary(root).getAttribute("disabled-reason")).toBe(
        "Pick at least one line"
      );
    });

    it("posts the lines with the host facts and paints the confirmation", async () => {
      const { root } = await mount();
      await setMode(root, "replace");
      await setViewer(root, "guest");
      await tick(root, "SOFA-LEGS");
      await setDate(root, "2026-09-14");
      await setMethod(root, "home-pickup");

      const spy = spyFetch({
        status: 201,
        body: JSON.stringify({
          rma: "RMA-1",
          mode: "replace",
          itemCount: 1,
          amount: 19,
          method: "home pickup",
          date: "2026-09-14",
        }),
      });
      const superForm = root.querySelector<HTMLSuperFormElement>("super-form")!;
      await waitForEvent(superForm, "super-form-success", () => {
        superForm
          .getFormElement()!
          .dispatchEvent(new Event("submit", { bubbles: true }));
      });
      await settle();

      const [input, init] = spy.mock.calls.at(-1)!;
      const body = JSON.parse(
        init?.body ? String(init.body) : await (input as Request).text()
      );
      // unticked boxes serialize as false; the mock keeps only truthy skus
      expect(body).toMatchObject({
        "SOFA-LEGS": true,
        SOFA: false,
        mode: "replace",
        membership: "guest",
        "return-method": "home-pickup",
        "pickup-date": "2026-09-14",
      });
      expect(root.querySelector("[bind-confirmation]")?.textContent).toBe(
        "Return RMA-1 created for 1 line(s) — replace, $19 via home pickup on 2026-09-14."
      );
    });
  });
});
