import { Queue, QueueManager } from "../../queue-manager";
import {
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/node_modules/vitest";

const doNotCall = vi.fn(() => {
  // must not run
  throw new Error("This should not be called");
});

/* Settling is driven by hand rather than by a timer: `settle()` reacts in
 * microtasks, so nothing here depends on wall-clock time. */
const deferred = <T = unknown>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/* `settle()` hops `.then` → `.catch`, so a rejection needs two turns. */
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("queue-manager", () => {
  it("QueueManager", () => {
    const queueManager = new QueueManager();
    expect(queueManager).toBeDefined();

    // createQueue
    const queue = queueManager.createQueue("testQueue2", {
      initialValue: "initial",
    });
    expect(queue.state.status).toBe("pending");
    expect(queue.state.value).toBe("initial");
    expect(queue.config.name).toBe("testQueue2");
    expect(queue.config.initialValue).toBe("initial");

    // getQueue (new queue)
    expect(queueManager.getQueue("testQueue")).toBeDefined();
    expect(queueManager.getQueue("testQueue").state.status).toBe("pending");
    expect(queueManager.getQueue("testQueue").state.value).toBeUndefined();
    expect(queueManager.getQueue("testQueue").config.name).toBe("testQueue");
    expect(
      queueManager.getQueue("testQueue").config.initialValue
    ).toBeUndefined();

    // getQueue (existing queue)
    const existingQueue = queueManager.getQueue("testQueue2");
    expect(existingQueue).toBeDefined();
    expect(existingQueue.state.status).toBe("pending");
    expect(existingQueue.state.value).toBe("initial");
    expect(existingQueue.config.name).toBe("testQueue2");
    expect(existingQueue.config.initialValue).toBe("initial");

    // deleteQueue
    expect(queueManager.deleteQueue("testQueue2")).toBe(true);
    expect(queueManager.queues["testQueue2"]).toBeUndefined();
  });
  it("Queue happypath", async () => {
    const queueManager = new QueueManager();
    const queue = queueManager.getQueue("testQueue", { initialValue: "foo" });

    // starts pending
    expect(queue.state.status).toBe("pending");
    expect(queue.state.value).toBe("foo");
    expect(queue.config.name).toBe("testQueue");
    expect(queue.config.initialValue).toBe("foo");

    const resolveCb = vi.fn(() => {});

    queue.onResolved(resolveCb);
    queue.onRejected(doNotCall);
    queue.onCanceled(doNotCall);

    queue.resolve("success");
    expect(resolveCb).toHaveBeenCalledTimes(1);
    expect(resolveCb).toHaveBeenCalledWith(
      {
        status: "resolved",
        value: "success",
      },
      expect.anything()
    );
    expect(queue.state.status).toBe("resolved");
    expect(queue.state.value).toBe("success");

    // already resolved: later pending cbs do not run
    queue.reject(new Error("fail"));
    queue.cancel(new Error("canceled"));

    // register while already in that state: run now
    const newResolvedCallback = vi.fn(() => {});
    queue.onResolved(newResolvedCallback);
    expect(newResolvedCallback).toHaveBeenCalledTimes(1);
    expect(newResolvedCallback).toHaveBeenCalledWith(
      {
        status: "resolved",
        value: "success",
      },
      {
        name: "testQueue",
        initialValue: "foo",
      }
    );
    queue.offResolved(newResolvedCallback);

    // reset
    queue.reset();
    queue.offResolved(resolveCb);
    queue.offRejected(doNotCall);
    queue.offCanceled(doNotCall);
    expect(queue.state.status).toBe("pending");

    // reject
    const rejectCb = vi.fn(() => {});
    queue.onResolved(doNotCall);
    queue.onCanceled(doNotCall);
    queue.onRejected(rejectCb);

    queue.reject(new Error("fail"));
    expect(rejectCb).toHaveBeenCalledTimes(1);
    expect(rejectCb).toHaveBeenCalledWith(
      {
        status: "rejected",
        value: new Error("fail"),
      },
      expect.anything()
    );
    expect(queue.state.status).toBe("rejected");
    expect(queue.state.value.message).toBe("fail");
    queue.offRejected(rejectCb);
    queue.offResolved(doNotCall);
    queue.offCanceled(doNotCall);

    // settle promise (resolve)
    queue.reset();
    const resolveCb2 = vi.fn(() => {});
    queue.onResolved(resolveCb2);
    queue.onRejected(doNotCall);
    queue.onCanceled(doNotCall);
    const succeeding = deferred<string>();
    queue.settle(succeeding.promise);
    expect(resolveCb2).toHaveBeenCalledTimes(0);
    succeeding.resolve("final success");
    await flush();
    expect(resolveCb2).toHaveBeenCalledWith(
      {
        status: "resolved",
        value: "final success",
      },
      expect.anything()
    );
    expect(queue.state.status).toBe("resolved");
    expect(queue.state.value).toBe("final success");
    queue.offResolved(resolveCb2);
    queue.offRejected(doNotCall);
    queue.offCanceled(doNotCall);

    // settle promise (reject)
    queue.reset();
    const rejectCb2 = vi.fn(() => {});
    queue.onResolved(doNotCall);
    queue.onCanceled(doNotCall);
    queue.onRejected(rejectCb2);
    const failing = deferred<string>();
    queue.settle(failing.promise);
    expect(rejectCb2).toHaveBeenCalledTimes(0);
    failing.reject(new Error("final fail"));
    await flush();
    expect(rejectCb2).toHaveBeenCalledWith(
      {
        status: "rejected",
        value: new Error("final fail"),
      },
      expect.anything()
    );
    expect(queue.state.status).toBe("rejected");
    expect(queue.state.value.message).toBe("final fail");
    queue.offRejected(rejectCb2);
    queue.offResolved(doNotCall);
    queue.offCanceled(doNotCall);

    // settle promise (cancel)
    queue.reset();
    const cancelCb2 = vi.fn(() => {});
    queue.onResolved(doNotCall);
    queue.onRejected(doNotCall);
    queue.onCanceled(cancelCb2);
    const abandoned = deferred<string>();
    queue.settle(abandoned.promise);
    expect(cancelCb2).toHaveBeenCalledTimes(0);
    queue.cancel(new Error("canceled"));
    expect(cancelCb2).toHaveBeenCalledTimes(1);
    // the abandoned promise settles after the cancel and must not win
    abandoned.resolve("actually not");
    await flush();
    expect(cancelCb2).toHaveBeenCalledWith(
      {
        status: "canceled",
        value: new Error("canceled"),
      },
      expect.anything()
    );
    expect(queue.state.status).toBe("canceled");
    expect(queue.state.value.message).toBe("canceled");
    queue.offCanceled(cancelCb2);
    queue.offResolved(doNotCall);
    queue.offRejected(doNotCall);

    // `once()`
    queue.reset();
    const onceResolvedCb = vi.fn(() => {});
    queue.onceResolved(onceResolvedCb);
    queue.resolve("once success");
    expect(onceResolvedCb).toHaveBeenCalledTimes(1);
    expect(onceResolvedCb).toHaveBeenCalledWith(
      {
        status: "resolved",
        value: "once success",
      },
      expect.anything()
    );
    expect(queue.state.status).toBe("resolved");
    expect(queue.state.value).toBe("once success");
    queue.reset();
    queue.resolve("should not call again");
    expect(onceResolvedCb).toHaveBeenCalledTimes(1);
    queue.offResolved(onceResolvedCb);

    // cancel
    queue.reset();
    const cancelCb = vi.fn(() => {});
    queue.onResolved(doNotCall);
    queue.onRejected(doNotCall);
    queue.onCanceled(cancelCb);
    queue.cancel(new Error("canceled"));
    expect(cancelCb).toHaveBeenCalledTimes(1);
    expect(cancelCb).toHaveBeenCalledWith(
      {
        status: "canceled",
        value: new Error("canceled"),
      },
      expect.anything()
    );
    expect(queue.state.status).toBe("canceled");
    expect(queue.state.value.message).toBe("canceled");
    queue.offCanceled(cancelCb);
    queue.offResolved(doNotCall);
    queue.offRejected(doNotCall);
  });

  it("Queue pending callbacks fire on init and reset, once() only once", () => {
    const queue = new Queue({ initialValue: "start" });
    const pendingCb = vi.fn(() => {});
    queue.onPending(pendingCb);
    // already pending: invoked immediately
    expect(pendingCb).toHaveBeenCalledTimes(1);
    expect(pendingCb).toHaveBeenCalledWith(
      { status: "pending", value: "start" },
      { name: undefined, initialValue: "start" }
    );
    queue.resolve("done");
    queue.reset();
    expect(pendingCb).toHaveBeenCalledTimes(2);
    queue.offPending(pendingCb);
    queue.resolve("done");
    queue.reset({ initialValue: "again" });
    expect(pendingCb).toHaveBeenCalledTimes(2);

    const oncePending = vi.fn(() => {});
    queue.oncePending(oncePending);
    expect(oncePending).toHaveBeenCalledTimes(1);
    expect(oncePending).toHaveBeenCalledWith(
      { status: "pending", value: "again" },
      expect.anything()
    );
    queue.resolve("x");
    queue.reset();
    expect(oncePending).toHaveBeenCalledTimes(1);
  });

  it("Queue once callbacks for rejected, canceled and settling", () => {
    const queue = new Queue();
    const onceRejected = vi.fn(() => {});
    queue.onceRejected(onceRejected);
    queue.reject("bad");
    queue.reset();
    queue.reject("bad again");
    expect(onceRejected).toHaveBeenCalledTimes(1);
    expect(onceRejected).toHaveBeenCalledWith(
      { status: "rejected", value: "bad" },
      expect.anything()
    );

    queue.reset();
    const onceCanceled = vi.fn(() => {});
    queue.onceCanceled(onceCanceled);
    queue.cancel("stop");
    queue.reset();
    queue.cancel("stop again");
    expect(onceCanceled).toHaveBeenCalledTimes(1);
    expect(onceCanceled).toHaveBeenCalledWith(
      { status: "canceled", value: "stop" },
      expect.anything()
    );

    queue.reset();
    const onceSettling = vi.fn(() => {});
    queue.onceSettling(onceSettling);
    const first = Promise.resolve("a");
    queue.settle(first);
    expect(onceSettling).toHaveBeenCalledTimes(1);
    expect(onceSettling).toHaveBeenCalledWith(
      { status: "settling", value: first },
      expect.anything()
    );
    queue.settle(Promise.resolve("b"));
    expect(onceSettling).toHaveBeenCalledTimes(1);
  });

  it("Queue settling callbacks can be added, invoked immediately and removed", async () => {
    const queue = new Queue();
    const settlingCb = vi.fn(() => {});
    const inFlight = deferred<string>();
    queue.settle(inFlight.promise);
    expect(queue.state.status).toBe("settling");
    queue.onSettling(settlingCb);
    expect(settlingCb).toHaveBeenCalledTimes(1);
    queue.offSettling(settlingCb);
    inFlight.resolve("v");
    await flush();
    expect(queue.state.status).toBe("resolved");
    expect(queue.state.value).toBe("v");
    queue.reset();
    queue.settle(Promise.resolve("w"));
    expect(settlingCb).toHaveBeenCalledTimes(1);
  });

  it("Queue settle with a plain value resolves unless already finished", () => {
    const queue = new Queue();
    const resolved = vi.fn(() => {});
    queue.onResolved(resolved);
    expect(queue.settle("sync")).toBe(queue);
    expect(queue.state).toEqual({ status: "resolved", value: "sync" });
    expect(resolved).toHaveBeenCalledTimes(1);
    // finished: a second settle is ignored
    expect(queue.settle("later")).toBe(queue);
    expect(queue.state.value).toBe("sync");
    expect(resolved).toHaveBeenCalledTimes(1);
    queue.reset();
    queue.cancel();
    expect(queue.settle("after cancel")).toBe(queue);
    expect(queue.state.status).toBe("canceled");
  });

  it("Queue settle with a promise is ignored once finished", async () => {
    const queue = new Queue();
    const settlingCb = vi.fn(() => {});
    const resolvedCb = vi.fn(() => {});
    queue.onSettling(settlingCb);
    queue.resolve("first");
    queue.onResolved(resolvedCb);
    expect(resolvedCb).toHaveBeenCalledTimes(1);
    expect(queue.settle(Promise.resolve("second"))).toBe(queue);
    expect(settlingCb).not.toHaveBeenCalled();
    expect(queue.state.status).toBe("resolved");
    await flush();
    expect(queue.state.value).toBe("first");
    expect(resolvedCb).toHaveBeenCalledTimes(1);
  });

  it("Queue replacing an in-flight promise ignores the stale result", async () => {
    const queue = new Queue();
    const resolvedCb = vi.fn(() => {});
    const rejectedCb = vi.fn(() => {});
    queue.onResolved(resolvedCb);
    queue.onRejected(rejectedCb);
    const stale = deferred<string>();
    const staleRejecting = deferred<string>();
    const fresh = deferred<string>();
    queue.settle(stale.promise);
    queue.settle(staleRejecting.promise);
    queue.settle(fresh.promise);
    expect(queue.state).toEqual({ status: "settling", value: fresh.promise });
    // both replaced promises settle while `fresh` is still in flight
    stale.resolve("stale");
    staleRejecting.reject(new Error("stale failure"));
    await flush();
    expect(queue.state.status).toBe("settling");
    expect(resolvedCb).not.toHaveBeenCalled();
    expect(rejectedCb).not.toHaveBeenCalled();
    fresh.resolve("fresh");
    await flush();
    expect(queue.state).toEqual({ status: "resolved", value: "fresh" });
    expect(resolvedCb).toHaveBeenCalledTimes(1);
  });

  it("Queue cancel during a rejecting promise wins", async () => {
    const queue = new Queue();
    const canceledCb = vi.fn(() => {});
    const rejectedCb = vi.fn(() => {});
    queue.onCanceled(canceledCb);
    queue.onRejected(rejectedCb);
    const failing = deferred();
    queue.settle(failing.promise);
    queue.cancel("abort");
    expect(canceledCb).toHaveBeenCalledTimes(1);
    // the rejection lands after the cancel and must be ignored
    failing.reject(new Error("late"));
    await flush();
    expect(queue.state).toEqual({ status: "canceled", value: "abort" });
    expect(rejectedCb).not.toHaveBeenCalled();
  });

  it("Queue does not register the same callback twice", () => {
    const queue = new Queue();
    const cb = vi.fn(() => {});
    queue.onResolved(cb);
    queue.onResolved([cb, cb]);
    expect(queue.callbacks.resolved).toHaveLength(1);
    queue.resolve("v");
    expect(cb).toHaveBeenCalledTimes(1);
    // removing an unknown callback is a no-op
    queue.offResolved(() => {});
    expect(queue.callbacks.resolved).toHaveLength(1);
    queue.offResolved(cb);
    expect(queue.callbacks.resolved).toHaveLength(0);
  });

  it("Queue callbacks may unsubscribe themselves during dispatch", () => {
    const queue = new Queue();
    const order: string[] = [];
    const first = () => {
      order.push("first");
      queue.offResolved(first);
    };
    const second = () => order.push("second");
    queue.onResolved([first, second]);
    queue.resolve();
    expect(order).toEqual(["first", "second"]);
    queue.reset();
    queue.resolve();
    expect(order).toEqual(["first", "second", "second"]);
  });

  it("QueueManager cancels a queue it replaces and reports missing deletes", () => {
    const queueManager = new QueueManager();
    const original = queueManager.createQueue("q");
    const canceled = vi.fn(() => {});
    original.onCanceled(canceled);
    const replacement = queueManager.createQueue("q", { initialValue: 1 });
    expect(replacement).not.toBe(original);
    expect(canceled).toHaveBeenCalledTimes(1);
    expect(original.state.status).toBe("canceled");
    expect(queueManager.getQueue("q")).toBe(replacement);
    expect(queueManager.getQueue("q").state.value).toBe(1);
    expect(queueManager.deleteQueue("nope")).toBe(false);
    const deleted = vi.fn(() => {});
    replacement.onCanceled(deleted);
    expect(queueManager.deleteQueue("q")).toBe(true);
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(queueManager.getQueue("q", { initialValue: 2 }).state.value).toBe(2);
  });
});
