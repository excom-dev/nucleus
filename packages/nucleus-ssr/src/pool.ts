import { emptyDiagnostics } from "./diagnostics";
import { builtin, type Child, forkWorker, later } from "./node";
import {
  openRenderer,
  type PageInputs,
  type RendererOptions,
} from "./renderer";
import {
  keyOf,
  type Outcome,
  perform,
  type Ready,
  type Reply,
  type Task,
} from "./worker";

/** The renderers `prerender()` hands its pages to. */
export interface Renderers {
  /** Their part of the cache key. */
  key: string;
  /** `url` rendered, as the not-found page or not, with the time (ms) its renderer took. */
  render(url: string, notFound?: boolean): Promise<Outcome & { ms: number }>;
  /** `url`'s untouched shell, not rendered, with the time (ms) it took. */
  shell(url: string): Promise<Outcome & { ms: number }>;
  /** What of a cached page's inputs answers otherwise, if anything, with the time (ms) the check took. */
  changed(
    url: string,
    inputs: PageInputs
  ): Promise<{ changed?: string; ms: number }>;
  close(): Promise<void>;
}

type Done = Exclude<Reply, { type: "fatal" }> & { ms: number };
type Job = {
  task: Task;
  started?: number;
  resolve(done: Done): void;
  reject(error: unknown): void;
};

/** A renderer that takes one job at a time; `ready` while it takes jobs. */
type Slot = { ready: boolean; job?: Job; start(job: Job): void };

// a page still rendering at this many times `budgetMs` never yields
const STOP_AT = 2;
/** A worker that has served no renderer by then (ms) never will. */
export const STARTUP_MS = 300_000;

/**
 * Renderers taking one task at a time, in order: this process's, or `size`
 * workers, each started with `env` added to its environment. A worker that
 * exits or runs past twice its `budgetMs` is replaced; its page fails, then
 * gets its policy from another.
 */
export async function openRenderers(
  from:
    | { options: RendererOptions }
    | { worker: string; size: number; env?: Record<string, string> }
): Promise<Renderers> {
  const { clearTimeout } = builtin("node:timers");
  const jobs: Job[] = [];
  const slots = new Set<Slot>();
  // each slot's end: closing its renderer, or stopping its worker
  const stops: (() => Promise<void>)[] = [];
  let closing = false;
  let broken: { error: unknown } | undefined;
  let key: string | undefined;
  let opened!: { resolve(): void; reject(error: unknown): void };
  const open = new Promise<void>(
    (resolve, reject) => (opened = { resolve, reject })
  );
  const close = async () => {
    closing = true;
    await Promise.all(stops.map((stop) => stop()));
  };

  const dispatch = () => {
    for (const slot of slots) {
      if (!slot.ready || slot.job || !jobs.length) continue;
      const job = jobs.shift()!;
      job.started ??= Date.now();
      slot.job = job;
      slot.start(job);
    }
  };
  const fail = (error: unknown) => {
    broken ??= { error };
    opened.reject(error);
    [...jobs.splice(0), ...Array.from(slots, ({ job }) => job)].forEach((job) =>
      job?.reject(error)
    );
  };
  /** Ends `slot`'s job with `reply`, then hands it the next. */
  const settle = (slot: Slot, reply: Reply) => {
    const { job } = slot;
    slot.job = undefined;
    if (!job) return;
    if (reply.type === "fatal") {
      job.reject(reply.error);
      return fail(reply.error);
    }
    job.resolve({ ...reply, ms: Date.now() - job.started! });
    dispatch();
  };
  const ready = (slot: Slot, reported: string) => {
    if (key !== undefined && reported !== key)
      return fail(
        new Error(
          "nucleus-ssr: the workers report different cache keys: their cacheKey() must give each the same"
        )
      );
    key = reported;
    slot.ready = true;
    opened.resolve();
    dispatch();
  };

  if ("options" in from) {
    const renderer = await openRenderer(from.options);
    const slot: Slot = {
      ready: false,
      start: async (job) => settle(slot, await perform(renderer, job.task)),
    };
    slots.add(slot);
    stops.push(() => renderer.close());
    ready(slot, keyOf(renderer));
  } else {
    /** A worker in a slot of its own, replaced once it exits. */
    const spawn = () => {
      let child: Child;
      try {
        child = forkWorker(from.worker, from.env);
      } catch (error) {
        return fail(error);
      }
      const slot: Slot = {
        ready: false,
        start(job) {
          child.send(job.task);
          timer = later(() => {
            slot.ready = false;
            lose(
              `Not settled within budgetMs (${budgetMs} ms): the page never yielded, so its worker was stopped at ${STOP_AT * budgetMs} ms`,
              `its check never yielded, so its worker was stopped at ${STOP_AT * budgetMs} ms`
            );
            child.kill("SIGKILL");
          }, STOP_AT * budgetMs);
        },
      };
      let served = false;
      let budgetMs = 0;
      let timer: unknown;
      const startup = later(
        () =>
          fail(
            new Error(
              `nucleus-ssr: worker ${from.worker} served no renderer within ${STARTUP_MS / 1000} s`
            )
          ),
        STARTUP_MS
      );
      /** Ends the job of a worker that stops: a check finds a change (`checkError`), a page fails (`error`) and then gets its policy. */
      const lose = (error: string, checkError: string) => {
        clearTimeout(timer);
        const { job } = slot;
        slot.job = undefined;
        if (!job) return;
        const { task } = job;
        const ms = Date.now() - job.started!;
        if (task.type === "check")
          return job.resolve({
            type: "checked",
            changed: checkError,
            ms,
          });
        if (task.type === "lost")
          return job.resolve({
            type: "page",
            outcome: { diagnostics: task.diagnostics },
            ms,
          });
        const diagnostics = { ...emptyDiagnostics(), errors: [error] };
        jobs.unshift({
          ...job,
          task: { type: "lost", url: task.url, diagnostics },
        });
        dispatch();
      };
      let exit!: () => void;
      const exited = new Promise<void>((resolve) => (exit = resolve));
      child.on("exit", (code, signal) => {
        slots.delete(slot);
        clearTimeout(startup);
        exit();
        if (closing || broken) return;
        const how = signal ?? `code ${code}`;
        if (!served)
          return fail(
            new Error(
              `nucleus-ssr: worker ${from.worker} exited (${how}) before it served a renderer`
            )
          );
        lose(
          `The worker rendering this page exited (${how})`,
          `its worker exited during the check (${how})`
        );
        spawn();
      });
      child.on("message", (message: Ready | Reply) => {
        if (message.type === "ready") {
          clearTimeout(startup);
          served = true;
          budgetMs = message.budgetMs;
          return ready(slot, message.key);
        }
        clearTimeout(timer);
        // before `ready`, only a failure to open
        if (!served) return fail((message as { error?: unknown }).error);
        settle(slot, message);
      });
      // a send to a worker that just exited: its exit follows. One that
      // never started may never exit
      child.on("error", (error) => {
        if (child.pid === undefined) {
          clearTimeout(startup);
          exit();
        }
        if (!served) fail(error);
      });
      slots.add(slot);
      stops.push(async () => {
        child.kill("SIGKILL");
        await exited;
      });
    };
    for (let count = 0; count < from.size && !broken; count++) spawn();
  }

  try {
    await open;
  } catch (error) {
    await close();
    throw error;
  }
  const run = (task: Task) =>
    new Promise<Done>((resolve, reject) => {
      if (broken) return reject(broken.error);
      jobs.push({ task, resolve, reject });
      dispatch();
    });
  const page = async (task: Task) => {
    const done = await run(task);
    return {
      ...(done as Extract<Done, { type: "page" }>).outcome,
      ms: done.ms,
    };
  };
  return {
    key: key!,
    render: (url, notFound) => page({ type: "render", url, notFound }),
    shell: (url) => page({ type: "shell", url }),
    async changed(url, inputs) {
      const done = await run({ type: "check", url, inputs });
      return {
        changed: (done as Extract<Done, { type: "checked" }>).changed,
        ms: done.ms,
      };
    },
    close,
  };
}
