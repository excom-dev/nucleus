import "@excom/event-handler";
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

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("toggles the bottom sheet and closes from the header", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "simple"));
    const drawer = root.querySelector("content-drawer")!;
    // bottom is the default: no from-side needed
    expect(drawer.hasAttribute("from-side")).toBe(false);
    expect(drawer.hasAttribute("is-open")).toBe(false);
    click(root.querySelector("button[command]"));
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);
    click(drawer.querySelector("[rel='prev']"));
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(false);
    click(root.querySelector("button[command]"));
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);
    click(root.querySelector(".tag-backdrop"));
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(false);
  });
});
