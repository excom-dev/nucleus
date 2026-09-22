import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { flush, mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

const isFilteredOut = (tr: HTMLElement) =>
  tr.style.getPropertyValue("--data-tr-display") === "none";

describe("filter view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("filters rows as the user types", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "filter"));
    const input = root.querySelector<HTMLInputElement>(
      'input[name="filterValue"]',
    )!;
    input.value = "Bea";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    const rows = [...root.querySelectorAll("data-tbody data-tr")] as HTMLElement[];
    const visible = rows.filter((row) => !isFilteredOut(row));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((row) => row.textContent?.includes("Bea"))).toBe(true);
    expect(rows.some(isFilteredOut)).toBe(true);
  });
});
