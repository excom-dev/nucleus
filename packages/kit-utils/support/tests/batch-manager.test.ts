import { BatchManager, ExecHandlerFn } from "../../batch-manager";
import { LoopGuard, type LoopGuardTrip } from "../../loop-guard";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/node_modules/vitest";

const execHandler: ExecHandlerFn = ([deps, fn], notifs) =>
  fn(deps.map((dep) => notifs[dep]));

const doBatch = (batchManager: BatchManager, cb: () => void) => {
  const doLock = !batchManager.isLocked;
  if (doLock) batchManager.lock();
  cb();
  if (doLock) batchManager.unlock();
};

describe("BatchManager", () => {
  it("should create a batchManager", () => {
    const batchManager = new BatchManager({ handlers: [] });
    expect(batchManager).toBeInstanceOf(BatchManager);
  });

  it("should add an handler", () => {
    const handlers = [[["foo-0"], vi.fn()]] as const;
    const batchManager = new BatchManager({ handlers, execHandler });
    expect(batchManager.handlers).toEqual(handlers);
  });

  it("should call handlers if not locked", () => {
    const handlers = [[["foo-0"], vi.fn()]] as const;
    const batchManager = new BatchManager({ handlers, execHandler });
    batchManager.notify("foo-0", "notified value");
    expect(handlers[0][1]).toHaveBeenCalledWith(["notified value"]);
  });

  it("should flush handlers when unlocked", () => {
    const handlers = [[["foo-0"], vi.fn()]] as const;
    const batchManager = new BatchManager({ handlers, execHandler });
    doBatch(batchManager, () => {
      batchManager.notify("foo-0", "notified value");
      expect(handlers[0][1]).not.toHaveBeenCalled();
    });
    expect(handlers[0][1]).toHaveBeenCalledWith(["notified value"]);
  });

  it("should call handlers sequentially when notify happens during flush", () => {
    let batchManager;
    const handlers = [
      [["foo-0"], vi.fn()],
      [
        ["bar-1"],
        vi.fn(() => {
          batchManager.notify("foo-0", "notified value");
          batchManager.notify("baz-2", "third value");
        }),
      ],
      [["baz-2"], vi.fn()],
    ] as const;
    batchManager = new BatchManager({ handlers, execHandler });
    doBatch(batchManager, () => {
      batchManager.notify("foo-0", "notified value");
      batchManager.notify("bar-1", "second value");
    });
    expect(handlers[0][1]).toHaveBeenCalledWith(["notified value"]);
    expect(handlers[1][1]).toHaveBeenCalledWith(["second value"]);
    expect(handlers[2][1]).toHaveBeenCalledWith(["third value"]);
    expect(handlers[0][1]).toHaveBeenCalledTimes(2);
    expect(handlers[1][1]).toHaveBeenCalledTimes(1);
    expect(handlers[2][1]).toHaveBeenCalledTimes(1);
  });

  it("should call handlers with latest value", () => {
    const handlers = [[["foo-0"], vi.fn()]] as const;
    const batchManager = new BatchManager({ handlers, execHandler });
    doBatch(batchManager, () => {
      batchManager.notify("foo-0", "notified value");
      batchManager.notify("foo-0", "another notified value");
    });
    expect(handlers[0][1]).toHaveBeenCalledWith(["another notified value"]);
    expect(handlers[0][1]).toHaveBeenCalledTimes(1);
  });

  it("should call handlers with latest value, only once if not processed yet, handler called with object", () => {
    let batchManager;
    const handlers = [
      [
        ["apiUrl"],
        vi.fn(() => {
          doBatch(batchManager, () => {
            batchManager.notify("payloadValue", "another value");
            batchManager.notify("emit", "not value");
          });
        }),
      ],
      [
        ["apiUrl"],
        vi.fn(() => {
          batchManager.notify("payloadValue", "another real value");
        }),
      ],
      [
        ["payloadValue"],
        vi.fn((val) => {
          batchManager.notify(
            "emit",
            val["payloadValue"] === "another real value"
              ? "real value"
              : "broken"
          );
        }),
      ],
      [["emit"], vi.fn()],
    ] as const;
    batchManager = new BatchManager({ handlers });
    doBatch(batchManager, () => {
      batchManager.notify("apiUrl", "a value");
    });
    expect(handlers[0][1]).toHaveBeenCalledWith(
      expect.objectContaining({
        apiUrl: "a value",
      })
    );
    expect(handlers[1][1]).toHaveBeenCalledWith(
      expect.objectContaining({
        apiUrl: "a value",
      })
    );
    expect(handlers[2][1]).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadValue: "another real value",
      })
    );
    expect(handlers[3][1]).toHaveBeenCalledWith(
      expect.objectContaining({
        emit: "real value",
      })
    );
    expect(handlers[0][1]).toHaveBeenCalledTimes(1);
    expect(handlers[1][1]).toHaveBeenCalledTimes(1);
    expect(handlers[2][1]).toHaveBeenCalledTimes(1);
  });

  it("multiple dependencies: runs handlers correctly", () => {
    const handlers = [
      [["foo-0", "bar-1"], vi.fn()],
      [["bar-1", "baz-2"], vi.fn()],
      [["baz-2"], vi.fn()],
    ] as const;
    const batchManager = new BatchManager({ handlers, execHandler });
    doBatch(batchManager, () => {
      batchManager.notify("foo-0", "a value");
      batchManager.notify("bar-1", "another value");
      batchManager.notify("baz-2", "real value");
    });
    expect(handlers[0][1]).toHaveBeenCalledWith(["a value", "another value"]);
    expect(handlers[1][1]).toHaveBeenCalledWith([
      "another value",
      "real value",
    ]);
    expect(handlers[2][1]).toHaveBeenCalledWith(["real value"]);
    expect(handlers[0][1]).toHaveBeenCalledTimes(1);
    expect(handlers[1][1]).toHaveBeenCalledTimes(1);
    expect(handlers[2][1]).toHaveBeenCalledTimes(1);
  });

  it("multiple dependencies: should call handlers with latest value, only once if not processed yet", () => {
    let batchManager;
    const handlers = [
      [
        ["foo-0", "bar-1"],
        vi.fn(() => {
          doBatch(batchManager, () => {
            batchManager.notify("foobar-3", "another value");
            batchManager.notify("baz-2", "not value");
          });
        }),
      ],
      [
        ["bar-1", "baz-2"],
        vi.fn(() => {
          batchManager.notify("foobar-3", "real value");
        }),
      ],
      [["baz-2"], vi.fn()],
      [["foobar-3"], vi.fn()],
    ] as const;
    batchManager = new BatchManager({ handlers, execHandler });
    doBatch(batchManager, () => {
      batchManager.notify("foo-0", "a value");
      batchManager.notify("bar-1", "another value");
    });
    expect(handlers[0][1]).toHaveBeenCalledWith(["a value", "another value"]);
    expect(handlers[1][1]).toHaveBeenCalledWith(["another value", "not value"]);
    expect(handlers[2][1]).toHaveBeenCalledWith(["not value"]);
    expect(handlers[3][1]).toHaveBeenCalledWith(["real value"]);
    expect(handlers[0][1]).toHaveBeenCalledTimes(1);
    expect(handlers[1][1]).toHaveBeenCalledTimes(1);
    expect(handlers[2][1]).toHaveBeenCalledTimes(1);
    expect(handlers[3][1]).toHaveBeenCalledTimes(1);
  });

  it("multiple dependencies: preserves order of dependency values", () => {
    const handlers = [
      [["foo-0", "bar-1"], vi.fn()],
      [["bar-1", "baz-2"], vi.fn()],
      [
        ["baz-2", "foo-0"],
        vi.fn(() => {
          batchManager.notify("foobar-3", "some value");
        }),
      ],
      [
        ["foobar-3"],
        vi.fn(() => {
          batchManager.notify("bar-1", "new value");
        }),
      ],
      [["bar-1", "baz-2", "foo-0"], vi.fn()],
    ] as const;
    const batchManager = new BatchManager({ handlers, execHandler });
    doBatch(batchManager, () => {
      batchManager.notify("foo-0", "a value");
      batchManager.notify("baz-2", "real value");
    });
    expect(handlers[0][1]).toHaveBeenCalledWith(["a value", undefined]);
    expect(handlers[1][1]).toHaveBeenCalledWith([undefined, "real value"]);
    expect(handlers[2][1]).toHaveBeenCalledWith(["real value", "a value"]);
    expect(handlers[3][1]).toHaveBeenCalledWith(["some value"]);
    expect(handlers[4][1]).toHaveBeenCalledWith([
      "new value",
      "real value",
      "a value",
    ]);
    expect(handlers[0][1]).toHaveBeenCalledTimes(2);
    expect(handlers[1][1]).toHaveBeenCalledTimes(2);
    expect(handlers[2][1]).toHaveBeenCalledTimes(1);
    expect(handlers[3][1]).toHaveBeenCalledTimes(1);
  });

  it("a handler that locks mid-flush defers the rest until unlock", () => {
    let batchManager: BatchManager;
    const handlers = [
      [
        ["foo-0"],
        vi.fn(() => {
          batchManager.lock();
        }),
      ],
      [["foo-0"], vi.fn()],
    ] as const;
    batchManager = new BatchManager({ handlers, execHandler });
    batchManager.notify("foo-0", "value");
    expect(handlers[0][1]).toHaveBeenCalledTimes(1);
    expect(handlers[1][1]).not.toHaveBeenCalled();
    // still queued, so the notifications are kept for the deferred handler
    expect(batchManager.queuedHandlers).toHaveLength(1);
    expect(batchManager.notifs).toEqual({ "foo-0": "value" });
    batchManager.unlock();
    expect(handlers[1][1]).toHaveBeenCalledWith(["value"]);
    expect(batchManager.queuedHandlers).toHaveLength(0);
    expect(batchManager.notifs).toEqual({});
  });

  it("uses a per-handler exec function and a custom clearNotifs", () => {
    const perHandler = vi.fn();
    const handlers = [
      [["foo-0"], vi.fn(), perHandler],
      [["foo-0"], vi.fn()],
    ] as const;
    const clearNotifs = vi.fn((notifs) => ({ ...notifs, cleared: true }));
    const ctx = { name: "ctx" };
    const batchManager = new BatchManager({
      handlers,
      execHandlerCtx: ctx,
      clearNotifs,
    });
    batchManager.notify("foo-0", "v");
    expect(perHandler).toHaveBeenCalledWith(handlers[0], { "foo-0": "v" });
    expect(perHandler.mock.instances[0]).toBe(ctx);
    expect(handlers[0][1]).not.toHaveBeenCalled();
    // default exec handler calls fn with the notifs as `this` = ctx
    expect(handlers[1][1]).toHaveBeenCalledWith({ "foo-0": "v" });
    expect(handlers[1][1].mock.instances[0]).toBe(ctx);
    expect(clearNotifs).toHaveBeenCalledTimes(1);
    expect(batchManager.notifs).toEqual({ "foo-0": "v", cleared: true });
  });
});

describe("BatchManager: loop guard", () => {
  let trips: LoopGuardTrip[];
  let off: () => void;

  beforeEach(() => {
    LoopGuard.reset();
    LoopGuard.configure({ log: () => {} });
    trips = [];
    off = LoopGuard.onTrip((trip) => trips.push(trip));
  });

  afterEach(() => {
    off();
    LoopGuard.reset();
  });

  it("cuts a handler that keeps re-queuing itself inside one flush", () => {
    LoopGuard.configure({ limit: 5 });
    let batchManager: BatchManager;
    const runs: number[] = [];
    const handler = vi.fn((notifs: Record<string, number>) => {
      runs.push(notifs.n);
      /* Unlocked: an effect that writes the prop it reacts to would
       * `notify` → nested flush → recurse forever. */
      batchManager.notify("n", notifs.n + 1);
    });
    const ctx = { name: "ctx" };
    batchManager = new BatchManager({
      handlers: [[["n"], handler]],
      execHandlerCtx: ctx,
    });
    expect(() => batchManager.notify("n", 0)).not.toThrow();
    expect(handler).toHaveBeenCalledTimes(5);
    expect(runs).toEqual([0, 1, 2, 3, 4]);
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({
      kind: "batch",
      target: ctx,
      name: "n",
      depth: 6,
      limit: 5,
    });
    expect(batchManager.queuedHandlers).toEqual([]);
    expect(batchManager.notifs).toEqual({});
  });

  it("cuts two handlers feeding each other through a locked batch", () => {
    LoopGuard.configure({ limit: 4 });
    let batchManager: BatchManager;
    const a = vi.fn(() => doBatch(batchManager, () => batchManager.notify("b", 1)));
    const b = vi.fn(() => doBatch(batchManager, () => batchManager.notify("a", 1)));
    batchManager = new BatchManager({
      handlers: [
        [["a"], a],
        [["b"], b],
      ],
    });
    doBatch(batchManager, () => batchManager.notify("a", 0));
    // one of the two crosses the limit first; the whole queue is dropped
    expect(a.mock.calls.length + b.mock.calls.length).toBeLessThanOrEqual(9);
    expect(trips).toHaveLength(1);
    expect(trips[0].kind).toBe("batch");
    expect(trips[0].target).toBe(batchManager);
    expect(batchManager.queuedHandlers).toEqual([]);
  });

  it("counts runs per flush, so repeated separate notifications never trip", () => {
    LoopGuard.configure({ limit: 3 });
    const handler = vi.fn();
    const batchManager = new BatchManager({ handlers: [[["n"], handler]] });
    for (let i = 0; i < 20; i++) batchManager.notify("n", i);
    expect(handler).toHaveBeenCalledTimes(20);
    expect(trips).toEqual([]);
  });

  it("does not trip a handler legitimately re-run once per dependency", () => {
    LoopGuard.configure({ limit: 3 });
    let batchManager: BatchManager;
    const handler = vi.fn((notifs: Record<string, unknown>) => {
      // reacting to `a` writes `b` once; reacting to `b` writes nothing
      if ("a" in notifs && !("b" in notifs)) batchManager.notify("b", 1);
    });
    batchManager = new BatchManager({ handlers: [[["a", "b"], handler]] });
    doBatch(batchManager, () => batchManager.notify("a", 1));
    expect(handler).toHaveBeenCalledTimes(2);
    expect(trips).toEqual([]);
  });
});
