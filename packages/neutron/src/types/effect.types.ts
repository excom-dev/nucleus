import type { IgnoredEffectorResult } from "../constants";
import { TCommonElementListeners, TCommonElementOther } from "./element.types";
import { AnyFunction, GuaranteedFields, Obj } from "./shared.types";

type _CommonElementListenerSignatures = {
  [Key in keyof TCommonElementListeners]?:
    | Parameters<TCommonElementListeners[Key]>
    | IgnoredEffectorResult;
};
export interface CommonElementListenerSignatures extends _CommonElementListenerSignatures {}

type _CommonElementOtherSignatures = {
  [Key in keyof TCommonElementOther]?:
    | Parameters<TCommonElementOther[Key]>
    | IgnoredEffectorResult;
};

// Must be exported so other packages emit a usable .d.ts
export interface CommonElementOtherSignatures extends _CommonElementOtherSignatures {}

// Must be exported so other packages emit a usable .d.ts
export interface MetaProps {
  returns?: unknown;
}

// BaseEffect
export type BaseEffect<Props> = CommonElementOtherSignatures &
  MetaProps &
  Partial<Props>;

export type ChildEffect<
  Props,
  BottomOfEffect = never,
  C = GuaranteedFields<Props>,
> = {
  [Key in keyof C as C[Key] extends HTMLElement ? Key : never]?:
    | (C[Key] extends HTMLElement
        ? BaseEffect<C[Key]> &
            (BottomOfEffect extends never
              ? {}
              : CommonElementListenerSignatures)
        : never)
    | C[Key]
    | null;
};

export type BaseNative = BaseEffect<HTMLElement>;
export type Effect<
  Props,
  // _BaseEffect = BaseNative & BaseEffect<Props>,
  _BaseEffect = BaseNative & BaseEffect<Props>,
  // _BottomOfEffect = _BaseEffect & ChildEffect<Props>,
  // _EffectWithoutListeners = _BaseEffect & ChildEffect<Props, _BottomOfEffect>,
  _EffectWithoutListeners = _BaseEffect,
  TopLevelListeners = CommonElementListenerSignatures,
> = (_EffectWithoutListeners & TopLevelListeners) | IgnoredEffectorResult;

type ValidateEffect<_CE, _ResultObject, _EffectSpec> = any;
/*
 * TODO validate return type
 * = EffectSpec;
 * = {
 *   [Key in keyof ResultObject]: Key extends keyof EffectSpec
 *     ? EffectSpec[Key]
 *     : never;
 * };
 * ResultObject: the effect the author returned.
 * EffectSpec: what this element may receive (config, lifecycle, …).
 * : ResultObject extends IgnoredEffectorResult
 * ? IgnoredEffectorResult
 */
type ValidateEffectorResult<CE, Result, EffectSpec> =
  Result extends Array<Obj>
    ? Array<ValidateEffect<CE, Result[number], EffectSpec>>
    : Result extends Obj
      ? ValidateEffect<CE, Result, EffectSpec>
      : never;
type CA = unknown[] | void;

export type Effector<
  El = any,
  EffectSpec = {},
  CustomArgs extends CA = void,
  // pass `CustomArgs`, or we infer them
> = AnyFunction extends (
  element: any,
  ...args: infer _CustomArgs
) => infer Result
  ? (
      element: El,
      ...args: CustomArgs extends void ? _CustomArgs : CustomArgs
    ) => ValidateEffectorResult<El, Result, EffectSpec>
  : never;

export interface EffectorOptions<
  InputValidator = (...args: any) => false | unknown[],
  OutputValidator = (...args: any) => boolean,
> {
  delayNextTask?: boolean;
  /** Run after the current dispatch / stack, before the next task. */
  delayMicrotask?: boolean;
  validateInput?: InputValidator;
  validateOutput?: OutputValidator;
}
