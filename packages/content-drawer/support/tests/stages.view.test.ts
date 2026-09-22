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

describe("stages view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens at full, half, and peek stages", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "stages"));
    const drawer = root.querySelector("content-drawer")!;
    const buttons = root.querySelectorAll("button[command]");
    click(buttons[0]);
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);
    expect(drawer.getAttribute("open-stage")).toBe("0");
    click(buttons[1]);
    await flush();
    expect(drawer.getAttribute("open-stage")).toBe("1");
    click(buttons[2]);
    await flush();
    expect(drawer.getAttribute("open-stage")).toBe("2");
    click(drawer.querySelector("[rel='prev']"));
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(false);
  });
});
