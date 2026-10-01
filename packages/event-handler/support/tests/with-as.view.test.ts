import "@excom/content-drawer";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import {
  click,
  flush,
  mountView,
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
