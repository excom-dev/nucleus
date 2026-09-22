import { LoopGuard } from "./loop-guard";

type Fn = (...args: any[]) => any;
export type DependencyName = string;
export type DependencyValue = any;
export type BatchHandler = readonly [
  readonly DependencyName[],
  Fn,
  ExecHandlerFn?,
];
export type BatchHandlers = BatchHandler[];
export type BatchHandlersInput = ReadonlyArray<BatchHandler>;
export type Notifs = Record<DependencyName, DependencyValue>;
export type ExecHandlerFn = (handler: BatchHandler, notifs: Notifs) => any;
export type ClearNotifsFn = (notifs: Notifs) => Notifs;

function defaultExecHandler([_, fn], notifs) {
  fn.call(this, notifs);
}

export class BatchManager {
  isLocked: boolean = false;
  handlers: BatchHandlers = [];
  queuedHandlers: BatchHandlers = [];
  notifs: Notifs = {};
  execHandlerCtx?: any;
  execHandler: ExecHandlerFn;
  clearNotifs: ClearNotifsFn;

  constructor({
    handlers = [],
    execHandler,
    execHandlerCtx,
    clearNotifs,
  }: {
    handlers: BatchHandlersInput;
    execHandlerCtx?: any;
    execHandler?: ExecHandlerFn;
    clearNotifs?: ClearNotifsFn;
  }) {
    this.handlers = [...handlers];
    this.notifs = {};
    this.execHandlerCtx = execHandlerCtx;
    this.execHandler = execHandler || defaultExecHandler;
    this.clearNotifs = clearNotifs || ((_) => ({}));
  }
  lock() {
    this.isLocked = true;
  }
  unlock() {
    this.isLocked = false;
    this.flushHandlers();
  }
  notify(dependencyName: DependencyName, dependencyValue: DependencyValue) {
    this.notifs[dependencyName] = dependencyValue;
    this.handlers.forEach((handler) => {
      if (
        handler[0].includes(dependencyName) &&
        !this.queuedHandlers.includes(handler)
      ) {
        this.queuedHandlers.push(handler);
      }
    });
    if (!this.isLocked) {
      this.flushHandlers();
    }
  }
  /**
   * Runs per handler inside the current synchronous flush (nested flushes
   * included); `null` between flushes. A handler that keeps re-queuing
   * itself, an effect writing a prop it reacts to, two handlers feeding
   * each other, is a loop: past `LoopGuard.limit` runs the queue is
   * dropped and the trip reported.
   */
  private flushRuns: Map<BatchHandler, number> | null = null;
  flushHandlers() {
    const isOutermost = !this.flushRuns;
    const runs = (this.flushRuns ??= new Map());
    try {
      while (this.queuedHandlers.length > 0 && !this.isLocked) {
        const handler = this.queuedHandlers.shift();
        if (handler) {
          const count = (runs.get(handler) ?? 0) + 1;
          runs.set(handler, count);
          if (count > LoopGuard.limit) {
            this.queuedHandlers = [];
            const name = handler[0].join(", ");
            LoopGuard.report({
              kind: "batch",
              target: this.execHandlerCtx ?? this,
              name,
              depth: count,
              limit: LoopGuard.limit,
              message: `Loop guard: the handler for [${name}] re-ran ${count} times in one synchronous batch — likely an effect loop; the remaining queue was dropped.`,
            });
            break;
          }
          const execHandler = handler[2] || this.execHandler;
          execHandler.call(this.execHandlerCtx, handler, this.notifs);
        }
      }
    } finally {
      if (isOutermost) this.flushRuns = null;
    }
    if (this.queuedHandlers.length === 0) {
      this.notifs = this.clearNotifs(this.notifs);
    }
  }
}
