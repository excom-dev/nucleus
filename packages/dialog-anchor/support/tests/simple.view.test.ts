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

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens and closes the dialog", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "simple"));
    const dialog = root.querySelector("dialog")!;
    expect(dialog.open).toBe(false);
    click(root.querySelector("[target-ref]"));
    await flush();
    expect(dialog.open).toBe(true);
    click(dialog.querySelector("dialog-anchor"));
    await flush();
    expect(dialog.open).toBe(false);
  });
});
