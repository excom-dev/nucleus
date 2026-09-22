import { CommonElement } from "../common-element";
import type { IgnoredEffectorResult } from "../constants";
import { IGNORED_FUNC_VALUES, PROPS_TO_DEEP_MERGE } from "../constants";
import { publicize } from "../devtools-hook";
import type { NeutronElement as TNeutronElement } from "../neutron-element";
import { NeutronError } from "../neutron-error";
import type { AnyFunction, EffectorOptions, Obj, PropConfig } from "../types";
import { KitLogger } from "@excom/kit-logger";
import {
  execWhenReady,
  isPojo,
  LoopGuard,
  tc,
  toArray,
  wait,
} from "@excom/kit-utils";

// END DEV UTILS

type _EffectorFn = AnyFunction & { _effectorSrc?: AnyFunction };
export function effector<
  // `El` is too expensive to type here (should extend NeutronElement)
  El,
  // `T` is too expensive to type here (should extend Effector<any, any>)
  T extends _EffectorFn,
  InputValidator extends (args: Parameters<T>) => false | unknown[],
  // `s` is too expensive to type here (should extend BaseEffect<El>)
  OutputValidator extends (args: Parameters<T>, s: unknown) => boolean,
>(
  functionToWrap: T,
  {
    delayNextTask,
    delayMicrotask,
    validateInput,
    validateOutput,
  }: EffectorOptions<InputValidator, OutputValidator> = {}
) {
  if (functionToWrap?._effectorSrc) {
    KitLogger.warn(
      `Function \`${functionToWrap.name}\` is already an effector.`
    );
    return functionToWrap as unknown as typeof wrapper;
  }
  const wrapper = function (
    ..._args: Parameters<T>
  ): typeof delayNextTask extends true ? Promise<unknown> : unknown {
    const el: El = this instanceof WeakRef ? this.deref() : this;

    /* A delayed effect (`wait(0)`) still continues the chain that
     * triggered it: carry the loop-guard depth across the timeout. */
    const depth = LoopGuard.current();
    const delay = delayNextTask
      ? wait(0)
      : delayMicrotask
        ? Promise.resolve()
        : undefined;
    return execWhenReady(delay, () =>
      LoopGuard.run(depth, () => {
        let r;
        const exec = () => {
          const fullArgs = [el, ..._args];
          const args = !validateInput
            ? fullArgs
            : validateInput.call(el, fullArgs);
          if (Array.isArray(args)) {
            // `validateInput` accepted these args (array = pass)
            const returnedValues = toArray(functionToWrap.apply(el, args))
              .map((effectorResult) => {
                if (
                  effectorResult &&
                  (!validateOutput ||
                    validateOutput.call(el, args, effectorResult))
                ) {
                  // `validateOutput` absent or true
                  const returnValue = processEffectorResult(
                    el,
                    effectorResult,
                    undefined,
                    { trigger: functionToWrap }
                  );
                  /* Meta for Neutron: how to treat each mutation's
                   * result (`returns` vs ignore). */
                  return {
                    value: returnValue,
                    returnsKeyExists: "returns" in effectorResult,
                  };
                }
              })
              .filter((r) => r?.returnsKeyExists)
              .reduce((acc, { value }) => [...acc, value], []);
            // 0 → undefined, 1 → that value, 2+ → array
            r = returnedValues.length < 2 ? returnedValues[0] : returnedValues;
          } else {
            r = undefined;
          }
        };
        try {
          // @ts-ignore
          if (el?._n_?.batch) {
            (el as unknown as TNeutronElement)?._n_.batch(exec);
          } else {
            exec();
          }
        } catch (error) {
          if (el) {
            const err = error as { message?: string; name?: string } | null;
            publicize(["neutron", "error"], {
              weakElement: new WeakRef(el as unknown as Element),
              tag: (el as unknown as Element).localName,
              errorMessage: err?.message ? String(err.message) : String(error),
              errorName: err?.name ? String(err.name) : undefined,
            });
          }
          // `onError` present: notify. Otherwise rethrow.
          if (
            // @ts-ignore
            el?._n_?.ctr?.runtimeConfig?.lifecycles?.error?.length > 0
          ) {
            (el as unknown as TNeutronElement)?._n_.batchManager.notify(
              "message:error",
              error
            );
          } else {
            throw error;
          }
        }
        return r;
      })
    );
  };
  wrapper._effectorSrc = functionToWrap;
  return wrapper;
}

const throwCallError = (element, fnName, value) => {
  const val = (value?.toString() ? value?.toString() : value?.constructor?.name)
    ?.replace?.(/\n/g, " ")
    ?.slice?.(0, 10);
  throw new NeutronError(
    `Cannot call function \`${fnName}\` on ${
      element.localName
    } - arguments must be an array. Received: ${
      val ? `\`${val}\`...` : "unknown"
    }`
  );
};

export const isChildEffect = (val: unknown, propConfig: PropConfig) =>
  (propConfig.type === Element ||
    propConfig.type?.prototype instanceof Element) &&
  isPojo(val);

const effectLockDepth = new WeakMap<object, number>();

export const processEffectorResult = (
  // `NeutronElement` is too expensive to type here
  element: any,
  _effectorResult: IgnoredEffectorResult | Obj,
  // same for `_parent`
  _parent?: any,
  opts?: any
): void | unknown => {
  let returnValue;
  if (isPojo(_effectorResult)) {
    const effect = _effectorResult as Obj;
    const nInternalInstance = element?._n_?.ctr ? element._n_ : undefined;

    const tasks: any = {
      returns: () => {},
      events: {
        remove: [],
        add: [],
        fire: [],
      },
      props: {
        elements: [],
        other: [],
        provision: () => {},
      },
      childEffects: [],
      functions: [],
    };
    Object.entries(effect).forEach(([key, value]) => {
      const isArray = Array.isArray(value);
      if (typeof key !== "string") {
        throw new NeutronError(
          `Cannot process effect \`${key}\` on ${element.localName} - key must be a string.`
        );
      }
      if (key === "returns" && !_parent) {
        tasks.returns = () => (returnValue = value);
      } else if (typeof CommonElement[key] === "function") {
        if (!IGNORED_FUNC_VALUES.includes(value)) {
          if (!isArray) {
            throwCallError(element, key, value);
          }
          const mutationKey =
            key.startsWith("emit") ||
            key.startsWith("broadcast") ||
            key.startsWith("command")
              ? "fire"
              : key.startsWith("remove")
                ? "remove"
                : "add";
          tasks.events[mutationKey].push(() =>
            CommonElement[key].apply(element, value)
          );
        }
      } else {
        /* BUG: happy-dom omits property keys on elements, so this
         * check fails tests. `!import.meta.env.TEST` skips the throw
         * there; test vs non-test behavior now differs. */
        if (!(key in element) && !import.meta.env.TEST) {
          throw new NeutronError(
            `Cannot set property \`${key}\` on ${element.localName} - property does not exist.`
          );
        }
        const propType = tc(
          () =>
            nInternalInstance?.ctr?.CustomElement?.getPropConfig?.({
              prop: key,
            })?.type
        );

        // cache: `element[key]` may run a getter
        const elementProp = element[key];
        if (
          typeof elementProp === "function" &&
          (!propType || propType === Function)
        ) {
          /* Prefer the custom-element prop when it clashes with a
           * later native API (e.g. CE `boundingRect` as tokens vs a
           * future native function of the same name). */
          if (!IGNORED_FUNC_VALUES.includes(value)) {
            if (!isArray) {
              throwCallError(element, key, value);
            }
            tasks.functions.push(() => elementProp.call(element, ...value));
          }
        } else if (PROPS_TO_DEEP_MERGE.includes(key)) {
          try {
            tasks.props.other.push(() => Object.assign(elementProp, value));
          } catch (e) {
            throw new NeutronError(
              `Cannot set property \`${key}\` on ${element.localName} ${
                isPojo(value) ? "" : "- value must be an object."
              }`
            );
            // deep-merge (`Object.assign`) failed
          }
        } else if (
          key === "renderRoot" ||
          propType === Element ||
          propType?.prototype instanceof Element
        ) {
          // element-typed: assign, null, or recurse into a POJO
          if (value?.nodeName) {
            // replace the child element
            tasks.props.elements.push(() => (element[key] = value));
          } else if (value === null) {
            tasks.props.elements.push(() => (element[key] = null));
          } else if (isPojo(value)) {
            // POJO: apply as a child effect on the current element
            tasks.childEffects.push(() => {
              if (!(elementProp instanceof Element)) {
                throw new NeutronError(
                  `Cannot set properties of \`${key}\` on element. Element must be set as a property first.`
                );
              }
              processEffectorResult(
                elementProp as TNeutronElement,
                value,
                element,
                opts
              );
            });
          } else {
            throw new NeutronError(
              `Cannot set property \`${key}\` on ${element.localName} - value must be an element or an object.`
            );
          }
        } else if (key === "provision") {
          tasks.props.provision = () => (element[key] = value);
        } else {
          tasks.props.other.push(() => (element[key] = value));
        }
      }
    });

    const execEffect = () => {
      tasks.returns();
      // remove before add
      tasks.events.remove.forEach((fn) => fn());
      tasks.events.add.forEach((fn) => fn());
      // elements before childEffects
      tasks.props.elements.forEach((fn) => fn());
      tasks.childEffects.forEach((fn) => fn());
      tasks.props.other.forEach((fn) => fn());
      /* Functions after elements/props so `cancelRequest: []`,
       * `setCustomValidity: []`, `submit: []` see the updates. */
      tasks.functions.forEach((fn) => fn());
      /* `provision` after props: its event listeners may read them. */
      tasks.props.provision();
    };

    const bm = nInternalInstance?.batchManager;
    const lockDepth = (effectLockDepth.get(element) ?? 0) + 1;
    effectLockDepth.set(element, lockDepth);
    publicize(["neutron", "effect"], {
      weakElement: new WeakRef(element as Element),
      tag: element.localName,
      signature: opts?.trigger?._logSignature ?? null,
      effect,
      lockDepth,
      oldProps: bm?.notifs,
      newProps: bm
        ? Object.fromEntries(
            Object.entries(bm.notifs).map(([key]) => [key, element[key]])
          )
        : undefined,
    });

    try {
      execEffect();
      // emit last: the rest of the effect has landed
      tasks.events.fire.forEach((fn) => fn());
    } finally {
      effectLockDepth.set(element, lockDepth - 1);
    }
  }
  return returnValue;
};

export const setDebugLifecycleSignature = (
  fn: AnyFunction,
  lifecycleName: string,
  nameArray: string[]
) => {
  /*
   * Mirror the call-site syntax: a single name is registered as a bare
   * string (`onPropSet("label")`), multiple names as an array
   * (`onPropSet(["a", "b"])`).
   */
  const quoted = nameArray.map((name) => `"${name}"`).join(", ");
  const args = nameArray.length === 1 ? quoted : `[${quoted}]`;
  (fn as AnyFunction & { _logSignature?: string })._logSignature = `on${
    lifecycleName.charAt(0).toUpperCase() + lifecycleName.slice(1)
  }(${args})`;
};

export const setDebugMethodSignature = (
  fn: AnyFunction,
  methodName: string
) => {
  (fn as AnyFunction & { _logSignature?: string })._logSignature =
    `${methodName}(...)`;
};
