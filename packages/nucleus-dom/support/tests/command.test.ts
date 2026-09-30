import { afterEach, describe, expect, it, vi } from "@excom/heft-rig/node_modules/vitest";
import { createDom, type Dom } from "../../index";

type CommandEvent = Event & { command: string; source: Element };

let dom: Dom;
const open = (html: string) => {
  dom = createDom({ html });
  return dom.document;
};
const commandsAt = (target: Element) => {
  const events: CommandEvent[] = [];
  target.addEventListener("command", (event) => events.push(event as CommandEvent));
  return events;
};

afterEach(() => dom.dispose());

describe("command shim", () => {
  it("a click dispatches a command event at the commandfor target", () => {
    const document = open(
      `<button command="--open" commandfor="panel"><span>Open</span></button><div id="panel"></div>`,
    );
    const button = document.querySelector("button")!;
    const events = commandsAt(document.getElementById("panel")!);
    const bubbled = commandsAt(document.body);
    button.querySelector("span")!.click();
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.command).toBe("--open");
    expect(event.source).toBe(button);
    expect([event.bubbles, event.cancelable, event.composed]).toEqual([false, true, true]);
    expect(bubbled).toHaveLength(0);
  });

  it("ignores built-in commands, missing targets and prevented clicks", () => {
    const document = open(`
      <button id="built-in" command="show-modal" commandfor="panel"></button>
      <button id="no-target" command="--open" commandfor="nowhere"></button>
      <button id="prevented" command="--open" commandfor="panel"></button>
      <div id="panel"></div>`);
    const events = commandsAt(document.getElementById("panel")!);
    document.getElementById("prevented")!.addEventListener("click", (e) => e.preventDefault());
    for (const id of ["built-in", "no-target", "prevented"]) document.getElementById(id)!.click();
    document.body.click();
    expect(events).toHaveLength(0);
  });

  it("resolves commandfor inside a shadow root", () => {
    const document = open(`<div id="host"></div>`);
    const shadow = document.getElementById("host")!.attachShadow({ mode: "open" });
    shadow.innerHTML = `<button command="--close" commandfor="dialog"></button><dialog id="dialog"></dialog>`;
    const button = shadow.querySelector("button")!;
    const events = commandsAt(shadow.getElementById("dialog")!);
    button.click();
    expect(events.map((event) => [event.command, event.source])).toEqual([["--close", button]]);
  });

  it("survives a document.write after createDom()", () => {
    dom = createDom();
    dom.document.write(`<button command="--x" commandfor="t"></button><div id="t"></div>`);
    const events = commandsAt(dom.document.getElementById("t")!);
    dom.document.querySelector("button")!.click();
    expect(events.map((event) => event.command)).toEqual(["--x"]);
  });

  it("reflects command to the attribute, unseen by setAttribute spies", () => {
    const document = open(`<button command="--open"></button>`);
    const button = document.querySelector("button")! as HTMLButtonElement & { command: string };
    const setAttribute = vi.spyOn(dom.window.Element.prototype, "setAttribute");
    button.command = "--toggle";
    setAttribute.mockRestore();
    expect(button.outerHTML).toBe(`<button command="--toggle"></button>`);
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it("reads the attributes and takes a commandForElement", () => {
    const document = open(`<button command="--open" commandfor="panel"></button><div id="panel"></div>`);
    const button = document.querySelector("button")! as HTMLButtonElement & {
      command: string;
      commandForElement: Element | null;
    };
    const other = document.body.appendChild(document.createElement("aside"));
    expect(button.command).toBe("--open");
    expect(button.commandForElement).toBe(document.getElementById("panel"));
    button.command = "--toggle";
    button.commandForElement = other;
    expect([button.command, button.commandForElement]).toEqual(["--toggle", other]);
    const events = commandsAt(other);
    button.click();
    expect(events.map((event) => event.command)).toEqual(["--toggle"]);

    const bare = document.createElement("button") as typeof button;
    expect([bare.command, bare.commandForElement]).toEqual(["", null]);
    bare.setAttribute("commandfor", "panel");
    // Detached: no tree to look the id up in.
    expect(bare.commandForElement).toBeNull();
  });
});
