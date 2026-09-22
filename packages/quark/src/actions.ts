/**
 * `@dispatch` / `@command` statements: the outgoing half of `@on`.
 * Accepted inside `@on … { }` blocks (and `@delay` blocks within them)
 * only, so a dispatch is always caused by an event the sheet heard —
 * never by a rule matching. Options are evaluated per event, in the
 * block's scope (`event`, `target`, `element`, `$bindings`).
 *
 *   @on click { @dispatch cart-add (detail: (sku: $sku), target: "cart-view"); }
 *   @on click { @command --refresh (target: "#feed"); }
 *
 * Dispatch is synchronous at the end of the block (after its writes are
 * queued, before they paint): an event is an occurrence, not a delivery
 * of State. Chains are one loop-guard hop per dispatch, so a cycle is cut
 * like a write cycle.
 */
import {
  type EventName,
  eventNamesText,
  type ListenerOptionSource,
  listenerOptionsText,
} from "./ast";
import { isNoop } from "./constants";
import { publicize } from "./devtools-hook";
import { resolveExpression } from "./resolvers";
import type { Rule } from "./rule";
import type { QuarkOptions } from "./types";
import { QuarkLogger } from "./utils";
import { formToJson, LoopGuard, selectAll, tc } from "@excom/kit-utils";

export type ActionKind = "dispatch" | "command";

/** Event-init flags an `@dispatch` may set; bare = `true`. */
const DISPATCH_FLAGS = ["bubbles", "cancelable", "composed"] as const;
type DispatchFlag = (typeof DISPATCH_FLAGS)[number];
const DISPATCH_DEFAULTS: Record<DispatchFlag, boolean> = {
  bubbles: true,
  cancelable: true,
  composed: false,
};

/**
 * Native commands the fallback invokes directly when the browser has no
 * Invoker Commands API (`button.commandForElement`).
 */
const NATIVE_COMMANDS: Record<string, string> = {
  "show-modal": "showModal",
  close: "close",
  "request-close": "requestClose",
  "show-popover": "showPopover",
  "hide-popover": "hidePopover",
  "toggle-popover": "togglePopover",
};

const supportsInvokers = (): boolean =>
  typeof HTMLButtonElement !== "undefined" &&
  "commandForElement" in HTMLButtonElement.prototype;

interface ResolvedTargets {
  /** Where to dispatch / invoke; empty when nothing matched. */
  targets: EventTarget[];
  /** `host: window | document` was used. */
  onHost: boolean;
}

export class Action {
  kind: ActionKind;
  /** Event / command names in source order. */
  names: string[];
  optionSources: ListenerOptionSource[];
  /** Display key: `@dispatch cart-add (detail: $d)`. */
  key: string;
  parent: Rule;
  /** Option / target problems already reported, per element. */
  private warned = new WeakMap<Element, Set<string>>();
  constructor({
    kind,
    names,
    optionSources,
    parent,
  }: {
    kind: ActionKind;
    names: EventName[];
    optionSources: ListenerOptionSource[];
    parent: Rule;
  }) {
    this.kind = kind;
    this.names = names.map((n) => n.name);
    this.optionSources = optionSources;
    this.key = `@${kind} ${eventNamesText(names)}${listenerOptionsText(optionSources)}`;
    this.parent = parent;
  }

  private warnOnce(element: Element, topic: string, message: string) {
    let topics = this.warned.get(element);
    if (!topics) this.warned.set(element, (topics = new Set()));
    if (topics.has(topic)) return;
    topics.add(topic);
    QuarkLogger.warn({
      method: this.kind,
      message: `Quark: ${this.key} — ${message} (${this.parent.selector})`,
      element,
    });
  }

  private selectTargets(
    element: HTMLElement,
    selector: string
  ): Element[] | undefined {
    return tc(() => selectAll(selector, { scope: element }) ?? []);
  }

  /** `target:` / `host:` → the event targets; the matched element by default. */
  private resolveTargets(
    element: HTMLElement,
    host: unknown,
    target: unknown,
    targetText: string | null | undefined
  ): ResolvedTargets {
    if (host === "window" || host === "document") {
      return {
        targets: [
          host === "window"
            ? ((element.ownerDocument.defaultView as EventTarget) ?? window)
            : element.ownerDocument,
        ],
        onHost: true,
      };
    }
    if (targetText === undefined) return { targets: [element], onHost: false };
    let targets: Element[] | undefined;
    if (typeof target === "string") {
      targets = this.selectTargets(element, target);
      if (!targets) {
        this.warnOnce(
          element,
          "target",
          `target "${target}" is not a valid selector`
        );
        return { targets: [], onHost: false };
      }
    } else if (target instanceof Element) {
      targets = [target];
    } else if (
      target &&
      typeof target === "object" &&
      Symbol.iterator in target
    ) {
      targets = Array.from(target as Iterable<unknown>).filter(
        (t): t is Element => t instanceof Element
      );
    } else {
      targets = [];
    }
    if (!targets.length) {
      this.warnOnce(
        element,
        "target",
        `target ${typeof target === "string" ? `"${target}"` : String(target)} matches no element`
      );
    }
    return { targets, onHost: false };
  }

  run(element: HTMLElement, options: QuarkOptions) {
    const sheet = this.parent.quarkInstance;
    const args = {
      element: element as HTMLElement & { _q_: unknown },
      key: this.key,
      value: null as string | null,
      options: { ...options, rule: this.parent },
      hash: sheet.hash,
    };
    const evaluate = (text: string) =>
      resolveExpression({
        ...args,
        key: `${this.key} option`,
        value: text,
      } as Parameters<typeof resolveExpression>[0]);
    let detail: unknown;
    let hasDetail = false;
    let form: unknown;
    let hostOption: unknown;
    let target: unknown;
    let targetText: string | null | undefined;
    const flags: Partial<Record<DispatchFlag, boolean>> = {};
    for (const { name, text, ident } of this.optionSources) {
      if (name === "target") {
        targetText = text;
        target = text === null ? undefined : evaluate(text);
        if (text === null) {
          this.warnOnce(
            element,
            name,
            `option "target" needs a selector or an element`
          );
          targetText = undefined;
        }
      } else if (this.kind === "command") {
        this.warnOnce(
          element,
          name,
          `option "${name}" is not a @command option`
        );
      } else if (name === "detail") {
        hasDetail = text !== null;
        detail = text === null ? undefined : evaluate(text);
        if (text === null)
          this.warnOnce(element, name, `option "detail" needs a value`);
      } else if (name === "form") {
        form = text === null ? undefined : evaluate(text);
        if (text === null)
          this.warnOnce(
            element,
            name,
            `option "form" needs a form or a selector`
          );
      } else if (name === "host") {
        if (ident === "window" || ident === "document") hostOption = ident;
        else
          this.warnOnce(
            element,
            name,
            `option "host" must be window or document`
          );
      } else if ((DISPATCH_FLAGS as readonly string[]).includes(name)) {
        const value = text === null ? true : evaluate(text);
        if (typeof value === "boolean") flags[name as DispatchFlag] = value;
        else this.warnOnce(element, name, `option "${name}" needs a boolean`);
      } else {
        this.warnOnce(element, name, `unknown option "${name}"`);
      }
    }
    if (isNoop(detail) || isNoop(target) || isNoop(form)) return;
    const { targets, onHost } = this.resolveTargets(
      element,
      hostOption,
      target,
      targetText
    );
    if (this.kind === "command" && onHost) return;
    const formValues = this.formValues(element, form);
    if (formValues === false) return;
    const publish = (
      name: string,
      phase: "dispatched" | "dropped",
      extra: Record<string, unknown> = {}
    ) =>
      publicize(["quark", this.kind], {
        weakElement: new WeakRef(element),
        tag: element.localName,
        selector: this.parent.selector,
        ruleId: this.parent.id,
        sheetId: sheet.id,
        runId: options.runId ?? null,
        name,
        targets: targets.length,
        phase,
        ...extra,
      });
    for (const name of this.names) {
      // the enclosing event re-dispatched from its own handler is a loop by construction
      if (
        this.kind === "dispatch" &&
        options.event &&
        options.event.type === name
      ) {
        this.warnOnce(
          element,
          `same:${name}`,
          `refusing to dispatch "${name}" from its own @on ${name} block`
        );
        publish(name, "dropped", { reason: "same-event" });
        continue;
      }
      // an unmatched `target:` already warned; nothing to send to
      targets.forEach((eventTarget) => {
        const done =
          this.kind === "dispatch"
            ? this.dispatch(eventTarget, name, {
                detail: hasDetail ? detail : undefined,
                formValues,
                flags,
              })
            : this.command(eventTarget as Element, name, element);
        if (done === false) {
          publish(name, "dropped", { reason: "loop-guard" });
        } else if (done === null) {
          publish(name, "dropped", { reason: "unsupported" });
        } else {
          publish(name, "dispatched", done);
        }
      });
    }
  }

  /** `form:` → its values (`formToJson`); `false` when the option is unusable. */
  private formValues(
    element: HTMLElement,
    form: unknown
  ): Record<string, unknown> | undefined | false {
    if (form === undefined) return undefined;
    let formElement: unknown = form;
    if (typeof form === "string") {
      const found = this.selectTargets(element, form);
      if (!found) {
        this.warnOnce(
          element,
          "form",
          `form "${form}" is not a valid selector`
        );
        return false;
      }
      formElement = found.find((el) => el instanceof HTMLFormElement);
    }
    if (!(formElement instanceof HTMLFormElement)) {
      this.warnOnce(
        element,
        "form",
        `form ${typeof form === "string" ? `"${form}"` : String(form)} is not a <form>`
      );
      return false;
    }
    return formToJson(formElement) as Record<string, unknown>;
  }

  /** Dispatch one `CustomEvent`; `false` when the loop guard dropped it. */
  private dispatch(
    target: EventTarget,
    name: string,
    {
      detail,
      formValues,
      flags,
    }: {
      detail: unknown;
      formValues: Record<string, unknown> | undefined;
      flags: Partial<Record<DispatchFlag, boolean>>;
    }
  ): Record<string, unknown> | false {
    const init: CustomEventInit = {
      bubbles: flags.bubbles ?? DISPATCH_DEFAULTS.bubbles,
      cancelable: flags.cancelable ?? DISPATCH_DEFAULTS.cancelable,
      composed: flags.composed ?? DISPATCH_DEFAULTS.composed,
    };
    // form values are the base detail; an explicit map merges over them
    const merged =
      formValues &&
      detail &&
      typeof detail === "object" &&
      !Array.isArray(detail)
        ? { ...formValues, ...(detail as Record<string, unknown>) }
        : (detail ?? formValues);
    if (merged !== undefined) init.detail = merged;
    const event = new CustomEvent(name, init);
    // `dispatchEvent` returns false when canceled; the guard's false means dropped
    const dispatched = LoopGuard.write(target, `@dispatch ${name}`, () =>
      LoopGuard.run(LoopGuard.current() + 1, () => {
        target.dispatchEvent(event);
        return true;
      })
    );
    if (dispatched === false) return false;
    return {
      bubbles: init.bubbles,
      cancelable: init.cancelable,
      composed: init.composed,
      defaultPrevented: event.defaultPrevented,
    };
  }

  /**
   * Invoke one command on `target`: through a hidden invoker button
   * where the browser has the Command API (native and custom commands
   * alike), else a synthetic `command` event for custom `--names` and a
   * direct method call for the native ones. `null` when unsupported.
   */
  private command(
    target: Element,
    name: string,
    source: HTMLElement
  ): Record<string, unknown> | false | null {
    const invoke = (): "invoker" | "event" | "method" | null => {
      if (supportsInvokers()) {
        const button = target.ownerDocument.createElement(
          "button"
        ) as HTMLButtonElement & {
          commandForElement: Element;
          command: string;
        };
        button.type = "button";
        button.style.display = "none";
        source.ownerDocument.body.appendChild(button);
        button.commandForElement = target;
        button.command = name;
        try {
          button.click();
        } finally {
          button.remove();
        }
        return "invoker";
      }
      if (name.startsWith("--")) {
        const init = { bubbles: false, cancelable: true, composed: true };
        const CommandEventCtor = (
          globalThis as {
            CommandEvent?: new (type: string, init: object) => Event;
          }
        ).CommandEvent;
        const event = CommandEventCtor
          ? new CommandEventCtor("command", { ...init, command: name, source })
          : Object.defineProperties(new CustomEvent("command", init), {
              command: { value: name },
              source: { value: source },
            });
        target.dispatchEvent(event);
        return "event";
      }
      const method = NATIVE_COMMANDS[name];
      const fn =
        method && (target as unknown as Record<string, unknown>)[method];
      if (typeof fn === "function") {
        fn.call(target);
        return "method";
      }
      return null;
    };
    let via: "invoker" | "event" | "method" | null = null;
    const done = LoopGuard.write(target, `@command ${name}`, () =>
      LoopGuard.run(LoopGuard.current() + 1, () => {
        via = invoke();
        return true;
      })
    );
    if (done === false) return false;
    if (via === null) {
      this.warnOnce(
        source,
        `command:${name}`,
        `command "${name}" is not supported here (custom commands start with --)`
      );
      return null;
    }
    return { via };
  }
}
