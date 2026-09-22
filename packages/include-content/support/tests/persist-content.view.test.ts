import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { flush, mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("persist-content view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps typed value across deactivate", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "persist-content"));
    const include = root.querySelector("include-content")!;
    const input = include.querySelector("input")!;
    input.value = "kept";
    const checkbox = root.querySelector<HTMLInputElement>(
      'input[name="is-active"]',
    )!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(include.hasAttribute("is-active")).toBe(false);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(include.querySelector("input")?.value).toBe("kept");
  });
});
