import "@excom/quark-sheet";
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

const outsideMouseup = (target: EventTarget) =>
  target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens the menu, then dismisses on outside click and on Escape", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "simple"));
    const watcher = root.querySelector("dismiss-watcher")!;
    const button = root.querySelector("[role='button']")!;
    expect(root.hasAttribute("data-is-open")).toBe(false);
    expect(watcher.hasAttribute("is-active")).toBe(false);

    click(button);
    await flush();
    expect(root.hasAttribute("data-is-open")).toBe(true);
    expect(watcher.hasAttribute("is-active")).toBe(true);

    // inside the panel: stays open
    outsideMouseup(root.querySelector("nav a")!);
    await flush();
    expect(root.hasAttribute("data-is-open")).toBe(true);

    // outside: closes, and the inverse rule deactivates the watcher
    outsideMouseup(document.body);
    await flush();
    expect(root.hasAttribute("data-is-open")).toBe(false);
    expect(watcher.hasAttribute("is-active")).toBe(false);
    expect(watcher._closeWatcher).toBeNull();

    click(button);
    await flush();
    expect(root.hasAttribute("data-is-open")).toBe(true);
    watcher._closeWatcher!.requestClose();
    await flush();
    expect(root.hasAttribute("data-is-open")).toBe(false);
    expect(watcher.hasAttribute("is-active")).toBe(false);
  });
});
