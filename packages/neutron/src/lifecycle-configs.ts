import { isCustomCommand, TCommandEvent } from "./command";
import { NeutronError } from "./neutron-error";
import type { NeutronInternal as NeutronInternalType } from "./neutron-internal";
import { AnyFunction, EffectorOptions } from "./types";
import { isChildEffect, setDebugLifecycleSignature } from "./utils";
import {
  Converter,
  ExecHandlerFn,
  toArray,
  unique,
} from "@excom/kit-utils";

interface TLifecycleConfig {
  key: string;
  isBatched: boolean;
  batchPrefix?: string;
  triggerFn?: (
    instance: NeutronInternalType,
    batchPrefix: string,
    name: string
  ) => void;
  batchNames?: (names: string[]) => string[];
  batchExecFn?: ExecHandlerFn;
  effectorOptions?: (nameArray: string[]) => EffectorOptions;
}

/*
 * Order matters: several lifecycles share batch names, and earlier
 * entries run first. `.onConnected()` must beat `.onPropSet("isMounted")`.
 */
export const LifecycleConfigs: TLifecycleConfig[] = [
  {
    key: "constructed",
    isBatched: true,
    batchNames: () => ["message:constructed"],
  },
  {
    key: "connected",
    isBatched: true,
    batchNames: () => ["isMounted"],
    effectorOptions: () => ({
      validateInput: ([element]) => element.isMounted && [element],
    }),
  },
  {
    key: "adopted",
    isBatched: true,
    batchNames: () => ["isAdopted"],
    effectorOptions: () => ({
      validateInput: ([element]) => element.isAdopted && [element],
    }),
  },
  {
    key: "error",
    isBatched: true,
    batchNames: () => ["message:error"],
    effectorOptions: () => ({
      validateInput: ([element, notifs]) => [element, notifs["message:error"]],
    }),
  },
  {
    key: "effect",
    batchNames: (nameArray) => [...nameArray, "message:first-mount"],
    isBatched: true,
    effectorOptions: (nameArray) => ({
      validateInput: ([element, previous]) =>
        (element.isMounted || element.wasMounted) &&
        !!nameArray.find((name) => name in previous) && [element, previous],
    }),
  },
  {
    key: "propUnset",
    isBatched: true,
    batchNames: (nameArray) => [...nameArray, "message:first-mount"],
    effectorOptions: (nameArray) => ({
      validateInput: ([element, previous]) =>
        (element.isMounted || element.wasMounted) &&
        !!Object.keys(previous).find(
          (name) =>
            nameArray.includes(name) &&
            !(
              Converter.type(
                element._n_.ctr.CustomElement.getPropConfig({ prop: name })!
                  .type
              )?.prop.isTruthy(element[name]) ?? element[name]
            )
        ) && [element, previous],
      validateOutput: ([element], mutation) =>
        nameArray.every((name) => {
          if (
            name in mutation &&
            !mutation[name] &&
            !isChildEffect(
              mutation[name],
              element._n_.ctr.CustomElement.getPropConfig({ prop: name })!
            )
          ) {
            throw new NeutronError(
              `Cannot unset prop ${name} in its own onPropUnset handler.`
            );
          }
          return true;
        }),
    }),
  },
  {
    key: "propSet",
    isBatched: true,
    batchNames: (nameArray) => [...nameArray, "message:first-mount"],
    effectorOptions: (nameArray) => ({
      validateInput: ([element, previous]) =>
        (element.isMounted || element.wasMounted) &&
        !!Object.keys(previous).find(
          (name) =>
            nameArray.includes(name) &&
            (Converter.type(
              element._n_.ctr.CustomElement.getPropConfig({ prop: name })!.type
            )?.prop.isTruthy(element[name]) ??
              !!element[name])
        ) && [element, previous],
      validateOutput: ([element], mutation) =>
        nameArray.every((name) => {
          // child-element effects in own handlers are ok: `.onPropSet("myElement", () => ({myElement: {addListener: [...]}}))`
          if (
            mutation[name] &&
            !isChildEffect(
              mutation[name],
              element._n_.ctr.CustomElement.getPropConfig({ prop: name })!
            )
          ) {
            throw new NeutronError(
              `Cannot set prop ${name} in its own onPropSet handler.`
            );
          }
          return true;
        }),
    }),
  },
  {
    key: "propChanged",
    isBatched: true,
    batchNames: (nameArray) => [...nameArray, "message:first-mount"],
    effectorOptions: (nameArray) => ({
      validateInput: ([element, previous]) =>
        (element.isMounted || element.wasMounted) &&
        !!nameArray.find((name) => name in previous) && [element, previous],
      validateOutput: ([element], mutation) =>
        nameArray.every((name) => {
          if (
            name in mutation &&
            !isChildEffect(
              mutation[name],
              element._n_.ctr.CustomElement.getPropConfig({ prop: name })!
            )
          ) {
            throw new NeutronError(
              `Cannot change prop ${name} in its own onPropChanged handler.`
            );
          }
          return true;
        }),
    }),
  },
  {
    key: "promiseResolved",
    isBatched: true,
    batchPrefix: "promise:resolved:",
    triggerFn: linkPromiseToBatch("onResolved"),
    effectorOptions: () => ({
      validateInput: validatePromiseArgs("promise:resolved:"),
    }),
  },
  {
    key: "promiseRejected",
    isBatched: true,
    batchPrefix: "promise:rejected:",
    triggerFn: linkPromiseToBatch("onRejected"),
    effectorOptions: () => ({
      validateInput: validatePromiseArgs("promise:rejected:"),
    }),
  },
  {
    key: "broadcast",
    isBatched: false,
  },
  {
    key: "event",
    isBatched: false,
  },
  {
    key: "eventDefault",
    isBatched: false,
    effectorOptions: () => ({
      delayNextTask: true,
      validateInput: ([element, e]: [any, Event]) =>
        element === e.target && !e.defaultPrevented && [element, e],
    }),
  },
  {
    /*
     * `command` events (HTML Command API) never bubble; the at-target
     * check only guards against a hand-made bubbling `Event("command")`.
     * Runs in a microtask so every listener of the dispatch may still
     * `preventDefault()`, yet the user activation that invoked it (a
     * click) is intact for permission prompts and popups.
     */
    key: "command",
    isBatched: false,
    effectorOptions: (names) => ({
      delayMicrotask: true,
      validateInput: ([element, e]: [any, TCommandEvent]) =>
        element === e.target &&
        !e.defaultPrevented &&
        names.includes(e.command) && [element, e],
    }),
  },
  {
    key: "disconnected",
    isBatched: true,
    batchNames: () => ["isMounted"],
    effectorOptions: () => ({
      validateInput: ([element]) => !element.isMounted && [element],
    }),
  },
];

export const LifecycleConfigMap: Record<
  TLifecycleConfig["key"],
  TLifecycleConfig
> = LifecycleConfigs.reduce(
  (acc, config) => {
    acc[config.key] = config;
    return acc;
  },
  {} as Record<TLifecycleConfig["key"], TLifecycleConfig>
);

function linkPromiseToBatch(method) {
  return (instance, batchPrefix, name) => {
    instance.queueManager.getQueue(name)[method]((state) => {
      instance.batchManager.notify(batchPrefix + name, state.value);
    });
  };
}
function validatePromiseArgs(batchPrefix: string) {
  return ([element, result]) => [
    element,
    Object.fromEntries(
      Object.entries(result as Record<string, unknown>)
        .filter(([key]) => key.startsWith(batchPrefix))
        .map(([key, value]) => [key.replace(/(.*):/, ""), value])
    ),
  ];
}

export const registerLifecycle = (
  ctr: typeof NeutronInternalType,
  lifecycleName: TLifecycleConfig["key"],
  nameArg: string | string[],
  fn: AnyFunction
) => {
  const nameArray = unique(toArray(nameArg));
  if (lifecycleName === "command") {
    nameArray.forEach((name) => {
      if (!isCustomCommand(name)) {
        throw new NeutronError(
          `Command names must start with "--" (got "${name}"): built-in commands never reach a custom element.`
        );
      }
    });
  }
  setDebugLifecycleSignature(fn, lifecycleName, nameArray);
  ctr.builtConfig.lifecycles[lifecycleName].push([nameArray, fn]);
  return ctr;
};

export const unregisterLifecycle = (
  ctr: typeof NeutronInternalType,
  lifecycleName: TLifecycleConfig["key"],
  nameArg: string | string[],
  fn: AnyFunction
) => {
  const nameArray = unique(toArray(nameArg));
  /* Drop the entry when every name matches `entry[0]`; otherwise
   * strip only the matching names from `entry[0]`. */
  ctr.builtConfig.lifecycles[lifecycleName] = ctr.builtConfig.lifecycles[
    lifecycleName
  ]
    .map(([_entryNames, entryFn]) => {
      if (entryFn === fn) {
        const entryNames = _entryNames.filter(
          (name) => !nameArray.includes(name)
        );
        if (entryNames.length === 0) {
          return false;
        } else {
          return [entryNames, entryFn];
        }
      }
      return [_entryNames, entryFn];
    })
    .filter(Boolean) as [string[], AnyFunction][];
  return ctr;
};
