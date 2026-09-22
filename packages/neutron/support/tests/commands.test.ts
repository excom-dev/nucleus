import {
  createCommandEvent,
  invokeCommand,
  isCustomCommand,
} from "../../src/command";
import { Neutron } from "../../src/neutron";
import { NeutronError } from "../../src/neutron-error";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { KitLogger } from "@excom/kit-logger";

const microtask = () => Promise.resolve();

describe("command events", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    delete (globalThis as { CommandEvent?: unknown }).CommandEvent;
  });

  it("accepts only dashed-ident custom command names", () => {
    expect(isCustomCommand("--fetch")).toBe(true);
    expect(isCustomCommand("--open-stage")).toBe(true);
    expect(isCustomCommand("fetch")).toBe(false);
    expect(isCustomCommand("show-modal")).toBe(false);
    expect(isCustomCommand("--")).toBe(false);
    expect(isCustomCommand("-- x")).toBe(false);
    expect(isCustomCommand(undefined)).toBe(false);
  });

  it("builds a non-bubbling, cancelable, composed event without the platform class", () => {
    const source = document.createElement("button");
    const event = createCommandEvent("--fetch", { source });
    expect(event.type).toBe("command");
    expect(event.bubbles).toBe(false);
    expect(event.cancelable).toBe(true);
    expect(event.composed).toBe(true);
    expect(event.command).toBe("--fetch");
    expect(event.source).toBe(source);
    expect(createCommandEvent("--x").source).toBe(null);
  });

  it("uses the platform CommandEvent when the browser has one", () => {
    class FakeCommandEvent extends Event {
      command: string;
      source: Element | null;
      constructor(type: string, init: any) {
        super(type, init);
        this.command = init.command;
        this.source = init.source;
      }
    }
    (globalThis as any).CommandEvent = FakeCommandEvent;
    const source = document.createElement("button");
    const event = createCommandEvent("--go", { source });
    expect(event).toBeInstanceOf(FakeCommandEvent);
    expect(event.command).toBe("--go");
    expect(event.source).toBe(source);
    expect(event.cancelable).toBe(true);
  });

  it("invokeCommand dispatches a custom command at the target and returns the event", () => {
    const target = fixture<HTMLDivElement>(`<div></div>`);
    const source = document.createElement("button");
    const seen = vi.fn();
    target.addEventListener("command", seen);
    const event = invokeCommand(target, "--go", source);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0]).toBe(event);
    expect(event?.source).toBe(source);
    expect(event?.target).toBe(target);
  });

  it("invokeCommand warns and does nothing for a built-in verb without the Command API", () => {
    const warn = vi.spyOn(KitLogger, "warn").mockImplementation(() => {});
    const target = fixture<HTMLDialogElement>(`<dialog></dialog>`);
    // the rig's test shim emulates the API; hide it for this case
    const shim = Object.getOwnPropertyDescriptor(
      HTMLButtonElement.prototype,
      "commandForElement"
    );
    delete (HTMLButtonElement.prototype as any).commandForElement;
    try {
      expect("commandForElement" in HTMLButtonElement.prototype).toBe(false);
      expect(invokeCommand(target, "show-modal")).toBe(null);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/needs the HTML Command API/);
      expect(document.querySelector("button")).toBe(null);
    } finally {
      if (shim) {
        Object.defineProperty(
          HTMLButtonElement.prototype,
          "commandForElement",
          shim
        );
      }
    }
  });

  it("a click on <button command commandfor> reaches the target in the test rig", () => {
    const root = fixture<HTMLDivElement>(
      `<div><button type="button" command="--go" commandfor="shim-target"></button><section id="shim-target"></section></div>`
    );
    const seen = vi.fn();
    root.querySelector("section")!.addEventListener("command", seen);
    root.querySelector("button")!.click();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].command).toBe("--go");
    expect(seen.mock.calls[0][0].source).toBe(root.querySelector("button"));
  });

  it("invokeCommand runs a built-in verb through a proxy button when the API exists", () => {
    const invoked: Array<{ command: string; target: Element; type: string }> =
      [];
    Object.defineProperty(HTMLButtonElement.prototype, "commandForElement", {
      configurable: true,
      writable: true,
      value: null,
    });
    vi.spyOn(HTMLButtonElement.prototype, "click").mockImplementation(
      function (this: any) {
        invoked.push({
          command: this.command,
          target: this.commandForElement,
          type: this.type,
        });
        expect(this.isConnected).toBe(true);
      }
    );
    try {
      const target = fixture<HTMLDialogElement>(`<dialog></dialog>`);
      expect(invokeCommand(target, "show-modal")).toBe(null);
      expect(invoked).toEqual([
        { command: "show-modal", target, type: "submit" },
      ]);
      expect(document.querySelector("button")).toBe(null);
    } finally {
      delete (HTMLButtonElement.prototype as any).commandForElement;
    }
  });
});

describe("Lifecycles: onCommand", () => {
  const openFn = vi.fn();
  const anyFn = vi.fn();
  Neutron({
    tag: "command-host",
    props: { isOpen: Boolean, lastVerb: String, sourceId: String },
  })
    .onCommand("--open", (_, e) => {
      openFn(e);
      return { isOpen: true, sourceId: e.source?.id ?? "none" };
    })
    .onCommand(["--open", "--close"], ({ isOpen }, e) => {
      anyFn(e.command);
      return { lastVerb: e.command, ...(e.command === "--close" && isOpen ? { isOpen: false } : {}) };
    })
    .define();

  afterEach(() => {
    document.body.innerHTML = "";
    openFn.mockClear();
    anyFn.mockClear();
  });

  it("runs the handlers whose verb matches, after the dispatch, with the event", async () => {
    const el = fixture<any>(`<command-host></command-host>`);
    const source = document.createElement("button");
    source.id = "opener";
    const event = invokeCommand(el, "--open", source)!;
    // not synchronous: the whole dispatch may still preventDefault()
    expect(openFn).not.toHaveBeenCalled();
    expect(el.isOpen).toBeFalsy();
    await microtask();
    expect(openFn).toHaveBeenCalledTimes(1);
    expect(openFn.mock.calls[0][0]).toBe(event);
    expect(anyFn).toHaveBeenCalledWith("--open");
    expect(el).dom.to.equalTag(
      `<command-host is-open source-id="opener" last-verb="--open"></command-host>`
    );

    invokeCommand(el, "--close");
    await microtask();
    expect(openFn).toHaveBeenCalledTimes(1);
    expect(el).dom.to.equalTag(
      `<command-host source-id="opener" last-verb="--close"></command-host>`
    );
  });

  it("ignores other verbs, prevented commands and bubbling look-alikes", async () => {
    const el = fixture<any>(`<command-host><span></span></command-host>`);
    invokeCommand(el, "--other");
    await microtask();
    expect(openFn).not.toHaveBeenCalled();
    expect(anyFn).not.toHaveBeenCalled();

    el.addEventListener("command", (e: Event) => e.preventDefault(), {
      once: true,
    });
    invokeCommand(el, "--open");
    await microtask();
    expect(openFn).not.toHaveBeenCalled();
    expect(el.isOpen).toBeFalsy();

    // a hand-made bubbling "command" event from a descendant is not for this element
    const fake = new Event("command", { bubbles: true }) as any;
    fake.command = "--open";
    el.querySelector("span").dispatchEvent(fake);
    await microtask();
    expect(openFn).not.toHaveBeenCalled();
  });

  it("registers one listener per handler, dropped on disconnect and restored on reconnect", async () => {
    const el = fixture<any>(`<command-host></command-host>`);
    expect(
      el._n_.eventListeners.filter(([type]) => type === "command").length
    ).toBe(2);
    el.remove();
    await wait(0);
    invokeCommand(el, "--open");
    await microtask();
    expect(openFn).not.toHaveBeenCalled();
    document.body.append(el);
    invokeCommand(el, "--open");
    await microtask();
    expect(openFn).toHaveBeenCalledTimes(1);
  });

  it("rejects built-in verbs at registration and unregisters by handler", () => {
    const B = Neutron({ tag: "command-names", props: {} });
    expect(() => B.onCommand("show-modal", () => ({}))).toThrow(NeutronError);
    expect(() => B.onCommand("show-modal", () => ({}))).toThrow(
      /must start with "--"/
    );
    expect(() => B.onCommand(["--ok", "close"], () => ({}))).toThrow(
      /got "close"/
    );
    const f = () => ({});
    B.onCommand("--ok", f);
    expect(B.builtConfig.lifecycles.command).toEqual([[["--ok"], f]]);
    expect((f as any)._logSignature).toBe('onCommand("--ok")');
    B.offCommand("--ok", f);
    expect(B.builtConfig.lifecycles.command).toEqual([]);
  });

  it("merges command handlers through compose", async () => {
    const seen: string[] = [];
    const Base = Neutron({ tag: "command-base", props: {} }).onCommand(
      "--a",
      () => {
        seen.push("base");
      }
    );
    Neutron.compose([
      Base,
      Neutron({ tag: "command-composed", props: {} }),
    ])
      .onCommand("--a", () => {
        seen.push("composed");
      })
      .define();
    const el = fixture<any>(`<command-composed></command-composed>`);
    expect(el._n_.ctr.builtConfig.lifecycles.command.length).toBe(2);
    invokeCommand(el, "--a");
    await microtask();
    expect(seen).toEqual(["base", "composed"]);
  });
});

describe("Effects: command / commands", () => {
  Neutron({ tag: "command-invoker", props: { targetEl: HTMLElement } })
    .defineMethods({
      fire: ({ targetEl }) => ({
        command: ["--fetch", { target: targetEl }],
      }),
      fireMany: ({ targetEl }) => ({
        commands: [
          ["--one", { target: targetEl }],
          ["--two", { target: targetEl, source: null }],
        ],
      }),
      fireSelf: () => ({ command: ["--self"] }),
    })
    .define();

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("dispatches at the target with the element as source, last in the effect", () => {
    const root = fixture<HTMLDivElement>(
      `<div><command-invoker></command-invoker><section></section></div>`
    );
    const invoker = root.querySelector("command-invoker") as any;
    const section = root.querySelector("section")!;
    const seen: Array<[string, Element | null, Element | null]> = [];
    const record = (e: any) =>
      seen.push([e.command, e.source, e.currentTarget]);
    section.addEventListener("command", record);
    invoker.addEventListener("command", record);

    invoker.targetEl = section;
    invoker.fire();
    expect(seen).toEqual([["--fetch", invoker, section]]);

    invoker.fireMany();
    expect(seen.slice(1)).toEqual([
      ["--one", invoker, section],
      ["--two", null, section],
    ]);

    invoker.fireSelf();
    expect(seen.at(-1)).toEqual(["--self", invoker, invoker]);
  });

  it("rejects a non-array command effect", () => {
    Neutron({ tag: "command-bad", props: {} })
      .defineMethods({ bad: () => ({ command: "--x" as any }) })
      .define();
    const el = fixture<any>(`<command-bad></command-bad>`);
    expect(() => el.bad()).toThrow(/arguments must be an array/);
  });
});
