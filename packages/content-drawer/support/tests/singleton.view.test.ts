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

describe("singleton view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opening B closes A", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "singleton"));
    const a = root.querySelector("#drawer-a")!;
    const b = root.querySelector("#drawer-b")!;
    const [openA, openB] = root.querySelectorAll("button[command]");
    click(openA);
    await flush();
    expect(a.hasAttribute("is-open")).toBe(true);
    expect(b.hasAttribute("is-open")).toBe(false);
    click(openB);
    await flush();
    expect(a.hasAttribute("is-open")).toBe(false);
    expect(b.hasAttribute("is-open")).toBe(true);
  });
});
