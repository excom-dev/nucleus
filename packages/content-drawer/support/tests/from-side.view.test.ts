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

describe("from-side view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("toggles a left-side drawer", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "from-side"));
    const drawer = root.querySelector("content-drawer")!;
    expect(drawer.getAttribute("from-side")).toBe("left");
    click(root.querySelector("button[command]"));
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);
    click(root.querySelector(".tag-backdrop"));
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(false);
  });
});
