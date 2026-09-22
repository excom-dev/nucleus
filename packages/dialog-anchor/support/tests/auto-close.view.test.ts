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

describe("auto-close view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("closes the dialog on simulated submit success", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "auto-close"));
    const dialog = root.querySelector("dialog")!;
    click(root.querySelector("[target-ref]"));
    await flush();
    expect(dialog.open).toBe(true);
    click(dialog.querySelector("[role='button']"));
    await flush();
    expect(dialog.open).toBe(false);
  });
});
