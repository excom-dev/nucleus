import { COMMAND_EVENT } from "./command";
import { CommonElement } from "./common-element";
import { PROTECTED_PROP_NAMES } from "./constants";
import { injectRendererIfNeeded, publicize } from "./devtools-hook";
import {
  LifecycleConfigs,
  registerLifecycle,
  unregisterLifecycle,
} from "./lifecycle-configs";
import type { NeutronElement as TNeutronElement } from "./neutron-element";
import { NeutronError } from "./neutron-error";
import type {
  AnyFunction,
  BuiltConfig,
  EventListenerArgs,
  Obj,
  OptsConfig,
  RuntimeConfig,
} from "./types";
import {
  createBuiltConfig,
  createRuntimeConfig,
  isBuiltInElement,
  setDebugMethodSignature,
} from "./utils";
import { KitLogger } from "@excom/kit-logger";
import {
  defineObservableProperty,
  LoopGuard,
  TokenList,
} from "@excom/kit-utils";
import {
  BatchHandlers,
  BatchManager,
  Converter,
  createElement,
  QueueManager,
} from "@excom/kit-utils";

export class NeutronInternal {
  static builtConfig: BuiltConfig;
  static runtimeConfig: RuntimeConfig;
  static batchLinkFns: AnyFunction[];
  static batchHandlers: BatchHandlers;

  static CustomElement: typeof TNeutronElement;

  ctr: typeof NeutronInternal;

  private element: TNeutronElement;
  private elementRef: WeakRef<TNeutronElement>;

  eventListeners: EventListenerArgs[] = [];
  disconnectedEventListeners: EventListenerArgs[] = [];
  broadcastListeners: EventListenerArgs[] = [];
  disconnectedBroadcastListeners: EventListenerArgs[] = [];
  propStore: Obj = {};
  queueManager = new QueueManager();
  batchManager: BatchManager;
  execDisconnect?: null | (() => void);
  debug?: {
    effects: {
      getTrace: () => string;
      trigger: any;
      effect: Obj;
    }[];
    lockLevels: string[];
  };

  /* --- PUBLIC: STATIC ELEMENT DEFINITION --- */
  static define(
    tag: string = this.builtConfig.tag,
    options: ElementDefinitionOptions | undefined = this.builtConfig
      .definitionOpts
  ) {
    if (!customElements.get(tag)) {
      this.runtimeConfig = createRuntimeConfig(this.builtConfig);
      this.CustomElement.observedAttributes = this.getObservedAttrs();
      this.buildBatching();
      customElements.define(tag, this.CustomElement, options);
      /* First define() after a hook is installed registers the renderer.
       * Late attachers should call `attachDevtools()` instead. */
      injectRendererIfNeeded();
    } else {
      KitLogger.warn(
        `Attempted to define Neutron element "${tag}", but it's already defined.`
      );
    }
  }
  /* Type-only builder step (see `ElementBuilder.withTypes`): declares
   * method signatures on the element type before they are defined. */
  static withTypes() {
    return this;
  }
  static defineMethods(methods: Record<string, AnyFunction>) {
    const entries = Object.entries(methods);
    entries.forEach(([name, fn]) => {
      setDebugMethodSignature(fn, name);
      if (typeof fn !== "function") {
        throw new Error(`Method ${name} is not a function`);
      }
      if (PROTECTED_PROP_NAMES.includes(name)) {
        throw new NeutronError(`Cannot use protected name: "${name}"`);
      }
    });
    this.builtConfig.methods.push(...entries);
    return this;
  }
  static onConstructed(fn) {
    return registerLifecycle(this, "constructed", [], fn);
  }
  static offConstructed(fn) {
    return unregisterLifecycle(this, "constructed", [], fn);
  }
  static onConnected(fn) {
    return registerLifecycle(this, "connected", [], fn);
  }
  static offConnected(fn) {
    return unregisterLifecycle(this, "connected", [], fn);
  }
  static onAdopted(fn) {
    return registerLifecycle(this, "adopted", [], fn);
  }
  static offAdopted(fn) {
    return unregisterLifecycle(this, "adopted", [], fn);
  }
  static onError(fn) {
    return registerLifecycle(this, "error", [], fn);
  }
  static offError(fn) {
    return unregisterLifecycle(this, "error", [], fn);
  }
  static onEffect(names, fn) {
    return registerLifecycle(this, "effect", names, fn);
  }
  static offEffect(names, fn) {
    return unregisterLifecycle(this, "effect", names, fn);
  }
  static onPropUnset(names, fn) {
    return registerLifecycle(this, "propUnset", names, fn);
  }
  static offPropUnset(names, fn) {
    return unregisterLifecycle(this, "propUnset", names, fn);
  }
  static onPropSet(names, fn) {
    return registerLifecycle(this, "propSet", names, fn);
  }
  static offPropSet(names, fn) {
    return unregisterLifecycle(this, "propSet", names, fn);
  }
  static onPropChanged(names, fn) {
    return registerLifecycle(this, "propChanged", names, fn);
  }
  static offPropChanged(names, fn) {
    return unregisterLifecycle(this, "propChanged", names, fn);
  }
  static onPromiseResolved(names, fn) {
    return registerLifecycle(this, "promiseResolved", names, fn);
  }
  static offPromiseResolved(names, fn) {
    return unregisterLifecycle(this, "promiseResolved", names, fn);
  }
  static onPromiseRejected(names, fn) {
    return registerLifecycle(this, "promiseRejected", names, fn);
  }
  static offPromiseRejected(names, fn) {
    return unregisterLifecycle(this, "promiseRejected", names, fn);
  }
  static onBroadcast(names, fn) {
    return registerLifecycle(this, "broadcast", names, fn);
  }
  static offBroadcast(names, fn) {
    return unregisterLifecycle(this, "broadcast", names, fn);
  }
  static onEvent(names, fn) {
    return registerLifecycle(this, "event", names, fn);
  }
  static offEvent(names, fn) {
    return unregisterLifecycle(this, "event", names, fn);
  }
  static onEventDefault(names, fn) {
    return registerLifecycle(this, "eventDefault", names, fn);
  }
  static offEventDefault(names, fn) {
    return unregisterLifecycle(this, "eventDefault", names, fn);
  }
  static onCommand(names, fn) {
    return registerLifecycle(this, "command", names, fn);
  }
  static offCommand(names, fn) {
    return unregisterLifecycle(this, "command", names, fn);
  }
  static onDisconnected(fn) {
    return registerLifecycle(this, "disconnected", [], fn);
  }
  static offDisconnected(fn) {
    return unregisterLifecycle(this, "disconnected", [], fn);
  }

  /* --- PROTECTED: STATIC ELEMENT DEFINITION --- */
  static setup(optsConfig: OptsConfig, CustomElement: typeof TNeutronElement) {
    this.builtConfig = createBuiltConfig(optsConfig);
    /* DevTools: one record per definition (no instance, so no
     * weakElement). The extension audits attribute names from it. */
    publicize(["neutron", "defined"], {
      tag: this.builtConfig.tag,
      props: Object.values(this.builtConfig.props ?? {}).map(
        ({ prop, attr }) => ({ prop, attr })
      ),
    });
    // wire the class to this Internal
    CustomElement.NeutronInternal = this;
    this.CustomElement = CustomElement;
  }
  private static getObservedAttrs() {
    return Object.values(this.runtimeConfig.props ?? {})
      .filter((propConfig) => propConfig.notify === "attr" && propConfig.attr)
      .map((propConfig) => propConfig.attr as string);
  }
  private static buildBatching() {
    const linkTracker = {};
    this.batchLinkFns = [];
    this.batchHandlers = [];
    Object.values(LifecycleConfigs).forEach((c) => {
      if (c.key && c.isBatched) {
        const batchPrefix = c.batchPrefix || "";
        const lifecycleEntries = this.runtimeConfig.lifecycles[c.key];
        lifecycleEntries.forEach((lifecycleEntry) => {
          const [batchNames, handler] = lifecycleEntry;
          if (c.triggerFn) {
            batchNames.forEach((batchName) => {
              if (!linkTracker[batchPrefix + batchName]) {
                linkTracker[batchPrefix + batchName] = true;
                this.batchLinkFns.push((instance) => {
                  c.triggerFn?.(instance, batchPrefix, batchName);
                });
              }
            });
          }
          this.batchHandlers.push([
            batchNames.map((batchName) => batchPrefix + batchName),
            handler,
            c.batchExecFn,
          ]);
        });
      }
    });
  }

  /* --- PROTECTED: INSTANCE LIFECYCLE CALLBACKS --- */
  constructor(element: TNeutronElement) {
    this.element = element;
    this.elementRef = new WeakRef(element);
    this.ctr = this.constructor as unknown as typeof NeutronInternal;
    /* Props first: methods may still be declared as props. */
    this.defineProps();
    this.ctr.runtimeConfig.methods.forEach(([name, fn]) => {
      this.element[name] = fn.bind(this.elementRef);
    });
    this.batchManager = new BatchManager({
      execHandlerCtx: this.element,
      handlers: this.ctr.batchHandlers,
      // keep notifs until mount so first-connect handlers see them
      clearNotifs: (notifs) =>
        this.element.isMounted || this.element.wasMounted ? {} : notifs,
    });
    this.batchManager.notify("message:constructed", null);
    publicize(["neutron", "constructed"], {
      weakElement: this.elementRef,
      tag: this.ctr.builtConfig.tag,
    });
    /*
     * Two construction/connection paths:
     * 1. Parser / `.innerHTML=` construct+connect in the same tick
     *    (`isConnected` is already true here).
     * 2. `createElement()` then a later sync `append` (`isConnected`
     *    is still false; `connectedCallback` resolves the queue).
     * Resolving only in `connectedCallback` works for both, but then
     * path 2 elements write attributes under MutationObservers (Quark
     * etc.). Path 1 never trips those MOs if we resolve here.
     * // this.connectedCallback();
     */
  }
  connectedCallback() {
    const execConnect = () => {
      const isFirstMount = !this.element.wasMounted;
      if (this.element.wasMounted) {
        this.reconnectListeners();
      } else {
        this.setConfiguredRenderRoot();
        this.linkBatching();
        this.connectListeners();
      }
      this.batch(() => {
        this.element.isMounted = true;
        if (!this.element.wasMounted) {
          this.batchManager.notify("message:first-mount", null);
        }
      });
      publicize(["neutron", "connected"], {
        weakElement: this.elementRef,
        tag: this.ctr.builtConfig.tag,
        isMoving: this.element.isMoving,
        isFirstMount,
      });
    };
    if (!this.execDisconnect) {
      // first connect, or after a real disconnect
      execConnect();
    } else {
      // sync re-append: a move (`isMoving`)
      this.element.isMoving = true;
      // cancel the queued disconnect microtask
      this.execDisconnect();
      execConnect();
      this.element.isMoving = false;
    }
  }
  connectedMoveCallback() {
    /* Not in every browser. Do not batch: every `isMounted=false`
     * must run before every `isMounted=true`. */
    this.disconnectedCallback();
    this.connectedCallback();
  }
  adoptedCallback() {
    this.element.isAdopted = true;
  }
  disconnectedCallback() {
    const _execDisconnect = () => {
      this.batch(() => {
        this.element.isAdopted = false;
        this.element.wasMounted = true;
        this.element.isMounted = false;
      });
      this.disconnectListeners();
      publicize(["neutron", "disconnected"], {
        weakElement: this.elementRef,
        tag: this.ctr.builtConfig.tag,
        isMoving: this.element.isMoving,
      });
    };
    this.execDisconnect = () => {
      _execDisconnect();
      // one-shot: a second call must not run _execDisconnect again
      this.execDisconnect = null;
    };
    /* If `connectedCallback` runs in this turn (before the microtask),
     * that is a move: `onDisconnected` / `onConnected` still fire, with
     * `isMoving=true`. */
    queueMicrotask(() => {
      this.execDisconnect?.();
    });
  }
  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null
  ) {
    const propConfig = this.ctr.CustomElement.getPropConfig({ attr: name });
    if (propConfig) {
      const converter = Converter.type(propConfig.type);
      const parsedOldVal = converter.attr.convert(
        propConfig.deserialize(oldValue)
      );
      const parsedNewVal = converter.attr.convert(
        propConfig.deserialize(newValue)
      );
      const propName = propConfig.prop;
      const tokensEqual = (a: unknown[], b: unknown[]) =>
        Array.isArray(a) &&
        Array.isArray(b) &&
        a.length === b.length &&
        a.every((v, i) => v === b[i]);
      const isTokens = propConfig.type === TokenList;
      // TODO can these be compared as raw attr strings?
      if (
        (!isTokens && parsedOldVal !== parsedNewVal) ||
        (isTokens && !tokensEqual(parsedOldVal, parsedNewVal))
      ) {
        this.propStore[propName] = parsedNewVal;
        // the reaction continues whatever chain wrote the attribute (a
        // Quark rule, another element's effect): see LoopGuard
        LoopGuard.run(LoopGuard.depthOf(this.element, name), () =>
          this.batchManager.notify(propName, parsedOldVal)
        );
      }
    }
  }

  /* --- PRIVATE: INSTANCE HELPERS --- */
  private defineProps() {
    if (this.ctr.runtimeConfig.props) {
      Object.keys(this.ctr.runtimeConfig.props).forEach((propName) => {
        const propConfig = this.ctr.runtimeConfig.props[propName];
        /* Accessors live here; `Neutron()` owns the types. Shared
         * helper so a pre-upgrade observer (Quark `prop()`) stays on
         * top of the base getter/setter. */
        defineObservableProperty(this.element, propName, {
          get: () => propConfig.get(this.element, this.propStore, propConfig),
          set: (newValue) => {
            const oldValue = propConfig.get(
              this.element,
              this.propStore,
              propConfig
            );
            if (newValue !== oldValue) {
              propConfig.set(
                this.element,
                this.propStore,
                propConfig,
                newValue
              );
              if (propConfig.notify === "prop") {
                this.batchManager.notify(propName, oldValue);
              }
            }
          },
        });
      });
    }
  }
  private linkBatching() {
    this.ctr.batchLinkFns.forEach((linkFn) => linkFn(this));
  }
  private connectListeners() {
    this.ctr.runtimeConfig.lifecycles.broadcast.forEach(
      ([channelNames, handler]) => {
        channelNames.forEach((channelName) => {
          CommonElement.addBroadcastListener.apply(this.element, [
            channelName,
            handler.bind(this.elementRef),
          ]);
        });
      }
    );
    [
      ...this.ctr.runtimeConfig.lifecycles.event,
      ...this.ctr.runtimeConfig.lifecycles.eventDefault,
    ].forEach(([eventNames, handler]) => {
      eventNames.forEach((eventName) => {
        CommonElement.addListener.apply(this.element, [
          eventName,
          handler.bind(this.elementRef),
        ]);
      });
    });
    /* One `command` listener per handler; the effector filters by verb. */
    this.ctr.runtimeConfig.lifecycles.command.forEach(([, handler]) => {
      CommonElement.addListener.apply(this.element, [
        COMMAND_EVENT,
        handler.bind(this.elementRef),
      ]);
    });
  }
  private reconnectListeners() {
    /* Re-attach after disconnect, including listeners on linked
     * built-in children. */
    CommonElement.internal_reconnectEventListeners.apply(this.element, []);
    CommonElement.internal_reconnectBroadcastListeners.apply(this.element, []);
    this.getAllRelatedChildElements().forEach((el) => {
      CommonElement.internal_reconnectEventListeners.apply(el, []);
      CommonElement.internal_reconnectBroadcastListeners.apply(el, []);
    });
  }
  private disconnectListeners() {
    /* Drop listeners (and those on linked built-in children) so they
     * cannot leak. */
    CommonElement.internal_disconnectEventListeners.apply(this.element, []);
    CommonElement.internal_disconnectBroadcastListeners.apply(this.element, []);
    this.getAllRelatedChildElements().forEach((el) => {
      CommonElement.internal_disconnectEventListeners.apply(el, []);
      CommonElement.internal_disconnectBroadcastListeners.apply(el, []);
    });
  }
  private getAllRelatedChildElements() {
    return Object.values(this.ctr.runtimeConfig.props)
      .filter((p) => p.type === Element || p.type?.prototype instanceof Element)
      .map((p) => p.get.call(this, this.element.attributes, this.propStore, p))
      .filter((el) => isBuiltInElement(el) && this.element.contains(el));
  }
  private setConfiguredRenderRoot() {
    const rootConfig = this.ctr.runtimeConfig.renderRoot;
    if (rootConfig) {
      const renderRoot = rootConfig.shadow
        ? this.element.attachShadow({
            mode: rootConfig.shadow,
          })
        : this.element;
      const defaultRenderRootElement = createElement(
        rootConfig.tag,
        rootConfig.shadow
          ? {
              style: "display: contents;",
            }
          : {}
      );
      renderRoot.append(
        ...[
          defaultRenderRootElement,
          rootConfig.defaultSlots &&
            createElement("slot", {
              name: "neutron-adopt",
              onslotchange: (e) => {
                const slot = e.target as HTMLSlotElement;
                const shadowDom = slot.getRootNode() as ShadowRoot;
                const templateElements = slot.assignedElements();
                while (slot.nextElementSibling) {
                  slot.nextElementSibling.remove();
                }
                templateElements.forEach((templateElement) => {
                  if (templateElement instanceof HTMLTemplateElement) {
                    const content = document.importNode(
                      templateElement.content as Node,
                      true
                    ) as Element;
                    shadowDom.append(content);
                  }
                });
              },
            }),
        ].filter(Boolean)
      );
      if (defaultRenderRootElement) {
        this.batch(() => {
          this.element.renderRoot = defaultRenderRootElement;
        });
      }
    }
  }
  batch(fn: AnyFunction) {
    const doLock = !this.batchManager.isLocked;
    try {
      if (doLock) this.batchManager.lock();
      fn();
    } finally {
      if (doLock) {
        // snapshot first: `unlock` → `flushHandlers` → `clearNotifs`
        const changedProps = Object.keys(this.batchManager.notifs);
        this.batchManager.unlock();
        if (changedProps.length) {
          publicize(["neutron", "commit"], {
            weakElement: this.elementRef,
            tag: this.ctr.builtConfig.tag,
            changedProps,
          });
        }
      }
    }
  }
}
