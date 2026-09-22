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

describe("escape-close view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("wires show-modal and Escape-to-close commands", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "escape-close"));
    const [opener, closer] = [...root.querySelectorAll("event-handler")];
    const dialog = root.querySelector("dialog")!;
    expect(opener.getAttribute("command-name")).toBe("show-modal");
    expect(closer.getAttribute("command-name")).toBe("close");
    expect(closer.getAttribute("host-ref")).toBe("window");
    expect(closer.getAttribute("keycode-filter")).toBe("escape");

    click(opener);
    await flush();
    // Same Command Invokers gap as command-dialog: click and Escape
    // don't move `dialog.open` under happy-dom.
    expect(dialog.open).toBe(false);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Escape",
        keyCode: 27,
      }),
    );
    await flush();
    expect(dialog.open).toBe(false);
  });
});
