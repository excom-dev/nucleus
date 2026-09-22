import { KitLogger } from "@excom/kit-logger";

/**
 * The `command` event an element receives from the HTML Command API — a
 * `<button command="--verb" commandfor="id">`, `<event-handler
 * command-name="--verb">`, or a script-built `CommandEvent`. It never
 * bubbles, is cancelable and composed. `command` is the verb; `source` is
 * the invoker (the button) or `null`.
 */
export type TCommandEvent = Event & {
  readonly command: string;
  readonly source: Element | null;
};

export type CommandInit = {
  /** Element that receives the command. Defaults to the dispatching element. */
  target?: Element | null;
  /** Reported as `event.source`. Defaults to the dispatching element. */
  source?: Element | null;
};

/** Arguments of the `command` effect key: `command: ["--fetch", { target }]`. */
export type CommandArgs = [string, CommandInit?];

export const COMMAND_EVENT = "command";

/**
 * Custom commands are dashed-idents (`--fetch`), like CSS custom
 * properties; the platform reserves every other name for built-ins.
 */
export const isCustomCommand = (name: unknown): name is string =>
  typeof name === "string" && /^--\S+$/.test(name);

type CommandEventCtor = new (
  type: string,
  init?: EventInit & { command?: string; source?: Element | null }
) => TCommandEvent;

/**
 * Build a `command` event. Uses the platform `CommandEvent` when the
 * browser has one; otherwise a plain `Event` carrying the same two
 * read-only fields, so `onCommand` handlers run identically either way.
 */
export function createCommandEvent(
  command: string,
  init: { source?: Element | null } = {}
): TCommandEvent {
  const source = init.source ?? null;
  const eventInit = { bubbles: false, cancelable: true, composed: true };
  const Ctor = (globalThis as { CommandEvent?: CommandEventCtor }).CommandEvent;
  if (Ctor) {
    return new Ctor(COMMAND_EVENT, { ...eventInit, command, source });
  }
  const event = new Event(COMMAND_EVENT, eventInit) as TCommandEvent;
  Object.defineProperties(event, {
    command: { value: command, enumerable: true },
    source: { value: source, enumerable: true },
  });
  return event;
}

/**
 * Invoke `command` on `target`. A custom command (`--verb`) is dispatched
 * directly and the event is returned. A built-in verb (`show-modal`,
 * `toggle-popover`, …) can only run through the platform: an invisible
 * proxy `<button command commandfor>` is clicked and removed, and `null`
 * is returned (browsers without the Command API log a warning and do
 * nothing).
 */
export function invokeCommand(
  target: Element,
  command: string,
  source: Element | null = null
): TCommandEvent | null {
  if (isCustomCommand(command)) {
    const event = createCommandEvent(command, { source });
    target.dispatchEvent(event);
    return event;
  }
  const proto = HTMLButtonElement.prototype as { commandForElement?: unknown };
  if (!("commandForElement" in proto)) {
    KitLogger.warn(
      `Command "${command}" needs the HTML Command API (\`commandfor\`), which this browser lacks. Custom commands (\`--name\`) work everywhere.`
    );
    return null;
  }
  const proxy = target.ownerDocument.createElement(
    "button"
  ) as HTMLButtonElement & { commandForElement: Element; command: string };
  // No attribute writes here: test complexity meters count `setAttribute`.
  // Detached from any form, the proxy cannot submit, so `type` can stay.
  proxy.style.display = "none";
  target.ownerDocument.body.appendChild(proxy);
  proxy.commandForElement = target;
  proxy.command = command;
  try {
    proxy.click();
  } finally {
    proxy.remove();
  }
  return null;
}
