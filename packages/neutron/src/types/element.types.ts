import type { CommandArgs, TCommandEvent } from "../command";
import type { NeutronInternal as TNeutronInternal } from "../neutron-internal";
import { Effector } from "./effect.types";
import { AnyFunction, PickGlobalElement } from "./shared.types";
import type { TokenList } from "@excom/kit-utils";

/** Neutron `emit` defaults. Intersect with `{ type; detail }` for element events. */
export type TEvent = CustomEvent & {
  bubbles: true;
  cancelable: true;
  composed: true;
};

export interface NativeNElement extends HTMLElement {
  // stub `_n_` for native / non-Neutron hosts
  _n_: {
    element: NativeNElement;
    ctr?: typeof TNeutronInternal;
    debug?: TNeutronInternal["debug"];
    eventListeners: TNeutronInternal["eventListeners"];
    disconnectedEventListeners: TNeutronInternal["disconnectedEventListeners"];
    broadcastListeners: TNeutronInternal["broadcastListeners"];
    disconnectedBroadcastListeners: TNeutronInternal["disconnectedBroadcastListeners"];
  };
}

export type NEvent<CT, T, E extends Event = CustomEvent> = Omit<
  E,
  "currentTarget" | "target"
> & {
  currentTarget: CT;
  target: T;
};

export interface SuperAddEventListenerOptions extends AddEventListenerOptions {
  target?: EventTarget;
}

export type EventListenerArgs<Fn = EventListener> = [
  string,
  Fn,
  SuperAddEventListenerOptions?,
];

export type NCustomEventInit = CustomEventInit & {
  target?: HTMLElement;
};

export type EmitArgs = [string, NCustomEventInit?];

export type GlobalEventMap = GlobalEventHandlersEventMap &
  WindowEventHandlersEventMap &
  ElementEventMap;

export type PickGlobalEvent<EventName> = EventName extends keyof GlobalEventMap
  ? GlobalEventMap[EventName]
  : CustomEvent;

export interface TCommonElementListeners {
  addListener<EventName extends keyof GlobalEventMap | string>(
    name: EventName,
    listener: (event: PickGlobalEvent<EventName>) => any,
    opts?: SuperAddEventListenerOptions
  ): void;
  addBroadcastListener<EventName extends keyof GlobalEventMap | string>(
    name: EventName,
    listener: (event: PickGlobalEvent<EventName>) => any,
    opts?: AddEventListenerOptions
  ): void;
  removeListener(
    /* `Function` is enough here; a tighter listener type does not help. */
    ...args: [string, Function, SuperAddEventListenerOptions?]
  ): void;
  removeBroadcastListener(
    ...args: [string, Function, AddEventListenerOptions?]
  ): void;
  addListeners<EventName extends keyof GlobalEventMap | string>(
    ...args: [
      EventName,
      (event: PickGlobalEvent<EventName>) => any,
      SuperAddEventListenerOptions?,
    ][]
  ): void;
  addBroadcastListeners<EventName extends keyof GlobalEventMap | string>(
    ...args: [
      EventName,
      (event: PickGlobalEvent<EventName>) => any,
      AddEventListenerOptions?,
    ][]
  ): void;
  removeListeners(
    ...args: [string, Function, SuperAddEventListenerOptions?][]
  ): void;
  removeBroadcastListeners(
    ...args: [string, Function, AddEventListenerOptions?][]
  ): void;
  toggleListeners<EventName extends keyof GlobalEventMap | string>(
    ...args: [
      EventName,
      (event: PickGlobalEvent<EventName>) => any,
      boolean,
      SuperAddEventListenerOptions?,
    ][]
  ): void;
  toggleBroadcastListeners<EventName extends keyof GlobalEventMap | string>(
    ...args: [
      EventName,
      (event: PickGlobalEvent<EventName>) => any,
      boolean,
      AddEventListenerOptions?,
    ][]
  ): void;
}

export interface TCommonElementOther {
  removeAllListeners(): void;
  removeAllBroadcastListeners(): void;
  internal_disconnectEventListeners(): void;
  internal_reconnectEventListeners(): void;
  emit(...args: EmitArgs): CustomEvent;
  emits(...args: EmitArgs[]): CustomEvent;
  broadcast(...args: EmitArgs): CustomEvent;
  broadcasts(...args: EmitArgs[]): CustomEvent;
  command(...args: CommandArgs): TCommandEvent | null;
  commands(...args: CommandArgs[]): (TCommandEvent | null)[];
}

export type PickRenderRootTag<Conf extends OptsConfig> =
  Conf["renderRoot"] extends ConfigRenderRoot
    ? PickGlobalElement<Conf["renderRoot"]["tag"]>
    : never;

export type MapPropType<
  T extends abstract new (...args: any) => any,
  DefaultValue extends (...args: any) => any = () => null,
> = T extends typeof String
  ? string | ReturnType<DefaultValue>
  : T extends typeof Number
    ? number | ReturnType<DefaultValue>
    : T extends typeof Boolean
      ? boolean
      : T extends typeof TokenList
        ? string[] | ReturnType<DefaultValue>
        : InstanceType<T> | ReturnType<DefaultValue>;

export type PropTypeKey =
  | typeof String
  | typeof Number
  | typeof Boolean
  | typeof TokenList;

export interface OptsPropConfig {
  type: PropTypeKey | Function;
  notify?: "attr" | "prop" | false;
  attr?: false | string;
  prop?: string;
  defaultValue?: () => any;
  isValid?: null | ((value: any) => boolean);
  get?: (
    element: HTMLElement,
    propStore: Record<string, unknown>,
    propConfig: PropConfig
  ) => unknown;
  set?: (
    element: HTMLElement,
    propStore: Record<string, unknown>,
    propConfig: PropConfig,
    value: unknown
  ) => void;
  serialize?: (value?: unknown) => unknown;
  deserialize?: (value?: unknown) => unknown;
  store?: "default" | "weak";
  /* TODO
   * https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet
   * When `element.matches()` understands custom state, add
   * `{ as: "attr" | "state" }` so a prop can toggle `internals`
   * (e.g. `super-input:state(invalid)`).
   */
}

export type PropConfig = Required<OptsPropConfig>;

export type DefaultProps = {
  isMounted: boolean;
  isMoving: boolean;
  isAdopted: boolean;
  wasMounted: boolean;
};
export type DefaultPropName =
  | "isMounted"
  | "isAdopted"
  | "wasMounted"
  | "isMoving"
  | "renderRoot";
export type DefaultPropsConfig = Record<DefaultPropName, OptsPropConfig>;
export interface DefaultConfig {
  props: DefaultPropsConfig;
}

// Author-facing `Neutron({ ... })` options
export interface OptsConfig {
  tag: string;
  props: Record<string, PropTypeKey | OptsPropConfig | Function>;
  reflectDefaultProps?: DefaultPropName[];
  renderRoot?: ConfigRenderRoot;
  events?: EventsConfig;
  broadcasts?: EventsConfig;
  definitionOpts?: ElementDefinitionOptions;
  methods?: [string, AnyFunction][];
  lifecycles?: Lifecycles<[string[], AnyFunction]>;
}
export type BuiltConfig = {
  tag: string;
  props: Record<string, PropConfig>;
  reflectDefaultProps: DefaultPropName[];
  renderRoot?: ConfigRenderRoot;
  events: EventsConfig;
  broadcasts: EventsConfig;
  definitionOpts?: ElementDefinitionOptions;
  methods: [string, AnyFunction][];
  lifecycles: Lifecycles<[string[], AnyFunction]>;
};
export interface RuntimeConfig {
  tag: string;
  props: Record<string, PropConfig>;
  reflectDefaultProps: DefaultPropName[];
  renderRoot?: ConfigRenderRoot;
  events: EventsConfig;
  broadcasts: EventsConfig;
  definitionOpts?: ElementDefinitionOptions;
  methods: [string, Effector<any, any>][];
  lifecycles: Lifecycles<[string[], Effector<any, any>]>;
}

export interface Lifecycles<T> {
  constructed: T[];
  connected: T[];
  adopted: T[];
  disconnected: T[];
  error: T[];
  promiseResolved: T[];
  promiseRejected: T[];
  broadcast: T[];
  event: T[];
  eventDefault: T[];
  command: T[];
  effect: T[];
  propUnset: T[];
  propSet: T[];
  propChanged: T[];
}

export type ConfigRenderRoot = {
  tag: keyof HTMLElementTagNameMap;
  shadow?: ShadowRootMode;
  defaultSlots?: boolean;
};

export interface EventsConfig {
  [eventType: string]: {
    prefixWithTag?: boolean;
  };
}
