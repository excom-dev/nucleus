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

describe("command-dialog view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("wires show-modal at the sibling dialog", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "command-dialog"));
    const opener = root.querySelector("event-handler")!;
    const dialog = root.querySelector("dialog")!;
    expect(opener.getAttribute("command-name")).toBe("show-modal");
    expect(opener.getAttribute("target-ref")).toBe(":scope + dialog");
    expect(dialog.open).toBe(false);

    click(opener);
    await flush();
    // happy-dom has no Command Invokers API (`button.command` /
    // `commandForElement`), which is how event-handler invokes commands.
    expect(dialog.open).toBe(false);
  });
});
