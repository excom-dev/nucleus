import { toArray } from "./common";

type QueueName = string;
type QueueStatus =
  | "pending"
  | "settling"
  | "canceled"
  | "resolved"
  | "rejected";
type State = { status: QueueStatus; value?: any };
type Config = {
  name?: QueueName;
  initialValue?: any;
};
type QueueCallback = (state: State, config: Config) => any;
type OneOrManyCbs = QueueCallback | QueueCallback[];

export class Queue {
  config: Config;
  state: State;
  callbacks: {
    [key in QueueStatus]: Array<QueueCallback>;
  } = {
    pending: [],
    settling: [],
    canceled: [],
    resolved: [],
    rejected: [],
  };
  waitingStates = ["pending", "settling"];
  finishedStates = ["resolved", "rejected", "canceled"];

  constructor(opts?: Config) {
    this.init(opts);
  }
  private init(opts: Config = {}) {
    this.config = {
      name: opts?.name,
      initialValue: opts?.initialValue,
    };
    // drop stale state so a finished queue cannot leak
    // @ts-expect-error - these are set in the subsequent call to _changeState
    this.state = undefined;
    return this._changeState({ status: "pending", value: opts?.initialValue });
  }

  onPending(cbs: OneOrManyCbs) {
    return this._on("pending", cbs);
  }
  offPending(cbs: OneOrManyCbs) {
    return this._off("pending", cbs);
  }
  oncePending(cbs: OneOrManyCbs) {
    return this._once("pending", cbs);
  }
  reset(opts: Config = this.config) {
    this.cancel();
    this.init(opts);
    return this;
  }
  onResolved(cbs: OneOrManyCbs) {
    return this._on("resolved", cbs);
  }
  offResolved(cbs: OneOrManyCbs) {
    return this._off("resolved", cbs);
  }
  onceResolved(cbs: OneOrManyCbs) {
    return this._once("resolved", cbs);
  }
  resolve(value?: any) {
    return this._changeState({ status: "resolved", value });
  }
  onRejected(cbs: OneOrManyCbs) {
    return this._on("rejected", cbs);
  }
  offRejected(cbs: OneOrManyCbs) {
    return this._off("rejected", cbs);
  }
  onceRejected(cbs: OneOrManyCbs) {
    return this._once("rejected", cbs);
  }
  reject(value?: any) {
    return this._changeState({ status: "rejected", value });
  }
  onCanceled(cbs: OneOrManyCbs) {
    return this._on("canceled", cbs);
  }
  offCanceled(cbs: OneOrManyCbs) {
    return this._off("canceled", cbs);
  }
  onceCanceled(cbs: OneOrManyCbs) {
    return this._once("canceled", cbs);
  }
  cancel(value?: any) {
    return this._changeState({ status: "canceled", value });
  }
  onSettling(cbs: OneOrManyCbs) {
    return this._on("settling", cbs);
  }
  offSettling(cbs: OneOrManyCbs) {
    return this._off("settling", cbs);
  }
  onceSettling(cbs: OneOrManyCbs) {
    return this._once("settling", cbs);
  }
  settle(syncOrAsyncValue?: any) {
    if (syncOrAsyncValue instanceof Promise) {
      this._changeState({ status: "settling", value: syncOrAsyncValue });
      syncOrAsyncValue
        .then(
          (v) =>
            // still this promise, and the queue has not finished
            this.state.value === syncOrAsyncValue &&
            !this.isFinished(this?.state?.status) &&
            this._changeState({ status: "resolved", value: v })
        )
        .catch(
          (v) =>
            // still this promise, and the queue has not finished
            this.state.value === syncOrAsyncValue &&
            !this.isFinished(this?.state?.status) &&
            this._changeState({ status: "rejected", value: v })
        );
      return this;
    } else if (!this.isFinished(this?.state?.status)) {
      return this._changeState({ status: "resolved", value: syncOrAsyncValue });
    } else {
      return this;
    }
  }
  private _on(status: QueueStatus, _cbs: OneOrManyCbs) {
    const callbacks = toArray(_cbs);
    callbacks.forEach((cb) => {
      if (!this.callbacks[status].includes(cb)) {
        this.callbacks[status].push(cb);
      }
      if (this.state.status === status) {
        cb(this.state, this.config);
      }
    });
    return this;
  }
  private _off(status: QueueStatus, _cbs: OneOrManyCbs) {
    const callbacks = toArray(_cbs);
    this.callbacks[status] = this.callbacks[status].filter(
      (cb) => !callbacks.includes(cb)
    );
    return this;
  }
  private _once(status: QueueStatus, _cbs: OneOrManyCbs) {
    const callbacks = toArray(_cbs);
    const onceCb = () => {
      callbacks.forEach((cb) => cb(this.state, this.config));
      this._off(status, onceCb);
    };
    return this._on(status, onceCb);
  }
  private _changeState({
    status,
    value,
  }: {
    status: QueueStatus;
    value?: any;
  }) {
    if (this.isFinished(this?.state?.status) && status === "settling") {
      // finished queues do not re-enter settling
      return this;
    }
    if (this.isWaiting(status) || this.isWaiting(this?.state?.status)) {
      this.state = {
        value,
        status,
      };
      // snapshot: a callback may `.offResolved` (etc.) mid-loop
      [...this.callbacks[status]].forEach((cb) => cb(this.state, this.config));
    }
    return this;
  }

  private isFinished(status: QueueStatus) {
    return this.finishedStates.includes(status);
  }

  private isWaiting(status: QueueStatus) {
    return this.waitingStates.includes(status);
  }
}
/*
 * Callbacks run synchronously: on enqueue if the queue is already
 * resolved, or in the same turn it resolves. No microtask hop (unlike
 * Promise). Also supports cancel.
 */
export class QueueManager {
  queues: Record<QueueName, Queue> = {};
  createQueue(queueName: QueueName, initialConf: Config = {}) {
    if (this.queues[queueName]) {
      this.queues[queueName].cancel();
    }
    this.queues[queueName] = new Queue({ name: queueName, ...initialConf });
    return this.queues[queueName];
  }
  deleteQueue(queueName: QueueName) {
    if (this.queues[queueName]) {
      this.queues[queueName].cancel();
      delete this.queues[queueName];
      return true;
    } else {
      return false;
    }
  }
  getQueue(queueName: QueueName, initialConf?: Config) {
    return this.queues[queueName] || this.createQueue(queueName, initialConf);
  }
}
