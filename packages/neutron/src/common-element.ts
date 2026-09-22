import { CommandArgs, invokeCommand } from "./command";
import type { NeutronElement as TNeutronElement } from "./neutron-element";
import type { NeutronInternal as TNeutronInternal } from "./neutron-internal";
import type {
  EmitArgs,
  NativeNElement,
  RuntimeConfig,
  SuperAddEventListenerOptions,
} from "./types";
import { KitLogger } from "@excom/kit-logger";

const findExistingListenerIndex = (listenerArray, type, fn) => {
  return listenerArray.findIndex(([t, f]) => t === type && f === fn);
};

export const deref = <T extends HTMLElement | Node | EventTarget>(
  el: T | WeakRef<T>
): T | undefined => {
  return el instanceof WeakRef ? el.deref() : el;
};

export const getNamespace = (
  _element: NativeNElement | HTMLElement | TNeutronElement
): NativeNElement["_n_"] => {
  const element = _element as NativeNElement;
  if (!element._n_) {
    element._n_ = {
      element: element,
      eventListeners: [],
      disconnectedEventListeners: [],
      disconnectedBroadcastListeners: [],
      broadcastListeners: [],
    };
  }
  if (!element._n_.eventListeners) {
    element._n_.eventListeners = [];
  }
  if (!element._n_.broadcastListeners) {
    element._n_.broadcastListeners = [];
  }
  return element._n_;
};

export const buildEventType = (
  type: string,
  ctr: typeof TNeutronInternal | undefined,
  opts: OptsWithInternal = { _broadcast: false }
): string => {
  const config = ctr?.runtimeConfig as RuntimeConfig;
  if (!opts._broadcast && config?.events?.[type]?.prefixWithTag) {
    return `${config.tag}-${type}`;
  } else if (opts._broadcast && config?.broadcasts?.[type]?.prefixWithTag) {
    return `${config.tag}-${type}`;
  }
  return type;
};

export const BROADCAST_CHANNEL = new EventTarget();

interface OptsWithInternal extends SuperAddEventListenerOptions {
  _broadcast?: boolean;
}

const CommonElement = {
  addListener(_type, fn, _opts: OptsWithInternal = { _broadcast: false }) {
    const { element, ctr } = getNamespace(this);
    const type = buildEventType(_type, ctr, _opts);

    // TODO clean up this inconsistent _parent args approach
    const { _broadcast, target, ...opts } = _opts;
    const listenerArray = _broadcast
      ? element._n_.broadcastListeners
      : element._n_.eventListeners;
    const foundIndex = findExistingListenerIndex(listenerArray, type, fn);
    const host = _broadcast ? BROADCAST_CHANNEL : target || element;
    if (foundIndex < 0) {
      // first registration of this (type, fn)
      host.addEventListener.apply(host, [type, fn, opts]);
      listenerArray.push([
        type,
        fn,
        // @ts-ignore fix weakref typing here
        {
          ...opts,
          ...(target ? { target: new WeakRef(target) } : {}),
        },
      ]);
    }
    // same fn already listed: leave it
  },

  addBroadcastListener(type, fn, opts: SuperAddEventListenerOptions = {}) {
    CommonElement.addListener.apply(this, [
      type,
      fn,
      { ...opts, _broadcast: true },
    ]);
  },

  removeListener(_type, fn, _opts: OptsWithInternal = { _broadcast: false }) {
    const { element, ctr } = getNamespace(this);
    const type = buildEventType(_type, ctr, _opts);

    const { _broadcast } = _opts;

    const listenerArray = _broadcast
      ? element._n_.broadcastListeners
      : element._n_.eventListeners;
    const foundIndex = findExistingListenerIndex(listenerArray, type, fn);
    if (foundIndex > -1) {
      const listenerArgsToRemove = listenerArray[foundIndex];
      if (!_broadcast) {
        const host = _opts.target || element;
        host.removeEventListener.apply(host, listenerArgsToRemove);
        element._n_.eventListeners = element._n_.eventListeners.filter(
          ([t, f]) =>
            !(t === listenerArgsToRemove[0] && f === listenerArgsToRemove[1])
        );
      } else {
        BROADCAST_CHANNEL.removeEventListener.apply(
          BROADCAST_CHANNEL,
          listenerArgsToRemove
        );
        element._n_.broadcastListeners = element._n_.broadcastListeners.filter(
          ([t, f]) =>
            !(t === listenerArgsToRemove[0] && f === listenerArgsToRemove[1])
        );
      }
    }
  },

  removeBroadcastListener(type, fn, opts: SuperAddEventListenerOptions = {}) {
    CommonElement.removeListener.apply(this, [
      type,
      fn,
      { ...opts, _broadcast: true },
    ]);
  },

  addListeners(...args: [string, Function, OptsWithInternal][]) {
    args.forEach(([type, listener, options]) =>
      CommonElement.addListener.apply(this, [type, listener, options])
    );
  },

  addBroadcastListeners(
    ...args: [string, Function, SuperAddEventListenerOptions][]
  ) {
    args.forEach(([type, listener, options]) =>
      CommonElement.addListener.apply(this, [
        type,
        listener,
        { ...(options || {}), _broadcast: true },
      ])
    );
  },

  removeListeners(...args: [string, Function, OptsWithInternal][]) {
    args.forEach((params) => CommonElement.removeListener.apply(this, params));
  },

  removeBroadcastListeners(
    ...args: [string, Function, SuperAddEventListenerOptions][]
  ) {
    args.forEach(([type, listener, options]) =>
      CommonElement.removeListener.apply(this, [
        type,
        listener,
        { ...(options || {}), _broadcast: true },
      ])
    );
  },

  toggleListeners(...args: [string, Function, boolean, OptsWithInternal][]) {
    args.forEach(([type, listener, toggle, options]) => {
      const action = toggle ? "addListener" : "removeListener";
      CommonElement[action].apply(this, [type, listener, options]);
    });
  },

  toggleBroadcastListeners(
    ...args: [string, Function, boolean, SuperAddEventListenerOptions][]
  ) {
    args.forEach(([type, listener, toggle, options]) => {
      const action = toggle ? "addListener" : "removeListener";
      CommonElement[action].apply(this, [
        type,
        listener,
        { ...(options || {}), _broadcast: true },
      ]);
    });
  },

  removeAllListeners(opts = { _broadcast: false }) {
    const { element } = getNamespace(this);
    if (!opts?._broadcast) {
      element._n_.eventListeners
        ?.filter((params) =>
          params?.[2]?.target ? !!deref(params[2].target) : true
        )
        ?.forEach((params) =>
          CommonElement.removeListener.apply(element, [
            params[0],
            params[1],
            {
              ...params[2],
              ...(params[2]?.target ? { target: deref(params[2].target) } : {}),
            },
          ])
        );
    } else {
      element._n_.broadcastListeners?.forEach((params) =>
        CommonElement.removeListener.apply(element, [
          params[0],
          params[1],
          { ...(params[2] || {}), _broadcast: true },
        ])
      );
    }
  },

  removeAllBroadcastListeners() {
    CommonElement.removeAllListeners.apply(this, [{ _broadcast: true }]);
  },

  internal_disconnectEventListeners(opts = { _broadcast: false }) {
    const { element } = getNamespace(this);
    if (!opts?._broadcast) {
      element._n_.disconnectedEventListeners = element._n_.eventListeners || [];
      element._n_.eventListeners
        ?.filter((params) =>
          params?.[2]?.target ? !!deref(params[2].target) : true
        )
        ?.forEach((params) =>
          CommonElement.removeListener.apply(element, [
            params[0],
            params[1],
            {
              ...params[2],
              ...(params[2]?.target ? { target: deref(params[2].target) } : {}),
            },
          ])
        );
    } else {
      element._n_.disconnectedBroadcastListeners =
        element._n_.broadcastListeners || [];
      element._n_.broadcastListeners?.forEach((params) =>
        CommonElement.removeListener.apply(element, [
          params[0],
          params[1],
          { ...(params[2] || {}), _broadcast: true },
        ])
      );
    }
  },
  internal_disconnectBroadcastListeners(opts = {}) {
    CommonElement.internal_disconnectEventListeners.apply(this, [
      { ...opts, _broadcast: true },
    ]);
  },

  internal_reconnectEventListeners(opts = { _broadcast: false }) {
    const { element } = getNamespace(this);
    if (!opts?._broadcast) {
      element._n_.disconnectedEventListeners
        // `once` is not reconnected: we cannot tell if it already fired
        ?.filter(
          (params) =>
            !params?.[2]?.once &&
            (params?.[2]?.target ? !!deref(params[2].target) : true)
        )
        ?.forEach((params) =>
          CommonElement.addListener.apply(element, [
            params[0],
            params[1],
            {
              ...params[2],
              ...(params[2]?.target ? { target: deref(params[2].target) } : {}),
            },
          ])
        );
      element._n_.disconnectedEventListeners = [];
    } else {
      element._n_.disconnectedBroadcastListeners
        ?.filter((params) => !params?.[2]?.once)
        ?.forEach((params) =>
          CommonElement.addListener.apply(element, [
            params[0],
            params[1],
            { ...(params[2] || {}), _broadcast: true },
          ])
        );
      element._n_.disconnectedBroadcastListeners = [];
    }
  },
  internal_reconnectBroadcastListeners(opts = {}) {
    CommonElement.internal_reconnectEventListeners.apply(this, [
      { ...opts, _broadcast: true },
    ]);
  },

  emit(
    _type: EmitArgs[0],
    eventInitObj: EmitArgs[1] = {},
    opts = { _broadcast: false }
  ) {
    const { target, ...eventInit } = eventInitObj;
    const el = target || this;
    if (!_type || !el) {
      throw new Error(
        `CommonElement.emit: Event target and type are required.`
      );
    }
    const { element, ctr } = getNamespace(el);
    const type = buildEventType(_type, ctr, opts);

    const event = new CustomEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      ...eventInit,
    });
    if (!element.isConnected) {
      KitLogger.warn(
        `CommonElement.emit: Element is not connected: "${
          element.localName
        }". Dispatched ${
          opts._broadcast ? "broadcast" : "event"
        } "${type}". This means your element is likely incorrectly emitting events either before connection (possibly eager prop handlers or firing event in .onConstructed()) or after disconnection (possibly due to a lack of cleanup code in .onDisconnected()). Failure to fix this issue may lead to memory leaks or unexpected behavior.`
      );
    }
    (opts._broadcast ? BROADCAST_CHANNEL : element).dispatchEvent(event);
    return event;
  },

  emits(...eventConfigs) {
    const { element } = getNamespace(this);
    return eventConfigs.map((conf) => CommonElement.emit.apply(element, conf));
  },

  broadcast(type, eventInitObj = {}) {
    CommonElement.emit.apply(this, [
      type,
      { ...eventInitObj, bubbles: false },
      { _broadcast: true },
    ]);
  },

  broadcasts(...eventConfigs) {
    const { element } = getNamespace(this);
    return eventConfigs.map((conf) =>
      CommonElement.broadcast.apply(element, conf)
    );
  },

  /*
   * Invoke a command: `command: ["--fetch", { target }]`. The element is
   * the `source` (and the target, when none is given). A `--` command
   * dispatches a `command` event; a built-in verb goes through a proxy
   * button (see `invokeCommand`).
   */
  command(name: CommandArgs[0], init: CommandArgs[1] = {}) {
    const { element } = getNamespace(this);
    const target = init.target || element;
    const source = init.source === undefined ? element : init.source;
    return invokeCommand(target, name, source);
  },

  commands(...commandConfigs: CommandArgs[]) {
    const { element } = getNamespace(this);
    return commandConfigs.map((conf) =>
      CommonElement.command.apply(element, conf)
    );
  },
};

export { CommonElement };
