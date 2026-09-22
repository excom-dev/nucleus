import "@excom/content-drawer";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  click,
  flush,
  mountView,
  readDemo,
} from "@excom/quark/support/tests/view-helpers";

describe("enter-close view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens the drawer and closes on Enter", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "enter-close"));
    const drawer = root.querySelector("content-drawer")!;
    expect(drawer.hasAttribute("is-open")).toBe(true);
    const input = root.querySelector("input")!;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter", keyCode: 13 }),
    );
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(false);
    click(root.querySelector("event-handler"));
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);
  });
});
