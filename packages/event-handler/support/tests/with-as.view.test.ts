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

describe("with-as view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("toggles the drawer", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "with-as"));
    const drawer = root.querySelector("content-drawer")!;
    click(root.querySelector("event-handler"));
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);
    click(root.querySelector("event-handler"));
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(false);
  });
});
