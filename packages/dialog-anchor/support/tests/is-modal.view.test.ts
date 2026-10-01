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

describe("is-modal view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens modal and non-modal", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "is-modal"));
    const dialog = root.querySelector("dialog")!;
    const [modalBtn, modelessBtn] = root.querySelectorAll(
      "dialog-anchor[target-ref]",
    );
    click(modalBtn);
    await flush();
    expect(dialog.open).toBe(true);
    dialog.close();
    click(modelessBtn);
    await flush();
    expect(dialog.open).toBe(true);
  });
});
