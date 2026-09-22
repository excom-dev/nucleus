import "@excom/event-handler";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  click,
  flush,
  mountView,
  readDemo,
} from "@excom/quark/support/tests/view-helpers";

describe("disappear view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens then auto-closes after disappear-after", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "disappear"));
    const drawer = root.querySelector("content-drawer")!;
    expect(drawer.getAttribute("disappear-after")).toBe("2");
    click(root.querySelector("button[command]"));
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);
    await wait(2100);
    expect(drawer.hasAttribute("is-open")).toBe(false);
  });
});
