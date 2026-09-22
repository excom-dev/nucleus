import "@excom/quark-sheet";
import "@excom/event-handler";
import "@excom/dismiss-watcher";
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

const outsideMouseup = (target: EventTarget) =>
  target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

describe("dismiss view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("dismisses the drawer on outside click and Escape through dismiss-watcher", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "dismiss"));
    const drawer = root.querySelector("content-drawer")!;
    const watcher = drawer.querySelector("dismiss-watcher")!;
    expect(drawer.hasAttribute("is-modal")).toBe(false);
    expect(watcher.hasAttribute("is-active")).toBe(false);

    click(root.querySelector("button[command]"));
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);
    expect(watcher.hasAttribute("is-active")).toBe(true);

    outsideMouseup(drawer.querySelector("nav")!);
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);

    outsideMouseup(document.body);
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(false);
    expect(watcher.hasAttribute("is-active")).toBe(false);

    click(root.querySelector("button[command]"));
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);
    watcher._closeWatcher!.requestClose();
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(false);

    // the overlay still closes it
    click(root.querySelector("button[command]"));
    await flush();
    click(root.querySelector(".tag-backdrop"));
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(false);
  });
});
