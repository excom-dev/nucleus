import "@excom/include-content";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { flush, mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("render-event view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("activates include-content from the checkbox", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "render-event"));
    const include = root.querySelector("include-content")!;
    const checkbox = root.querySelector<HTMLInputElement>("input[type='checkbox']")!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(include.hasAttribute("is-active") || include.textContent).toBeTruthy();
  });
});
