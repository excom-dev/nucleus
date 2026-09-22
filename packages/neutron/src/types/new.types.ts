import type { TCommandEvent } from "../command";
import type { BROADCAST_CHANNEL } from "../common-element";
import type { NeutronElement as TNeutronElement } from "../neutron-element";
import type { NeutronInternal as TNeutronInternal } from "../neutron-internal";
import { Effect, Effector } from "./effect.types";
import type {
  BuiltConfig,
  MapPropType,
  NEvent,
  OptsConfig,
  OptsPropConfig,
  PropTypeKey,
} from "./element.types";
import {
  AnyFunction,
  Constructor,
  GuaranteedField,
  NullField,
} from "./shared.types";

export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

export type PropsConfigObj = Record<
  string,
  PropTypeKey | OptsPropConfig | Function
>;

export type ElementProps<P extends PropsConfigObj> = {
  [Name in keyof P]: P[Name] extends OptsPropConfig
    ? P[Name]["type"] extends Constructor
      ? P[Name]["defaultValue"] extends Function
        ? MapPropType<P[Name]["type"], P[Name]["defaultValue"]>
        : MapPropType<P[Name]["type"]>
      : never
    : P[Name] extends Constructor
      ? MapPropType<P[Name]>
      : never;
};

export type BuildProps<P extends PropsConfigObj, CT> = CT extends {}
  ? Omit<ElementProps<P>, keyof CT> & CT
  : ElementProps<P>;

declare const __customElement: unique symbol;

export type CustomElement<Props> = TNeutronElement &
  Props & { readonly [__customElement]?: Props };

export interface ElementBuilder<
  Conf extends OptsConfig,
  CT,
  Props = BuildProps<Conf["props"], CT>,
  CE = CustomElement<Props>,
> {
  CustomElement: CE;
  Props: Props;
  Config: Conf;
  CustomTypes: CT;
  builtConfig: BuiltConfig;
  /**
   * Type-only: merge `T` into the element type up front, so methods in a
   * single `defineMethods({...})` can reference each other through
   * `element`. Runtime no-op.
   */
  withTypes<T>(): ElementBuilder<Conf, CT & T>;
  defineMethods: <
    FnObj extends Record<string, Effector<CE, Effect<Props>>>,
    MethodSignatures = {
      [Name in keyof FnObj]: <
        RestArgs extends any[] = Parameters<FnObj[Name]> extends [
          any,
          ...infer Rest,
        ]
          ? Rest
          : never,
      >(
        ...args: RestArgs
      ) => ReturnType<FnObj[Name]> extends { returns: infer T } ? T : never;
    },
  >(
    methods: FnObj
  ) => ElementBuilder<Conf, CT & MethodSignatures>;
  onConstructed(fn: Effector<CE, Effect<Props>>): this;
  offConstructed(fn: AnyFunction): this;
  onConnected(fn: Effector<CE, Effect<Props>>): this;
  offConnected(fn: AnyFunction): this;
  onDisconnected(fn: Effector<CE, Effect<Props>>): this;
  offDisconnected(fn: AnyFunction): this;
  onAdopted(fn: Effector<CE, Effect<Props>>): this;
  offAdopted(fn: AnyFunction): this;
  onError(fn: Effector<CE, Effect<Props>, [Error]>): this;
  offError(fn: AnyFunction): this;
  onPropSet<Name extends keyof Props & keyof CE>(
    name: Name,
    fn: Effector<GuaranteedField<CE, Name>, Effect<Props>, [Partial<Props>]>
  ): this;
  offPropSet(name: keyof Props, fn: AnyFunction): this;
  onPropUnset<Name extends keyof Props & keyof CE>(
    name: Name,
    fn: Effector<NullField<CE, Name>, Effect<Props>, [Partial<Props>]>
  ): this;
  offPropUnset(name: keyof Props, fn: AnyFunction): this;
  onPropChanged(
    name: keyof Props | (keyof Props)[],
    fn: Effector<CE, Effect<Props>, [Partial<Props>]>
  ): this;
  offPropChanged(name: keyof Props, fn: AnyFunction): this;
  onEffect(
    name: (keyof Props)[],
    fn: Effector<CE, Effect<Props>, [Partial<Props>]>
  ): this;
  offEffect(name: (keyof Props)[], fn: AnyFunction): this;
  onPromiseResolved<Name extends keyof Props>(
    name: Name,
    fn: Effector<CE, Effect<Props>, [Record<Name, UnwrapPromise<Props[Name]>>]>
  ): this;
  offPromiseResolved(name: keyof Props, fn: AnyFunction): this;
  onPromiseRejected<Name extends keyof Props>(
    name: Name,
    fn: Effector<CE, Effect<Props>, [Record<Name, Error>]>
  ): this;
  offPromiseRejected(name: keyof Props, fn: AnyFunction): this;
  onBroadcast(
    name: string,
    fn: Effector<
      CE,
      Effect<Props>,
      [
        NEvent<
          typeof BROADCAST_CHANNEL | null,
          typeof BROADCAST_CHANNEL,
          CustomEvent
        >,
      ]
    >
  ): this;
  offBroadcast(name: string, fn: AnyFunction): this;
  onEvent(
    name: string,
    fn: Effector<CE, Effect<Props>, [NEvent<CE, Element | null, CustomEvent>]>
  ): this;
  offEvent(name: string, fn: AnyFunction): this;
  onEventDefault(
    name: string,
    fn: Effector<CE, Effect<Props>, [NEvent<Element | null, CE, CustomEvent>]>
  ): this;
  offEventDefault(name: string, fn: AnyFunction): this;
  /**
   * Handle a `command` event whose `command` is one of `name` (custom
   * commands only: `--verb`). Runs after the dispatch, in a microtask,
   * unless a listener called `preventDefault()`.
   */
  onCommand(
    name: string | string[],
    fn: Effector<CE, Effect<Props>, [NEvent<CE, CE, TCommandEvent>]>
  ): this;
  offCommand(name: string | string[], fn: AnyFunction): this;
  define: typeof TNeutronInternal.define;
}
