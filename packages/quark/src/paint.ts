/**
 * Paint queues and the commit that flushes them.
 *
 * Resolvers never write the document directly: they schedule a paint.
 * Paints batch into two priority queues and commit together in a later
 * task, avoiding extra reflows and observer trips. Priority 0 (high): add
 * DOM nodes. Priority 1 (low): set attrs. Needed because setting an attr
 * on a custom element can trigger a query; if that runs before children
 * are inserted, the query misses them.
 *
 * View transitions (`@view-transition`): a paint may carry a
 * `PaintTransition`. When a commit holds one that changes the document,
 * the commit runs inside `document.startViewTransition()`:
 *
 * - pending: the browser captures the old state at its next rendering
 *   opportunity, so nothing commits until it calls `update`;
 * - updating: `update` commits every queued paint (flagged or not: one
 *   tick is one cut), then waits for Quark to settle (`whenSettled`,
 *   capped by `timeout`, optionally `until` a fact); commits meanwhile
 *   run inline, inside the same cut;
 * - then the browser captures the new state and animates.
 *
 * Without a flagged paint, or when no transition can run (no API, reduced
 * motion, hidden document, nothing would change, another transition
 * active under `if-active: skip`), the commit is plain.
 */
import type { SettleUntil } from "./settle";
import { addBusyCheck, whenSettled } from "./settle";
import type { PaintFn } from "./types";
import { QuarkLogger } from "./utils";
import { getDevtoolsHook, publicize } from "@excom/kit-devtools";
import { LoopGuard, tc } from "@excom/kit-utils";

let callbacksToRun: Array<() => void> = [];
let commitTimeout: ReturnType<typeof setTimeout> | null = null;

export const reqCommit = (cb: () => void) => {
  if (!callbacksToRun.includes(cb)) {
    callbacksToRun.push(cb);
    if (!commitTimeout) {
      commitTimeout = setTimeout(() => {
        const cbs = [...callbacksToRun];
        callbacksToRun = [];
        commitTimeout = null;
        cbs.forEach((cb) => cb());
      }, 0);
    }
  }
};

/** How a flagged paint is committed (resolved `@view-transition` options). */
export interface PaintTransition {
  /** `startViewTransition({ types })`, unioned across one commit. */
  types: string[];
  /** Cap on how long `update` waits for Quark to settle, in ms. */
  timeout: number;
  /** Hold the paint back this long before queuing it, in ms. */
  delay?: number;
  /** Another transition is active: commit unanimated, or start anyway. */
  ifActive: "skip" | "replace";
  /** Keep `update` open until this is met (capped by `timeout`). */
  until?: SettleUntil;
  /** The block's display text (`@view-transition (types: "t")`). */
  source: string;
}

/** One queued paint. */
export interface PaintEntry {
  /** The paint, inside the loop-guard depth of the run that scheduled it. */
  run: () => void;
  transition?: PaintTransition;
  /**
   * Commit-time check for a flagged paint: `false` when committing it
   * would leave the document as it is. Absent means it changes something.
   */
  willChange?: () => boolean;
}

export const PAINT_QUEUES: [Set<PaintEntry>, Set<PaintEntry>] = [
  new Set(),
  new Set(),
];
// TODO consider making each queue a Map with unique attr keys to prevent duplicate paints

/** Queued paints that carry a transition, in queue order. */
const flaggedPaints = new Set<PaintEntry>();

/** Where the current commit cycle is in a transition (see module comment). */
let phase: "pending" | "updating" | null = null;
/** Id of the latest transition cycle; a stale `update` / fallback is ignored. */
let cycle = 0;
/** The transition Quark started, until its `finished` settles. */
let ownTransition: ViewTransition | null = null;
/** Once-per-block warnings (`source` + kind). */
const warned = new Set<string>();

/** A pending transition whose `update` never arrives commits anyway. */
const PENDING_FALLBACK_MS = 1000;

addBusyCheck(
  () => commitTimeout !== null || PAINT_QUEUES.some((queue) => queue.size > 0)
);

const warnOnce = (key: string, message: string) => {
  if (warned.has(key)) return;
  warned.add(key);
  QuarkLogger.warn({ method: "viewTransition", message });
};

const enqueue = (entry: PaintEntry, priority: number) => {
  PAINT_QUEUES[priority].add(entry);
  if (entry.transition) flaggedPaints.add(entry);
  reqCommit(paint);
};

const runEntry = (entry: PaintEntry) => {
  try {
    entry.run();
  } catch (error) {
    QuarkLogger.error({
      method: "paint",
      message: "Quark: a paint threw; the other paints still commit",
      error: [error],
    });
  }
};

/** Commit every queued paint, high priority first. */
const drain = () =>
  PAINT_QUEUES.forEach((queue, priority) => {
    const entries = Array.from(queue);
    if (entries.length) {
      QuarkLogger.info({
        method: `triggerPaint(${priority})`,
        numberOfPaints: entries.length,
      });
    }
    entries.forEach((entry) => {
      queue.delete(entry);
      if (entry.transition) flaggedPaints.delete(entry);
      runEntry(entry);
    });
  });

const paint = () => {
  // the pending transition's `update` commits everything
  if (phase === "pending") return;
  if (phase === null && flaggedPaints.size && startTransition()) return;
  drain();
};

export const schedulePaint = (
  action: PaintFn,
  priority: number = 1,
  extras?: Pick<PaintEntry, "transition" | "willChange">
) => {
  // paints commit in a later task: carry the causal depth of the run that
  // scheduled them so the loop guard sees one continuous chain
  const depth = LoopGuard.current();
  const entry: PaintEntry = {
    run: () => LoopGuard.run(depth, action),
    transition: extras?.transition,
    willChange: extras?.willChange,
  };
  const delay = entry.transition?.delay;
  if (delay) {
    setTimeout(
      () =>
        enqueue(
          { ...entry, transition: { ...entry.transition!, delay: 0 } },
          priority
        ),
      delay
    );
    return;
  }
  enqueue(entry, priority);
};

const isTransitionActive = () =>
  !!ownTransition ||
  !!(document as Document & { activeViewTransition?: unknown })
    .activeViewTransition ||
  tc(() => document.documentElement.matches(":active-view-transition")) ===
    true;

/** The flagged paints that would change the document (a throwing check counts). */
const changing = (entries: Iterable<PaintEntry>) =>
  [...entries].filter((e) => !e.willChange || tc(e.willChange) !== false);

/** Why a commit with flagged paints commits plainly; `null` when it can animate. */
const skipReason = (changed: PaintEntry[]): string | null => {
  if (typeof document.startViewTransition !== "function") return "unsupported";
  if (
    tc(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches) ===
    true
  ) {
    return "reduced-motion";
  }
  if (document.visibilityState === "hidden") return "hidden";
  if (!changed.length) return "unchanged";
  if (changed[0].transition!.ifActive !== "replace" && isTransitionActive()) {
    return "active";
  }
  return null;
};

const typesOf = (entries: PaintEntry[]) => [
  ...new Set(entries.flatMap((entry) => entry.transition!.types)),
];

/** DevTools: `quark/transition` for a commit's flagged paints. */
const publish = (
  phase: string,
  entries: PaintEntry[],
  meta?: Record<string, unknown>
) => {
  if (getDevtoolsHook()?.publicize) {
    publicize(["quark", "transition"], {
      phase,
      ...meta,
      types: typesOf(entries),
      paints: entries.length,
    });
  }
};

/**
 * Commit the queued paints inside a view transition. `false` when none
 * can run (an engine without transition types throws on the options
 * object and lands here too); the caller then commits plainly.
 */
const startTransition = (): boolean => {
  // paints that change nothing neither start a transition nor name it
  const flagged = changing(flaggedPaints);
  const reason = skipReason(flagged);
  if (reason) {
    publish("skip", [...flaggedPaints], { reason });
    return false;
  }
  const types = typesOf(flagged);
  let transition: ViewTransition | undefined;
  const id = ++cycle;
  const update = async () => {
    clearTimeout(fallback);
    // the fallback already committed (maybe another transition is pending
    // now): capture whatever is there
    if (id !== cycle || phase !== "pending") return;
    phase = "updating";
    try {
      // flagged paints queued while pending join this cut
      const cut = changing(flaggedPaints);
      for (const type of typesOf(cut)) {
        if (!types.includes(type)) transition?.types?.add(type);
      }
      const withUntil = cut.filter((entry) => entry.transition!.until);
      for (const { transition: extra } of withUntil.slice(1)) {
        warnOnce(
          `${extra!.source}:until`,
          `Quark: ${extra!.source} — one \`until\` per view transition; this one is ignored`
        );
      }
      const wait = withUntil[0]?.transition;
      const timeout = Math.max(0, ...cut.map((e) => e.transition!.timeout));
      drain();
      const result = await whenSettled({ timeout, until: wait?.until });
      publish("settled", cut, { result });
      if (result === "timeout") {
        const source = wait?.source ?? cut[0]?.transition!.source;
        warnOnce(
          `${source}:timeout`,
          `Quark: ${source} — ${wait ? "`until` was not met" : "Quark did not settle"} within ${timeout}ms; the new state was captured anyway`
        );
      }
    } finally {
      phase = null;
      if (PAINT_QUEUES.some((queue) => queue.size > 0)) reqCommit(paint);
    }
  };
  phase = "pending";
  const fallback = setTimeout(() => {
    if (id !== cycle || phase !== "pending") return;
    phase = null;
    drain();
  }, PENDING_FALLBACK_MS);
  try {
    transition = document.startViewTransition({ update, types });
  } catch {
    clearTimeout(fallback);
    phase = null;
    publish("skip", flagged, { reason: "error" });
    return false;
  }
  const started = transition;
  ownTransition = started;
  const release = () => {
    if (ownTransition === started) ownTransition = null;
  };
  const ignore = () => {};
  started.finished?.then(release, release);
  started.ready?.catch(ignore);
  started.updateCallbackDone?.catch(ignore);
  publish("start", flagged);
  return true;
};
