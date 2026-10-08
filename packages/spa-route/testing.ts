/**
 * `@excom/spa-route/testing`: helpers for testing apps built on spa-route
 * in Node (Vitest on happy-dom). Not for the browser.
 */
import { wait } from "@excom/kit-utils";

export { resetRouter } from "./src/reset-router";

// Node's global, typed here: the package has no Node types
declare const process: {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
};

/**
 * Emulates the browser landing on a known history entry (back / forward
 * button). `hasUAVisualTransition`: the browser already animated it (a swipe
 * back), so no view transition should run.
 */
export const popstate = (
  state: { id: string; url: string },
  hasUAVisualTransition = false
): void => {
  history.replaceState({ id: state.id }, "", state.url);
  const event = new PopStateEvent("popstate");
  Object.defineProperty(event, "hasUAVisualTransition", {
    value: hasUAVisualTransition,
  });
  window.dispatchEvent(event);
};

/**
 * Runs `trigger` (a click, a `popstate`) and resolves a task after `manager`
 * fires `spa-manager-rendered`. Rejects after 1 s without it.
 */
export const navigate = (
  manager: Element,
  trigger: () => unknown
): Promise<void> =>
  new Promise((resolve, reject) => {
    const settle = (outcome: () => void) => {
      clearTimeout(timeout);
      manager.removeEventListener("spa-manager-rendered", onRendered);
      outcome();
    };
    const onRendered = () => setTimeout(() => settle(resolve));
    const timeout = setTimeout(
      () =>
        settle(() =>
          reject(new Error("navigate: no spa-manager-rendered within 1 s"))
        ),
      1000
    );
    manager.addEventListener("spa-manager-rendered", onRendered);
    trigger();
  });

/** One `document.startViewTransition()` call seen by `installViewTransition`. */
export type StandInTransition = ViewTransition & {
  types: Set<string>;
  phase: "pending" | "updating" | "updated";
  isSkipped: boolean;
};

/**
 * Chromium-like `document.startViewTransition` for happy-dom (which has
 * none). `update` runs a task later, after the old-state capture. A skip
 * (`skipTransition()`, a newer transition, a hidden page) rejects `ready`
 * with an `AbortError` and still runs `update`. `finished` settles a task
 * after the update. `restore()` puts back what was there before.
 */
export const installViewTransition = () => {
  const doc = document as unknown as { startViewTransition?: unknown };
  const previous = Object.getOwnPropertyDescriptor(doc, "startViewTransition");
  const calls: StandInTransition[] = [];
  let active: StandInTransition | undefined;
  doc.startViewTransition = ({
    update,
    types = [],
  }: {
    update?: () => unknown;
    types?: string[];
  }) => {
    active?.skipTransition();
    let skip!: () => void;
    const skipped = new Promise<"skipped">(
      (resolve) => (skip = () => resolve("skipped"))
    );
    const transition = {
      types: new Set(types),
      phase: "pending",
      isSkipped: false,
      skipTransition: () => {
        transition.isSkipped = true;
        skip();
      },
    } as StandInTransition;
    const updateCallbackDone = (async () => {
      await Promise.race([wait(0), skipped]);
      transition.phase = "updating";
      await update?.();
      transition.phase = "updated";
    })();
    const updated = (async () => {
      await updateCallbackDone;
      return "updated" as const;
    })();
    const ready = (async () => {
      if ((await Promise.race([skipped, updated])) === "skipped") {
        throw new DOMException("Transition was skipped", "AbortError");
      }
    })();
    const finished = (async () => {
      try {
        await updateCallbackDone;
        await Promise.race([skipped, wait(0)]);
      } finally {
        if (active === transition) active = undefined;
      }
    })();
    Object.assign(transition, { ready, updateCallbackDone, finished });
    if (document.visibilityState === "hidden") transition.skipTransition();
    active = transition;
    calls.push(transition);
    return transition;
  };
  return {
    calls,
    restore: () => {
      if (previous) Object.defineProperty(doc, "startViewTransition", previous);
      else delete doc.startViewTransition;
    },
  };
};

/** Collects unhandled promise rejections until `stop()`: assert a navigation leaks none. */
export const trackUnhandledRejections = () => {
  const reasons: unknown[] = [];
  const onRejection = (reason: unknown) => reasons.push(reason);
  process.on("unhandledRejection", onRejection);
  return {
    reasons,
    stop: () => process.off("unhandledRejection", onRejection),
  };
};
