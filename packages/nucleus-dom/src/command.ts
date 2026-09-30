import { claim, type DomWindow } from "./window";

const SHIMMED = Symbol.for("@excom/nucleus-dom/command");

type CommandButton = HTMLButtonElement & {
  command: string;
  commandForElement: Element | null;
  _commandForElement?: Element | null;
};

/**
 * Invoker Commands, missing in happy-dom: `button.command` (reflects the
 * attribute), `button.commandForElement`, and a click on
 * `<button command="--verb" commandfor="id">` dispatching a `command` event
 * (cancelable, composed, not bubbling; `command` and `source` fields) at the
 * target. Built-in commands (`show-modal`, …) have no action.
 */
export function installCommandShim(win: DomWindow | typeof globalThis): void {
  const proto = win.HTMLButtonElement.prototype;
  const { setAttribute } = win.Element.prototype;
  if (claim(proto, SHIMMED)) {
    Object.defineProperties(proto, {
      commandForElement: {
        configurable: true,
        get(this: CommandButton) {
          if (this._commandForElement !== undefined)
            return this._commandForElement;
          const id = this.getAttribute("commandfor");
          return id
            ? ((this.getRootNode() as Document).getElementById?.(id) ?? null)
            : null;
        },
        set(this: CommandButton, value: Element | null) {
          this._commandForElement = value;
        },
      },
      command: {
        configurable: true,
        get(this: CommandButton) {
          return this.getAttribute("command") ?? "";
        },
        // the original `setAttribute`: browsers reflect unseen by spies (view-test meters)
        set(this: CommandButton, value: string) {
          setAttribute.call(this, "command", String(value));
        },
      },
    });
  }
  // on the window: `document.open()` (the first `document.write`) drops document listeners
  if (!claim(win, SHIMMED)) return;
  win.addEventListener("click", (event) => {
    // `composedPath()`, not `closest()`: view-test meters count `closest`
    const button = event
      .composedPath()
      .find(
        (node): node is CommandButton => node instanceof win.HTMLButtonElement
      );
    const target = button?.commandForElement;
    if (!target || event.defaultPrevented || !/^--\S+$/.test(button.command))
      return;
    const command = new win.Event("command", {
      cancelable: true,
      composed: true,
    });
    Object.defineProperties(command, {
      command: { value: button.command, enumerable: true },
      source: { value: button, enumerable: true },
    });
    target.dispatchEvent(command);
  });
}
