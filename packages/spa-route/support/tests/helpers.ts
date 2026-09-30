import { wait } from "@excom/heft-rig/profiles/default/config/test-utils";

export type StandInTransition = ViewTransition & {
  types: Set<string>;
  phase: "pending" | "updating" | "updated";
  isSkipped: boolean;
  /** Ends the animation of a transition installed with `hold`. */
  finish: () => void;
};

/**
 * Chromium-like `document.startViewTransition` for happy-dom (which has
 * none). `update` runs a task later, after the old-state capture. A skip
 * (`skipTransition()`, a newer transition, a hidden page) rejects `ready`
 * with an `AbortError` and still runs `update`. `finished` settles a task
 * after the update, or on `finish()` with `hold`. `restore()` removes it.
 */
export const installViewTransition = ({ hold = false } = {}) => {
  const doc = document as Document & { startViewTransition?: unknown };
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
    let finish!: () => void;
    const skipped = new Promise<"skipped">(
      (resolve) => (skip = () => resolve("skipped"))
    );
    const animated = new Promise<void>((resolve) => (finish = resolve));
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
        await Promise.race([skipped, hold ? animated : wait(0)]);
      } finally {
        if (active === transition) active = undefined;
      }
    })();
    const transition = {
      types: new Set(types),
      phase: "pending",
      isSkipped: false,
      ready,
      updateCallbackDone,
      finished,
      finish,
      skipTransition: () => {
        transition.isSkipped = true;
        skip();
      },
    } as StandInTransition;
    if (document.visibilityState === "hidden") transition.skipTransition();
    active = transition;
    calls.push(transition);
    return transition;
  };
  return {
    calls,
    restore: () => {
      delete doc.startViewTransition;
    },
  };
};

/** Collects unhandled promise rejections until `stop()`. */
export const trackUnhandledRejections = () => {
  const reasons: unknown[] = [];
  const onRejection = (reason: unknown) => reasons.push(reason);
  process.on("unhandledRejection", onRejection);
  return {
    reasons,
    stop: () => process.off("unhandledRejection", onRejection),
  };
};
