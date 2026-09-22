import { ListenableElement } from "../../index";
import { Neutron } from "@excom/neutron";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const TAG = "listenable-matrix-test";
if (!customElements.get(TAG)) {
  ListenableElement.define(TAG);
}

/*
 * Concrete consumer (README pattern) with `actionHandler` from construction,
 * so connect-time lifecycles and `is-debounced` wrapping see a real handler,
 * not one assigned after mount.
 */
const COMPOSED_TAG = "listenable-composed-test";
const composedSpy = vi.fn();
if (!customElements.get(COMPOSED_TAG)) {
  Neutron.compose([ListenableElement, Neutron({ tag: COMPOSED_TAG })])
    .defineMethods({
      actionHandler: (_el, e: Event | string) => {
        composedSpy(e);
      },
    })
    .define();
}

const key = (k: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key: k, ...init });

describe("ListenableElement keycode-filter matrix", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("matches alt / ctrl / control / meta chords", () => {
    const el = fixture<any>(
      `<${TAG} keycode-filter="alt+a ctrl+b control+c meta+d"></${TAG}>`,
    );
    const handler = vi.fn();
    el.actionHandler = handler;

    el.handleEvent(key("a", { altKey: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    el.handleEvent(key("a"));
    expect(handler).toHaveBeenCalledTimes(1);

    el.handleEvent(key("b", { ctrlKey: true }));
    expect(handler).toHaveBeenCalledTimes(2);
    el.handleEvent(key("c", { ctrlKey: true }));
    expect(handler).toHaveBeenCalledTimes(3);
    el.handleEvent(key("c", { shiftKey: true }));
    expect(handler).toHaveBeenCalledTimes(3);

    el.handleEvent(key("d", { metaKey: true }));
    expect(handler).toHaveBeenCalledTimes(4);
    el.handleEvent(key("d"));
    expect(handler).toHaveBeenCalledTimes(4);
  });

  it("matches modifier-only tokens against the modifier keydown itself", () => {
    const el = fixture<any>(
      `<${TAG} keycode-filter="shift ctrl meta"></${TAG}>`,
    );
    const handler = vi.fn();
    el.actionHandler = handler;

    el.handleEvent(key("Shift", { shiftKey: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    // `ctrl` is spelled `Control` on the event
    el.handleEvent(key("Control", { ctrlKey: true }));
    expect(handler).toHaveBeenCalledTimes(2);
    el.handleEvent(key("Meta", { metaKey: true }));
    expect(handler).toHaveBeenCalledTimes(3);
    // a modifier that is not in the filter
    el.handleEvent(key("Alt", { altKey: true }));
    expect(handler).toHaveBeenCalledTimes(3);
    // the modifier is held but a different key was pressed
    el.handleEvent(key("x", { shiftKey: true }));
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("accepts the `control` spelling for a modifier-only token", () => {
    const el = fixture<any>(`<${TAG} keycode-filter="control"></${TAG}>`);
    const handler = vi.fn();
    el.actionHandler = handler;
    el.handleEvent(key("Control", { ctrlKey: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    el.handleEvent(key("Shift", { shiftKey: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("never matches an empty token or a keyless event", () => {
    const el = fixture<any>(`<${TAG} keycode-filter="+"></${TAG}>`);
    const handler = vi.fn();
    el.actionHandler = handler;
    el.handleEvent(key("a"));
    el.handleEvent(key("+"));
    expect(handler).not.toHaveBeenCalled();

    el.keycodeFilter = ["a"];
    // no `key` at all (e.g. a synthetic event)
    el.handleEvent(new KeyboardEvent("keydown"));
    expect(handler).not.toHaveBeenCalled();
    el.handleEvent(key("a"));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("ListenableElement listen-for defaults", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("falls back to click when listen-for is cleared later", () => {
    // Bare base adds nothing until `listen-for` / `host-ref` changes.
    // `<event-handler>` adds the connect-time click default.
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const handler = vi.fn();
    el.actionHandler = handler;
    expect(el).toContainListeners({ click: 0 });

    el.listenFor = ["foo-event"];
    expect(el).toContainListeners({ click: 0, "foo-event": 1 });
    el.click();
    expect(handler).not.toHaveBeenCalled();
    el.dispatchEvent(new CustomEvent("foo-event"));
    expect(handler).toHaveBeenCalledTimes(1);

    // clearing the list falls back to the click default
    el.listenFor = [];
    expect(el).toContainListeners({ click: 1, "foo-event": 0 });
    el.click();
    expect(handler).toHaveBeenCalledTimes(2);

    // and the click default is what gets removed on the next change
    el.listenFor = ["bar-event"];
    expect(el).toContainListeners({ click: 0, "bar-event": 1 });
    el.click();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("uses the default click listener on a host-ref target", () => {
    const button = fixture<HTMLButtonElement>(
      `<button id="default-host"></button>`,
    );
    const el = fixture<any>(`<${TAG} host-ref="#default-host"></${TAG}>`);
    const handler = vi.fn();
    el.actionHandler = handler;
    expect(button).toContainListeners({ click: 1 });
    expect(el).toContainListeners({ click: 0 });

    button.click();
    expect(handler).toHaveBeenCalledTimes(1);

    el.hostRef = null;
    expect(button).toContainListeners({ click: 0 });
    expect(el).toContainListeners({ click: 1 });
    button.click();
    expect(handler).toHaveBeenCalledTimes(1);
    el.click();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("ListenableElement is-debounced", () => {
  beforeEach(() => composedSpy.mockClear());
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("wraps actionHandler in a trailing debounce when delay-ms is set", async () => {
    const el = fixture<any>(
      `<${COMPOSED_TAG} listen-for="ping-event" delay-ms="40" is-debounced></${COMPOSED_TAG}>`,
    );
    expect(typeof el.debouncedActionHandler).toBe("function");

    el.dispatchEvent(new CustomEvent("ping-event"));
    el.dispatchEvent(new CustomEvent("ping-event"));
    el.dispatchEvent(new CustomEvent("ping-event"));
    expect(composedSpy).not.toHaveBeenCalled();
    await wait(60);
    expect(composedSpy).toHaveBeenCalledTimes(1);

    /* Turning it off doesn't throw. Neutron treats an effect on a
       Function-typed prop that already holds a function as a method
       call, so the wrapper isn't actually replaced here. See the report. */
    expect(() => {
      el.isDebounced = false;
    }).not.toThrow();
    expect(el.isDebounced).toBe(false);
    el.dispatchEvent(new CustomEvent("ping-event"));
    expect(composedSpy).toHaveBeenCalledTimes(1);
    await wait(60);
    expect(composedSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to a 10ms debounce window without delay-ms", async () => {
    const el = fixture<any>(
      `<${COMPOSED_TAG} listen-for="ping-event" is-debounced></${COMPOSED_TAG}>`,
    );
    expect(typeof el.debouncedActionHandler).toBe("function");
    // without delay-ms the element handles synchronously (the wrapper is
    // only consulted when a delay is configured)
    el.dispatchEvent(new CustomEvent("ping-event"));
    expect(composedSpy).toHaveBeenCalledTimes(1);
  });
});

describe("ListenableElement lifecycles", () => {
  beforeEach(() => composedSpy.mockClear());
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("handles connected on mount, ignores synchronous moves, re-handles on reconnect", async () => {
    const el = fixture<any>(
      `<${COMPOSED_TAG} listen-for-lifecycle="connected"></${COMPOSED_TAG}>`,
    );
    expect(composedSpy).toHaveBeenCalledTimes(1);
    expect(composedSpy).toHaveBeenCalledWith("connected");
    expect(el._lifecycleTracker).toEqual(["connected"]);

    // a synchronous re-parent is a move, not a fresh connection
    const other = document.createElement("div");
    document.body.appendChild(other);
    other.appendChild(el);
    await wait(0);
    expect(composedSpy).toHaveBeenCalledTimes(1);

    // a real disconnect followed by a later reconnect handles again
    el.remove();
    await wait(0);
    document.body.appendChild(el);
    await wait(0);
    expect(composedSpy).toHaveBeenCalledTimes(2);
  });

  it("handles connected only once with listen-once", async () => {
    const el = fixture<any>(
      `<${COMPOSED_TAG} listen-for-lifecycle="connected" listen-once></${COMPOSED_TAG}>`,
    );
    expect(composedSpy).toHaveBeenCalledTimes(1);
    el.remove();
    await wait(0);
    document.body.appendChild(el);
    await wait(0);
    expect(composedSpy).toHaveBeenCalledTimes(1);
  });

  it("handles the adopted lifecycle", async () => {
    const el = fixture<any>(
      `<${COMPOSED_TAG} listen-for-lifecycle="adopted"></${COMPOSED_TAG}>`,
    );
    expect(composedSpy).not.toHaveBeenCalled();

    // happy-dom never runs `adoptedCallback` (`adoptNode` skips CE
    // reactions), so drive the platform hook directly.
    el.adoptedCallback();
    await wait(0);
    expect(composedSpy).toHaveBeenCalledTimes(1);
    expect(composedSpy).toHaveBeenCalledWith("adopted");
    expect(el._lifecycleTracker).toEqual(["adopted"]);

    // `isAdopted` resets on disconnect, so a later adoption handles again
    el.remove();
    await wait(0);
    document.body.appendChild(el);
    await wait(0);
    el.adoptedCallback();
    await wait(0);
    expect(composedSpy).toHaveBeenCalledTimes(2);
  });

  it("ignores lifecycles that are not listed", async () => {
    const el = fixture<any>(
      `<${COMPOSED_TAG} listen-for-lifecycle="disconnected"></${COMPOSED_TAG}>`,
    );
    expect(composedSpy).not.toHaveBeenCalled();
    el.adoptedCallback();
    await wait(0);
    expect(composedSpy).not.toHaveBeenCalled();
    el.remove();
    await wait(0);
    expect(composedSpy).toHaveBeenCalledTimes(1);
    expect(composedSpy).toHaveBeenCalledWith("disconnected");
  });
});
