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

describe("sticky-header view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("jumps to section 3 on click", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "sticky-header"));
    const target = root.querySelector("#section-3")!;
    click(root.querySelector("[role='button']"));
    await flush();
    expect(target).toBeTruthy();
  });
});
