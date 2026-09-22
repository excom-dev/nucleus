import { invokeCommand } from "@excom/neutron";
import "@excom/quark-sheet";
import "@excom/event-handler";
import "@excom/content-drawer";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  flush,
  mountView,
  readDemo,
} from "@excom/quark/support/tests/view-helpers";

const outsideMouseup = (target: EventTarget) =>
  target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

describe("drawer view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens the drawer, then dismisses on outside click and on Escape", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "drawer"));
    const drawer = root.querySelector("content-drawer")!;
    const watcher = drawer.querySelector("dismiss-watcher")!;
    const button = root.querySelector<HTMLButtonElement>("button[command]")!;
    expect(button.getAttribute("command")).toBe("--open");
    // happy-dom has no Command API: dispatch what the button would have
    const open = () => invokeCommand(drawer, "--open", button);
    expect(drawer.firstElementChild).toBe(watcher);
    expect(drawer.hasAttribute("is-open")).toBe(false);
    expect(watcher.hasAttribute("is-active")).toBe(false);

    open();
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);
    expect(watcher.hasAttribute("is-active")).toBe(true);
    expect(watcher._closeWatcher).toBeTruthy();

    // inside the drawer: stays open
    outsideMouseup(drawer.querySelector("h2")!);
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);

    // outside: `--close` is invoked on the drawer, inverse rule deactivates
    outsideMouseup(document.body);
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(false);
    expect(watcher.hasAttribute("is-active")).toBe(false);
    expect(watcher._closeWatcher).toBeNull();

    // open, not toggle: a mouseup on the trigger closes, the click re-opens
    open();
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);
    outsideMouseup(button);
    await flush();
    open();
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);

    watcher._closeWatcher!.requestClose();
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(false);
    expect(watcher.hasAttribute("is-active")).toBe(false);
  });
});
