/**
 * happy-dom has no HTML Command API. Emulate the part the stack relies on
 * in view tests: `button.command` / `button.commandForElement`, and a click
 * on a `<button command="--verb" commandfor="id">` dispatching a `command`
 * event (non-bubbling, cancelable, composed, with `command` / `source`) at
 * its target. Built-in verbs (`show-modal`, …) have no emulated action.
 */
export function installCommandShim() {
  const proto = HTMLButtonElement.prototype as any;
  if (!("commandForElement" in proto)) {
    Object.defineProperty(proto, "commandForElement", {
      configurable: true,
      get() {
        if (this._commandForElement !== undefined) {
          return this._commandForElement;
        }
        const id = this.getAttribute("commandfor");
        return id ? (this.getRootNode() as Document).getElementById?.(id) ?? null : null;
      },
      set(value: Element | null) {
        this._commandForElement = value;
      },
    });
  }
  if (!("command" in proto)) {
    Object.defineProperty(proto, "command", {
      configurable: true,
      get() {
        return this._command ?? this.getAttribute("command") ?? "";
      },
      // a field, not an attribute: view-test meters count `setAttribute`
      set(value: string) {
        this._command = value;
      },
    });
  }
  document.addEventListener("click", (e) => {
    /* `composedPath()` rather than `closest()`: the view-test complexity
     * meter counts `closest` calls, and a shim must not shift budgets. */
    const button = e
      .composedPath()
      .find((node) => node instanceof HTMLButtonElement) as any;
    if (!button || e.defaultPrevented) return;
    const command: string = button.command;
    const target: Element | null = button.commandForElement;
    if (!target || !/^--\S+$/.test(command)) return;
    const event = new Event("command", {
      bubbles: false,
      cancelable: true,
      composed: true,
    });
    Object.defineProperties(event, {
      command: { value: command, enumerable: true },
      source: { value: button, enumerable: true },
    });
    target.dispatchEvent(event);
  });
}
