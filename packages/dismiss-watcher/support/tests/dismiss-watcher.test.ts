import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";

const outsideMouseup = (target: EventTarget = document.body) =>
  target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

/** `<div><nav><dismiss-watcher …></dismiss-watcher></nav><button></button></div>` */
const mountPanel = (attrs = "is-active") => {
  const root = fixture<HTMLDivElement>(
    `<div>
       <nav><dismiss-watcher ${attrs}></dismiss-watcher></nav>
       <button type="button">outside</button>
     </div>`
  );
  const nav = root.querySelector("nav")!;
  const watcher = root.querySelector("dismiss-watcher")!;
  const outside = root.querySelector("button")!;
  const dismiss = vi.fn();
  root.addEventListener("dismiss-watcher-dismiss", dismiss);
  return { root, nav, watcher, outside, dismiss };
};

describe("dismiss-watcher", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("never renders children", () => {
    const { watcher } = mountPanel();
    expect(watcher).dom.to.equalTag(
      `<dismiss-watcher is-active></dismiss-watcher>`
    );
    expect(watcher.childNodes.length).toBe(0);
  });

  it("fires dismiss with reason outside-click and dispatches fire-event at the target", async () => {
    const { nav, watcher, outside, dismiss } = mountPanel(
      `is-active fire-event="menu-close"`
    );
    const menuClose = vi.fn();
    nav.addEventListener("menu-close", menuClose);

    outsideMouseup(outside);
    expect(dismiss).toHaveBeenCalledTimes(1);
    const event = dismiss.mock.calls[0][0] as CustomEvent;
    expect(event.target).toBe(watcher);
    expect(event.bubbles).toBe(true);
    expect(event.cancelable).toBe(true);
    expect(event.detail).toEqual({ reason: "outside-click" });

    // default action runs in the next task
    expect(menuClose).not.toHaveBeenCalled();
    await wait(0);
    expect(menuClose).toHaveBeenCalledTimes(1);
    const fired = menuClose.mock.calls[0][0] as CustomEvent;
    expect(fired.target).toBe(nav);
    expect(fired.bubbles).toBe(true);
  });

  it("invokes every command-name on the target, before fire-event", async () => {
    const { nav, outside } = mountPanel(
      `is-active command-name="--close --blur" fire-event="menu-close"`
    );
    const seen: string[] = [];
    nav.addEventListener("command", (e) => {
      const { command, source, bubbles } = e as Event & {
        command: string;
        source: Element | null;
      };
      expect(bubbles).toBe(false);
      expect(source).toBe(nav.querySelector("dismiss-watcher"));
      seen.push(command);
    });
    nav.addEventListener("menu-close", (e) => seen.push(e.type));
    outsideMouseup(outside);
    await wait(0);
    expect(seen).toEqual(["--close", "--blur", "menu-close"]);
  });

  it("dispatches every fire-event token", async () => {
    const { nav, outside } = mountPanel(
      `is-active fire-event="menu-close menu-blur"`
    );
    const seen: string[] = [];
    nav.addEventListener("menu-close", (e) => seen.push(e.type));
    nav.addEventListener("menu-blur", (e) => seen.push(e.type));
    outsideMouseup(outside);
    await wait(0);
    expect(seen).toEqual(["menu-close", "menu-blur"]);
  });

  it("ignores a mouseup inside the target", async () => {
    const { nav, dismiss } = mountPanel(`is-active fire-event="menu-close"`);
    const menuClose = vi.fn();
    nav.addEventListener("menu-close", menuClose);
    const inner = document.createElement("a");
    nav.append(inner);
    outsideMouseup(inner);
    outsideMouseup(nav);
    await wait(0);
    expect(dismiss).not.toHaveBeenCalled();
    expect(menuClose).not.toHaveBeenCalled();
  });

  it("fires dismiss with reason escape through the CloseWatcher", async () => {
    const { nav, watcher, dismiss } = mountPanel(
      `is-active fire-event="menu-close"`
    );
    const menuClose = vi.fn();
    nav.addEventListener("menu-close", menuClose);
    expect(watcher._closeWatcher).toBeTruthy();

    // the shim only reacts to trusted Escape keydowns
    const keydown = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(keydown, "isTrusted", { value: true });
    document.dispatchEvent(keydown);
    await wait(0);

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect((dismiss.mock.calls[0][0] as CustomEvent).detail).toEqual({
      reason: "escape",
    });
    await wait(0);
    expect(menuClose).toHaveBeenCalledTimes(1);
  });

  it("re-arms the CloseWatcher after Escape so a cancelled dismissal keeps working", async () => {
    const { root, watcher, dismiss } = mountPanel(`is-active`);
    root.addEventListener("dismiss-watcher-dismiss", (e) =>
      e.preventDefault()
    );
    const first = watcher._closeWatcher!;
    first.requestClose();
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(watcher._closeWatcher).toBeTruthy();
    expect(watcher._closeWatcher).not.toBe(first);
    watcher._closeWatcher!.requestClose();
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it("preventDefault() on dismiss skips fire-event", async () => {
    const { root, nav, outside, dismiss } = mountPanel(
      `is-active fire-event="menu-close"`
    );
    const menuClose = vi.fn();
    nav.addEventListener("menu-close", menuClose);
    root.addEventListener("dismiss-watcher-dismiss", (e) =>
      e.preventDefault()
    );
    outsideMouseup(outside);
    expect(dismiss).toHaveBeenCalledTimes(1);
    await wait(0);
    expect(menuClose).not.toHaveBeenCalled();
  });

  it("resolves target-ref relative to :scope", async () => {
    const root = fixture<HTMLDivElement>(
      `<div>
         <dismiss-watcher is-active target-ref=":scope + nav" fire-event="menu-close"></dismiss-watcher>
         <nav><a href="#">inside</a></nav>
         <button type="button">outside</button>
       </div>`
    );
    const nav = root.querySelector("nav")!;
    const menuClose = vi.fn();
    nav.addEventListener("menu-close", menuClose);
    const dismiss = vi.fn();
    root.addEventListener("dismiss-watcher-dismiss", dismiss);

    // inside the resolved target: nothing
    outsideMouseup(nav.querySelector("a")!);
    expect(dismiss).not.toHaveBeenCalled();
    // outside it, even though the click is inside the watcher's parent
    outsideMouseup(root.querySelector("button")!);
    expect(dismiss).toHaveBeenCalledTimes(1);
    await wait(0);
    expect(menuClose).toHaveBeenCalledTimes(1);
    expect((menuClose.mock.calls[0][0] as Event).target).toBe(nav);
  });

  it("does nothing without a resolvable target", async () => {
    const root = fixture<HTMLDivElement>(
      `<div>
         <dismiss-watcher is-active target-ref=":scope + nav" fire-event="menu-close"></dismiss-watcher>
         <button type="button">outside</button>
       </div>`
    );
    const dismiss = vi.fn();
    root.addEventListener("dismiss-watcher-dismiss", dismiss);
    outsideMouseup(root.querySelector("button")!);
    await wait(0);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("adds the document listener and a CloseWatcher when is-active is set", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const { watcher } = mountPanel("");
    expect(watcher._closeWatcher).toBeFalsy();
    expect(addSpy).not.toHaveBeenCalledWith(
      "mouseup",
      watcher._handleOutsideMouseup,
      expect.anything()
    );
    watcher.isActive = true;
    expect(addSpy).toHaveBeenCalledWith(
      "mouseup",
      watcher._handleOutsideMouseup,
      expect.anything()
    );
    expect(watcher._closeWatcher).toBeTruthy();
  });

  it("removes the document listener and destroys the watcher when is-active is unset", () => {
    const { watcher, outside, dismiss } = mountPanel();
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const closeWatcher = watcher._closeWatcher!;
    const destroySpy = vi.spyOn(closeWatcher, "destroy");
    const unlistenSpy = vi.spyOn(closeWatcher, "removeEventListener");

    watcher.removeAttribute("is-active");
    expect(removeSpy).toHaveBeenCalledWith(
      "mouseup",
      watcher._handleOutsideMouseup,
      expect.anything()
    );
    expect(unlistenSpy).toHaveBeenCalledWith("close", watcher._handleClose);
    expect(destroySpy).toHaveBeenCalled();
    expect(watcher._closeWatcher).toBeNull();

    outsideMouseup(outside);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("tears down on a genuine disconnect", async () => {
    const { watcher, dismiss } = mountPanel();
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const destroySpy = vi.spyOn(watcher._closeWatcher!, "destroy");
    watcher.remove();
    await wait(0);
    expect(removeSpy).toHaveBeenCalledWith(
      "mouseup",
      watcher._handleOutsideMouseup,
      expect.anything()
    );
    expect(destroySpy).toHaveBeenCalled();
    expect(watcher._closeWatcher).toBeNull();
    outsideMouseup();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("keeps both watchers across a synchronous DOM move", async () => {
    const { root, watcher, outside, dismiss } = mountPanel();
    const closeWatcher = watcher._closeWatcher!;
    const destroySpy = vi.spyOn(closeWatcher, "destroy");
    const home = document.createElement("aside");
    root.append(home);
    home.append(watcher); // disconnect + connect in the same tick = move
    await wait(0);
    expect(destroySpy).not.toHaveBeenCalled();
    expect(watcher._closeWatcher).toBe(closeWatcher);
    // the tracked document listener is restored: target is now `home`
    outsideMouseup(outside);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("rebuilds on a genuine reconnect", async () => {
    const { root, nav, watcher, outside, dismiss } = mountPanel();
    watcher.remove();
    await wait(0);
    expect(watcher._closeWatcher).toBeNull();
    const addSpy = vi.spyOn(document, "addEventListener");
    nav.append(watcher);
    await wait(0);
    expect(addSpy).toHaveBeenCalledWith(
      "mouseup",
      watcher._handleOutsideMouseup,
      expect.anything()
    );
    expect(watcher._closeWatcher).toBeTruthy();
    outsideMouseup(outside);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(root.contains(watcher)).toBe(true);
  });

  it("watches both when neither watch-* attribute is present", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const { watcher } = mountPanel("is-active");
    expect(watcher._closeWatcher).toBeTruthy();
    expect(addSpy).toHaveBeenCalledWith(
      "mouseup",
      watcher._handleOutsideMouseup,
      expect.anything()
    );
  });

  it("watch-escape alone skips the document listener", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const { watcher, outside, dismiss } = mountPanel("is-active watch-escape");
    expect(watcher._closeWatcher).toBeTruthy();
    expect(addSpy).not.toHaveBeenCalledWith(
      "mouseup",
      watcher._handleOutsideMouseup,
      expect.anything()
    );
    outsideMouseup(outside);
    expect(dismiss).not.toHaveBeenCalled();
    watcher._closeWatcher!.requestClose();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("watch-outside-click alone skips the CloseWatcher", () => {
    const { watcher, outside, dismiss } = mountPanel(
      "is-active watch-outside-click"
    );
    expect(watcher._closeWatcher).toBeFalsy();
    outsideMouseup(outside);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect((dismiss.mock.calls[0][0] as CustomEvent).detail.reason).toBe(
      "outside-click"
    );
  });

  it("re-applies when watch-* changes while active", () => {
    const { watcher, outside, dismiss } = mountPanel("is-active");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const destroySpy = vi.spyOn(watcher._closeWatcher!, "destroy");

    watcher.setAttribute("watch-escape", "");
    expect(removeSpy).toHaveBeenCalledWith(
      "mouseup",
      watcher._handleOutsideMouseup,
      expect.anything()
    );
    outsideMouseup(outside);
    expect(dismiss).not.toHaveBeenCalled();
    expect(destroySpy).not.toHaveBeenCalled();

    watcher.removeAttribute("watch-escape");
    watcher.setAttribute("watch-outside-click", "");
    expect(destroySpy).toHaveBeenCalled();
    expect(watcher._closeWatcher).toBeNull();
    outsideMouseup(outside);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("does not re-apply when watch-* changes while inactive", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const { watcher } = mountPanel("");
    watcher.setAttribute("watch-outside-click", "");
    expect(addSpy).not.toHaveBeenCalledWith(
      "mouseup",
      watcher._handleOutsideMouseup,
      expect.anything()
    );
    expect(watcher._closeWatcher).toBeFalsy();
  });
});
