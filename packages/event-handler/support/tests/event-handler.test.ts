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

if (!navigator.vibrate) {
  // @ts-ignore shim
  navigator.vibrate = () => {};
}

describe("event-handler", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("handlers event properly", async () => {
    const eventHandler = fixture<HTMLEventHandlerElement>(
      `<p></p>
       <event-handler fire-event="test-event">
         <section></section>
         <aside></aside>
         <div></div>
       </event-handler>
       <span></span>`,
    );
    // fixture returns first element (p), grab event-handler as next sibling
    const p = eventHandler;
    const handler = p.nextElementSibling as HTMLEventHandlerElement;
    const cb = vi.fn((e) => {
      expect(e.type).toBe("test-event");
    });
    document.body.addEventListener("test-event", cb);
    handler.dispatchEvent(new Event("click"));
    expect(cb).toHaveBeenCalled();

    // replace click with custom event
    handler.listenFor = ["foo-custom-event"];
    handler.dispatchEvent(new Event("click"));
    expect(cb).toHaveBeenCalledTimes(1);
    handler.dispatchEvent(new CustomEvent("foo-custom-event"));
    expect(cb).toHaveBeenCalledTimes(2);

    // replace click with custom event
    handler.listenFor = ["bar-custom-event", "baz-custom-event"];
    handler.dispatchEvent(new Event("click"));
    expect(cb).toHaveBeenCalledTimes(2);
    handler.dispatchEvent(new CustomEvent("foo-custom-event"));
    expect(cb).toHaveBeenCalledTimes(2);
    handler.dispatchEvent(new CustomEvent("bar-custom-event"));
    expect(cb).toHaveBeenCalledTimes(3);
    handler.dispatchEvent(new CustomEvent("baz-custom-event"));
    expect(cb).toHaveBeenCalledTimes(4);

    // target previous
    document.body.removeEventListener("test-event", cb);
    p.addEventListener("test-event", cb);
    handler.targetRef = "p:has(+:scope)";
    handler.dispatchEvent(new CustomEvent("baz-custom-event"));
    expect(cb).toHaveBeenCalledTimes(5);

    // target span
    const spanTag = handler.nextElementSibling!;
    spanTag.addEventListener("test-event", cb);
    handler.targetRef = "span";
    handler.dispatchEvent(new CustomEvent("baz-custom-event"));
    expect(cb).toHaveBeenCalledTimes(6);

    // turn off bubbling
    spanTag.removeEventListener("test-event", cb);
    document.body.addEventListener("test-event", cb);
    handler.notBubbles = true;
    handler.dispatchEvent(new CustomEvent("baz-custom-event"));
    expect(cb).toHaveBeenCalledTimes(6);
    handler.notBubbles = false;

    // turn off cancelable
    handler.notCancelable = true;
    handler.dispatchEvent(new CustomEvent("baz-custom-event"));
    expect(cb).toHaveBeenCalledTimes(7);
    expect(cb.mock.calls[6][0].cancelable).toBe(false);
    handler.notCancelable = false;

    // turn off composed
    handler.notComposed = true;
    handler.dispatchEvent(new CustomEvent("baz-custom-event"));
    expect(cb).toHaveBeenCalledTimes(8);
    expect(cb.mock.calls[7][0].composed).toBe(false);
    handler.notComposed = false;

    // test keycode filter
    handler.listenFor = ["keydown"];
    handler.keycodeFilter = ["a", "b"];
    handler.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(cb).toHaveBeenCalledTimes(9);
    handler.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
    expect(cb).toHaveBeenCalledTimes(9);

    // test element filter
    handler.listenFor = ["foo-event"];
    handler.keycodeFilter = [];
    handler.selectorFilter = "section,aside";
    const section = handler.querySelector("section")!;
    const aside = handler.querySelector("aside")!;
    const div = handler.querySelector("div")!;
    section.dispatchEvent(new CustomEvent("foo-event", { bubbles: true }));
    expect(cb).toHaveBeenCalledTimes(10);
    aside.dispatchEvent(new CustomEvent("foo-event", { bubbles: true }));
    expect(cb).toHaveBeenCalledTimes(11);
    div.dispatchEvent(new CustomEvent("foo-event", { bubbles: true }));
    expect(cb).toHaveBeenCalledTimes(11);
    handler.selectorFilter = "";

    // prevents default and stops propagation
    handler.preventDefault = true;
    const event1 = new CustomEvent("foo-event", { bubbles: true });
    event1.preventDefault = vi.fn();
    event1.stopPropagation = vi.fn();
    handler.dispatchEvent(event1);
    expect(event1.preventDefault).toHaveBeenCalled();
    handler.stopPropagation = true;
    handler.dispatchEvent(event1);
    expect(event1.stopPropagation).toHaveBeenCalled();
    handler.stopPropagation = false;
    handler.preventDefault = false;

    // test vibrate
    handler.vibrateMs = 100;
    const vibrateSpy = vi.spyOn(navigator, "vibrate");
    handler.dispatchEvent(new CustomEvent("foo-event", { bubbles: true }));
    expect(vibrateSpy).toHaveBeenCalledWith(100);
    handler.vibrateMs = 0;
  });

  it("includes detail from attrs", () => {
    const eventHandler = fixture<HTMLEventHandlerElement>(
      `<event-handler
        listen-for="my-event"
        fire-event="test-event"
        detail-foo="bar"
        detail-baz="qux">
      </event-handler>`,
    );
    const cb = vi.fn((e) => {
      expect(e.type).toBe("test-event");
    });
    document.body.addEventListener("test-event", cb);

    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].detail).toEqual({
      foo: "bar",
      baz: "qux",
    });
  });

  it("includes detail from form and attrs", () => {
    const eventHandler = fixture<HTMLEventHandlerElement>(
      `<event-handler
        listen-for="my-event"
        fire-event="test-event"
        detail-foo="bar"
        detail-baz="qux"
        form-ref="form">
          <form>
            <input name="detail.myProp" value="abc" type="text">
            <input name="detail.baz" value="nope" type="text">
            <input name="bubbles" type="checkbox">
          </form>
      </event-handler>`,
    );
    const cb = vi.fn((e) => {
      expect(e.type).toBe("test-event");
    });
    eventHandler.addEventListener("test-event", cb);
    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].bubbles).toBe(false);
    expect(cb.mock.calls[0][0].detail).toEqual({
      foo: "bar",
      myProp: "abc",
      baz: "qux",
    });
  });

  it("fires the event when form-ref matches nothing", () => {
    const eventHandler = fixture<HTMLEventHandlerElement>(
      `<event-handler
        listen-for="my-event"
        fire-event="test-event"
        detail-foo="bar"
        form-ref="#no-such-form">
      </event-handler>`,
    );
    const cb = vi.fn();
    document.body.addEventListener("test-event", cb);
    expect(() =>
      eventHandler.dispatchEvent(new CustomEvent("my-event")),
    ).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
    // only the detail-* attributes, no form data
    expect(cb.mock.calls[0][0].detail).toEqual({ foo: "bar" });
  });

  it("fires the event when form-ref matches a non-form element", () => {
    const eventHandler = fixture<HTMLEventHandlerElement>(
      `<event-handler
        listen-for="my-event"
        fire-event="test-event"
        detail-foo="bar"
        form-ref="#not-a-form">
          <div id="not-a-form">
            <input name="detail.myProp" value="abc" type="text">
          </div>
      </event-handler>`,
    );
    const cb = vi.fn();
    document.body.addEventListener("test-event", cb);
    expect(() =>
      eventHandler.dispatchEvent(new CustomEvent("my-event")),
    ).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].detail).toEqual({ foo: "bar" });
  });

  it("mutates target from attrs and form", () => {
    fixture<HTMLDivElement>(
      `<div id="div-to-mutate"></div>
       <event-handler
         mutate-target
         target-ref="#div-to-mutate"
         listen-for="my-event"
         attr-foo="bar"
         attr-baz="qux"
         form-ref="form">
           <form>
             <input name="my-attr" value="abc" type="text">
             <input name="baz" value="nope" type="text">
           </form>
       </event-handler>`,
    );
    const eventHandler = document.querySelector("event-handler")!;
    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    wait(1);
    const div = document.querySelector("#div-to-mutate")!;
    expect(div.getAttribute("foo")).toBe("bar");
    expect(div.getAttribute("my-attr")).toBe("abc");
    expect(div.getAttribute("baz")).toBe("qux");
  });

  it("mutates target from attrs only when no form-ref is set", () => {
    fixture<HTMLDivElement>(
      `<div id="mutate-attrs-only"></div>
       <event-handler
         mutate-target
         target-ref="#mutate-attrs-only"
         listen-for="my-event"
         attr-data-state="open">
       </event-handler>`,
    );
    const eventHandler = document.querySelector("event-handler")!;
    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    const div = document.querySelector("#mutate-attrs-only")!;
    expect(div.getAttribute("data-state")).toBe("open");
  });

  it("converts typed form fields into attributes on the target", () => {
    fixture<HTMLDivElement>(
      `<div id="mutate-typed" is-closed="" data-count="0"></div>
       <event-handler
         mutate-target
         target-ref="#mutate-typed"
         listen-for="my-event"
         form-ref="form">
           <form>
             <input name="data-count" value="3" type="number">
             <input name="is-open" type="checkbox" checked>
             <input name="is-closed" type="checkbox">
             <input name="data-tag" type="checkbox" value="alpha" checked>
           </form>
       </event-handler>`,
    );
    const eventHandler = document.querySelector("event-handler")!;
    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    const div = document.querySelector("#mutate-typed")!;
    // number → string attribute
    expect(div.getAttribute("data-count")).toBe("3");
    // true → boolean attribute present
    expect(div.getAttribute("is-open")).toBe("");
    // false → attribute removed
    expect(div.hasAttribute("is-closed")).toBe(false);
    // valued checkbox → list, written verbatim
    expect(div.getAttribute("data-tag")).toBe("alpha");
  });

  it("mutates from attr-* alone when form-ref matches nothing", () => {
    fixture<HTMLDivElement>(
      `<div id="mutate-missing-form"></div>
       <event-handler
         mutate-target
         target-ref="#mutate-missing-form"
         listen-for="my-event"
         form-ref="#no-such-form"
         attr-data-state="open">
       </event-handler>`,
    );
    const eventHandler = document.querySelector("event-handler")!;
    expect(() =>
      eventHandler.dispatchEvent(new CustomEvent("my-event")),
    ).not.toThrow();
    const div = document.querySelector("#mutate-missing-form")!;
    expect(div.getAttribute("data-state")).toBe("open");
  });

  it("mutates from attr-* alone when form-ref matches a non-form element", () => {
    fixture<HTMLDivElement>(
      `<div id="mutate-non-form"></div>
       <event-handler
         mutate-target
         target-ref="#mutate-non-form"
         listen-for="my-event"
         form-ref="#not-a-form"
         attr-data-state="open">
           <div id="not-a-form">
             <input name="data-ignored" value="x" type="text">
           </div>
       </event-handler>`,
    );
    const eventHandler = document.querySelector("event-handler")!;
    expect(() =>
      eventHandler.dispatchEvent(new CustomEvent("my-event")),
    ).not.toThrow();
    const div = document.querySelector("#mutate-non-form")!;
    expect(div.getAttribute("data-state")).toBe("open");
    expect(div.hasAttribute("data-ignored")).toBe(false);
  });

  it("does not mutate itself or a missing target", () => {
    const eventHandler = fixture<HTMLEventHandlerElement>(
      `<event-handler
        mutate-target
        listen-for="my-event"
        fire-event="test-event"
        attr-data-state="open">
      </event-handler>`,
    );
    const cb = vi.fn();
    document.body.addEventListener("test-event", cb);

    // no target-ref → the target is the element itself → no mutation, but
    // fire-event still runs
    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    expect(eventHandler.hasAttribute("data-state")).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);

    // unresolved target-ref → nothing to mutate; the event falls back to
    // dispatching from the element itself
    eventHandler.targetRef = "#does-not-exist";
    expect(() =>
      eventHandler.dispatchEvent(new CustomEvent("my-event")),
    ).not.toThrow();
    expect(eventHandler.hasAttribute("data-state")).toBe(false);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0].target).toBe(eventHandler);
  });

  it("does nothing without fire-event, command-name or mutate-target", () => {
    const eventHandler = fixture<HTMLEventHandlerElement>(
      `<event-handler listen-for="my-event" detail-foo="bar"></event-handler>`,
    );
    const cb = vi.fn();
    document.body.addEventListener("test-event", cb);
    expect(() =>
      eventHandler.dispatchEvent(new CustomEvent("my-event")),
    ).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("invokes built-in command-names on the target through a proxy button", () => {
    const invoked: Array<{ command: string; target: Element }> = [];
    Object.defineProperty(HTMLButtonElement.prototype, "commandForElement", {
      configurable: true,
      writable: true,
      value: null,
    });
    vi.spyOn(HTMLButtonElement.prototype, "click").mockImplementation(
      function (this: any) {
        invoked.push({ command: this.command, target: this.commandForElement });
      },
    );
    try {
      fixture<HTMLDialogElement>(
        `<dialog id="command-target"></dialog>
         <event-handler
           listen-for="my-event"
           target-ref="#command-target"
           command-name="show-modal close">
         </event-handler>`,
      );
      const eventHandler = document.querySelector("event-handler")!;
      const dialog = document.querySelector("#command-target")!;
      eventHandler.dispatchEvent(new CustomEvent("my-event"));
      expect(invoked).toEqual([
        { command: "show-modal", target: dialog },
        { command: "close", target: dialog },
      ]);
      // the proxy button is removed again
      expect(document.querySelector("button")).toBeNull();
    } finally {
      delete (HTMLButtonElement.prototype as any).commandForElement;
    }
  });

  it("dispatches custom --commands at the target with itself as source", () => {
    fixture<HTMLDivElement>(
      `<div>
         <section id="command-custom"></section>
         <event-handler listen-for="my-event" target-ref="#command-custom" command-name="--open --close"></event-handler>
       </div>`,
    );
    const eventHandler = document.querySelector("event-handler")!;
    const section = document.querySelector("#command-custom")!;
    const seen: Array<[string, Element | null, boolean]> = [];
    section.addEventListener("command", (e: any) =>
      seen.push([e.command, e.source, e.bubbles]),
    );
    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    expect(seen).toEqual([
      ["--open", eventHandler, false],
      ["--close", eventHandler, false],
    ]);
    expect(document.querySelector("button")).toBeNull();
  });

  it("fires several events with the same detail", () => {
    const eventHandler = fixture<HTMLEventHandlerElement>(
      `<event-handler
        listen-for="my-event"
        fire-event="first-event second-event"
        detail-foo="bar">
      </event-handler>`,
    );
    const seen: string[] = [];
    const cb = vi.fn((e: CustomEvent) => {
      seen.push(e.type);
      expect(e.detail).toEqual({ foo: "bar" });
    });
    document.body.addEventListener("first-event", cb);
    document.body.addEventListener("second-event", cb);
    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    expect(seen).toEqual(["first-event", "second-event"]);
  });

  it("delays events", async () => {
    const eventHandler = fixture<HTMLEventHandlerElement>(
      `<event-handler
        listen-for="my-event"
        fire-event="test-event"
        delay-ms="100">
      </event-handler>`,
    );
    const cb = vi.fn((e) => {
      expect(e.type).toBe("test-event");
    });
    document.body.addEventListener("test-event", cb);

    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    expect(cb).toHaveBeenCalledTimes(0);
    await wait(105);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("debounces", async () => {
    const eventHandler = fixture<HTMLEventHandlerElement>(
      `<event-handler
        listen-for="my-event"
        fire-event="test-event"
        delay-ms="100"
        is-debounced>
      </event-handler>`,
    );
    const cb = vi.fn((e) => {
      expect(e.type).toBe("test-event");
    });
    document.body.addEventListener("test-event", cb);

    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    expect(cb).toHaveBeenCalledTimes(0);
    await wait(105);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("handlers on configured lifecycles", async () => {
    const cb = vi.fn((e) => {
      expect(e.type).toBe("test-event");
    });
    document.body.addEventListener("test-event", cb);
    const eventHandler = fixture<HTMLEventHandlerElement>(
      `<event-handler
        listen-for="click"
        listen-for-lifecycle="connected disconnected"
        fire-event="test-event">
      </event-handler>`,
    );

    expect(cb).toHaveBeenCalledTimes(1);
    eventHandler.dispatchEvent(new Event("click"));
    expect(cb).toHaveBeenCalledTimes(2);
    eventHandler.addEventListener("test-event", cb);
    eventHandler.remove();
    await wait(0);
    expect(cb).toHaveBeenCalledTimes(3);
  });
});
