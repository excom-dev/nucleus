import { ListenableElement } from "../../index";
import {
  afterEach,
  describe,
  wait,
  expect,
  fixture,
  it,
  vi,
  shouldHaveListeners,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const TAG = "listenable-element-test";
if (!customElements.get(TAG)) {
  ListenableElement.define(TAG);
}

describe("ListenableElement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("invokes actionHandler via handleEvent", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const handler = vi.fn();
    el.actionHandler = handler;
    el.handleEvent(new Event("click"));
    expect(handler).toHaveBeenCalled();
  });

  it("calls preventDefault when configured", () => {
    const el = fixture<any>(`<${TAG} prevent-default></${TAG}>`);
    el.actionHandler = vi.fn();
    const event = new Event("click", { cancelable: true });
    vi.spyOn(event, "preventDefault");
    el.handleEvent(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("calls stopPropagation when configured", () => {
    const el = fixture<any>(`<${TAG} stop-propagation></${TAG}>`);
    el.actionHandler = vi.fn();
    const event = new Event("click");
    vi.spyOn(event, "stopPropagation");
    el.handleEvent(event);
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it("calls stopImmediatePropagation when configured", () => {
    const el = fixture<any>(`<${TAG} stop-immediate-propagation></${TAG}>`);
    el.actionHandler = vi.fn();
    const event = new Event("click");
    vi.spyOn(event, "stopImmediatePropagation");
    el.handleEvent(event);
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
  });

  it("filters by keycode", () => {
    const el = fixture<any>(`<${TAG} keycode-filter="enter"></${TAG}>`);
    const handler = vi.fn();
    el.actionHandler = handler;

    el.handleEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(handler).toHaveBeenCalledTimes(1);

    el.handleEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("filters by modifier+key chords (order-independent, space = OR)", () => {
    const el = fixture<any>(`<${TAG} keycode-filter="k+shift tab"></${TAG}>`);
    const handler = vi.fn();
    el.actionHandler = handler;

    el.handleEvent(new KeyboardEvent("keydown", { key: "k", shiftKey: true }));
    expect(handler).toHaveBeenCalledTimes(1);

    el.handleEvent(new KeyboardEvent("keydown", { key: "k" }));
    expect(handler).toHaveBeenCalledTimes(1);

    el.handleEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("filters by selector", () => {
    const el = fixture<any>(
      `<${TAG} selector-filter="button"><button></button><div></div></${TAG}>`,
    );
    const handler = vi.fn();
    el.actionHandler = handler;

    const button = el.querySelector("button")!;
    const buttonEvent = new Event("click", { bubbles: true });
    Object.defineProperty(buttonEvent, "target", { value: button });
    el.handleEvent(buttonEvent);
    expect(handler).toHaveBeenCalledTimes(1);

    const div = el.querySelector("div")!;
    const divEvent = new Event("click", { bubbles: true });
    Object.defineProperty(divEvent, "target", { value: div });
    el.handleEvent(divEvent);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("filters by pathname", () => {
    const el = fixture<any>(`<${TAG} pathname-filter="/allowed"></${TAG}>`);
    const handler = vi.fn();
    el.actionHandler = handler;
    el.handleEvent(new Event("click"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("handles lifecycle string events", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const handler = vi.fn();
    el.actionHandler = handler;
    el.handleEvent("connected");
    expect(handler).toHaveBeenCalledWith("connected");
  });

  it("does not preventDefault or stopPropagation on lifecycle events", () => {
    const el = fixture<any>(
      `<${TAG} prevent-default stop-propagation stop-immediate-propagation></${TAG}>`,
    );
    el.actionHandler = vi.fn();
    el.handleEvent("connected");
    expect(el.actionHandler).toHaveBeenCalledWith("connected");
  });

  it("calls vibrate when vibrateMs is set", () => {
    const el = fixture<any>(`<${TAG} vibrate-ms="50"></${TAG}>`);
    el.actionHandler = vi.fn();
    const vibrateSpy = vi.fn();
    Object.defineProperty(navigator, "vibrate", {
      value: vibrateSpy,
      writable: true,
      configurable: true,
    });
    el.handleEvent(new Event("click"));
    expect(vibrateSpy).toHaveBeenCalledWith(50);
  });

  it("uses default 20ms vibration when vibrateMs is 0", () => {
    const el = fixture<any>(`<${TAG} vibrate-ms="0"></${TAG}>`);
    el.actionHandler = vi.fn();
    const vibrateSpy = vi.fn();
    Object.defineProperty(navigator, "vibrate", {
      value: vibrateSpy,
      writable: true,
      configurable: true,
    });
    el.handleEvent(new Event("click"));
    expect(vibrateSpy).toHaveBeenCalledWith(20);
  });

  it("delays action when delayMs is set", () => {
    vi.useFakeTimers();
    const el = fixture<any>(`<${TAG} delay-ms="100"></${TAG}>`);
    const handler = vi.fn();
    el.actionHandler = handler;
    el.handleEvent(new Event("click"));
    expect(handler).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(handler).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("uses debounced handler when debouncedActionHandler and delayMs are set", () => {
    const el = fixture<any>(`<${TAG} delay-ms="100"></${TAG}>`);
    const handler = vi.fn();
    el.actionHandler = handler;
    const debouncedHandler = vi.fn();
    el.debouncedActionHandler = debouncedHandler;
    el.handleEvent(new Event("click"));
    expect(debouncedHandler).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("listens to events once", async () => {
    const el = fixture<typeof ListenableElement.CustomElement>(
      `<${TAG} listen-for="input-event" listen-once></${TAG}>`,
    );
    el.actionHandler = vi.fn();
    el.dispatchEvent(new CustomEvent("input-event"));
    el.dispatchEvent(new CustomEvent("input-event"));
    expect(el.actionHandler).toHaveBeenCalledTimes(1);
  });

  it("listens to lifecycles once", async () => {
    const el = fixture<typeof ListenableElement.CustomElement>(
      `<${TAG} listen-for-lifecycle="disconnected" listen-once></${TAG}>`,
    );
    el.actionHandler = vi.fn();
    el.remove();
    await wait(0);
    expect(el.actionHandler).toHaveBeenCalledTimes(1);
    expect(el.actionHandler).toHaveBeenCalledWith("disconnected");
    expect(el._lifecycleTracker).toEqual(["disconnected"]);
    document.body.appendChild(el);
    el.remove();
    await wait(0);
    expect(el.actionHandler).toHaveBeenCalledTimes(1);
  });

  it("listens on a CSS host-ref target", async () => {
    const button = fixture<any>(`<button id="listen-host"></button>`);
    expect(button).toContainListeners({ click: 0 });
    const el = fixture<any>(
      `<${TAG} host-ref="#listen-host" listen-for="click"></${TAG}>`,
    );
    expect(button).toContainListeners({ click: 1 });
    const handler = vi.fn();
    el.actionHandler = handler;

    button.click();
    expect(handler).toHaveBeenCalledTimes(1);
    el.click();
    expect(handler).toHaveBeenCalledTimes(1);
    el.remove();
    await wait(0);
    expect(button).toContainListeners({ click: 0 });
  });

  it("listens on window via host-ref for global key events", async () => {
    expect(window).toContainListeners({ keydown: 0 });
    const el = fixture<any>(
      `<${TAG} host-ref="window" listen-for="keydown" keycode-filter="escape"></${TAG}>`,
    );
    expect(window).toContainListeners({ keydown: 1 });
    const handler = vi.fn();
    el.actionHandler = handler;

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(handler).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(handler).toHaveBeenCalledTimes(1);

    el.remove();
    await wait(0);
    expect(window).toContainListeners({ keydown: 0 });
  });

  it("listens on document via host-ref", async () => {
    expect(document).toContainListeners({ "demo-doc-event": 0 });
    const el = fixture<any>(
      `<${TAG} host-ref="document" listen-for="demo-doc-event"></${TAG}>`,
    );
    expect(document).toContainListeners({ "demo-doc-event": 1 });
    const handler = vi.fn();
    el.actionHandler = handler;

    document.dispatchEvent(new CustomEvent("demo-doc-event"));
    expect(handler).toHaveBeenCalledTimes(1);
    el.dispatchEvent(new CustomEvent("demo-doc-event"));
    expect(handler).toHaveBeenCalledTimes(1);

    el.remove();
    await wait(0);
    expect(document).toContainListeners({ "demo-doc-event": 0 });
  });

  it("cleans up previous host listeners when host-ref is cleared", async () => {
    expect(window).toContainListeners({ keydown: 0 });
    const el = fixture<any>(
      `<${TAG} host-ref="window" listen-for="keydown"></${TAG}>`,
    );
    expect(window).toContainListeners({ keydown: 1 });
    expect(el).toContainListeners({ keydown: 0 });
    const handler = vi.fn();
    el.actionHandler = handler;

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(handler).toHaveBeenCalledTimes(1);

    el.removeAttribute("host-ref");
    await wait(0);
    expect(window).toContainListeners({ keydown: 0 });
    expect(el).toContainListeners({ keydown: 1 });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(handler).toHaveBeenCalledTimes(1);

    // listen-for is unchanged, so the element itself is now the host
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("moves listeners when host-ref changes between hosts", async () => {
    const button = fixture<any>(`<button id="host-a"></button>`);
    expect(button).toContainListeners({ click: 0 });
    expect(window).toContainListeners({ click: 0 });

    const el = fixture<any>(
      `<${TAG} host-ref="#host-a" listen-for="click"></${TAG}>`,
    );
    expect(button).toContainListeners({ click: 1 });
    expect(window).toContainListeners({ click: 0 });
    const handler = vi.fn();
    el.actionHandler = handler;

    button.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    expect(handler).toHaveBeenCalledTimes(1);

    el.hostRef = "window";
    await wait(0);
    expect(button).toContainListeners({ click: 0 });
    expect(window).toContainListeners({ click: 1 });

    // non-bubbling so a window listener can't be mistaken for the button's
    button.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    expect(handler).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(2);

    Object.assign(el, {
      hostRef: "#host-a",
      listenFor: ["test-event", "b-event"],
    })

    button.remove();
    await wait(0);
    expect(button).toContainListeners({ 'test-event': 1, 'b-event': 1, click: 0 });
    document.body.appendChild(button);
    await wait(0);

    expect(button).toContainListeners({ 'test-event': 1, 'b-event': 1, click: 0 });
    expect(window).toContainListeners({ 'test-event': 0, 'b-event': 0, click: 0 });
    button.dispatchEvent(new CustomEvent("test-event"));
    expect(handler).toHaveBeenCalledTimes(3);
    button.dispatchEvent(new CustomEvent("b-event"));
    expect(handler).toHaveBeenCalledTimes(4);

    Object.assign(el, {
      hostRef: "window",
      listenFor: ["test-event", "b-event"],
    })
    el.listenFor = ["test-event", "c-event"];

    expect(button).toContainListeners({ 'test-event': 0, 'b-event': 0, 'c-event': 0, click: 0 });
    expect(window).toContainListeners({ 'test-event': 1, 'b-event': 0, 'c-event': 1, click: 0 });
    window.dispatchEvent(new CustomEvent("test-event"));
    expect(handler).toHaveBeenCalledTimes(5);
    window.dispatchEvent(new CustomEvent("b-event"));
    expect(handler).toHaveBeenCalledTimes(5);
    button.dispatchEvent(new CustomEvent("test-event"));
    button.dispatchEvent(new CustomEvent("c-event"));
    window.dispatchEvent(new CustomEvent("c-event"));
    expect(handler).toHaveBeenCalledTimes(6);
    window.dispatchEvent(new CustomEvent("test-event"));
    expect(handler).toHaveBeenCalledTimes(7);

    el.remove();
    await wait(0);
    expect(button).toContainListeners({ 'test-event': 0, 'b-event': 0, 'c-event': 0, click: 0 });
    expect(window).toContainListeners({ 'test-event': 0, 'b-event': 0, 'c-event': 0, click: 0 });
    document.body.appendChild(el);
    await wait(0);
    expect(button).toContainListeners({ 'test-event': 0, 'b-event': 0, 'c-event': 0, click: 0 });
    expect(window).toContainListeners({ 'test-event': 1, 'b-event': 0, 'c-event': 1, click: 0 });

    Object.assign(el, {
      hostRef: null,
      listenFor: ["c-event", "click"],
    })
    expect(button).toContainListeners({ 'test-event': 0, 'b-event': 0, 'c-event': 0, click: 0 });
    expect(window).toContainListeners({ 'test-event': 0, 'b-event': 0, 'c-event': 0, click: 0 });
    expect(el).toContainListeners({ 'test-event': 0, 'b-event': 0, 'c-event': 1, click: 1 });
    button.dispatchEvent(new CustomEvent("click"));
    window.dispatchEvent(new CustomEvent("click"));
    el.dispatchEvent(new CustomEvent("click"));
    expect(handler).toHaveBeenCalledTimes(8);
  });

  it("cleans up host listeners when the element is disconnected", async () => {
    expect(window).toContainListeners({ keydown: 0 });
    const el = fixture<any>(
      `<${TAG} host-ref="window" listen-for="keydown"></${TAG}>`,
    );
    expect(window).toContainListeners({ keydown: 1 });
    const handler = vi.fn();
    el.actionHandler = handler;

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(handler).toHaveBeenCalledTimes(1);

    el.remove();
    await wait(0);
    expect(window).toContainListeners({ keydown: 0 });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("switches listen-for events on a host-ref", async () => {
    expect(window).toContainListeners({ keydown: 0, keyup: 0 });
    const el = fixture<any>(
      `<${TAG} host-ref="window" listen-for="keydown"></${TAG}>`,
    );
    expect(window).toContainListeners({ keydown: 1, keyup: 0 });
    const handler = vi.fn();
    el.actionHandler = handler;

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(handler).toHaveBeenCalledTimes(1);

    el.listenFor = ["keyup"];
    await wait(0);
    expect(window).toContainListeners({ keydown: 0, keyup: 1 });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(handler).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "a" }));
    expect(handler).toHaveBeenCalledTimes(2);

    el.remove();
    await wait(0);
    expect(window).toContainListeners({ keydown: 0, keyup: 0 });
  });

  it("listen-once on a host-ref fires only once", async () => {
    expect(window).toContainListeners({ keydown: 0 });
    const el = fixture<any>(
      `<${TAG} host-ref="window" listen-for="keydown" listen-once></${TAG}>`,
    );
    expect(window).toContainListeners({ keydown: 1 });
    const handler = vi.fn();
    el.actionHandler = handler;

    expect(window).toContainListeners({ keydown: 1 });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(handler).toHaveBeenCalledTimes(1);
    // this doesn't work. would need to shim the listener, if once: true, remove this from the collection. It works natively
    // expect(window).toContainListeners({ keydown: 0 });

    el.hostRef = null;
    expect(el).toContainListeners({ keydown: 1 });
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(handler).toHaveBeenCalledTimes(2);
    expect(window).toContainListeners({ keydown: 0 });
    // expect(el).toContainListeners({ keydown: 0 });


    el.remove();
    await wait(0);
    expect(window).toContainListeners({ keydown: 0 });
  });

  it("throws when host-ref matches nothing", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    expect(() => {
      el.hostRef = "#does-not-exist";
    }).toThrow(/Host element not found/);
  });
});
