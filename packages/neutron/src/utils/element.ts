import {
  DEFAULT_CONFIG,
  PROTECTED_ATTR_NAMES,
  PROTECTED_PROP_NAMES,
} from "../constants";
import { LifecycleConfigMap } from "../lifecycle-configs";
import { Neutron } from "../neutron";
import type { NeutronElement as TNeutronElement } from "../neutron-element";
import { NeutronError } from "../neutron-error";
import type {
  BuiltConfig,
  DefaultPropName,
  EffectorOptions,
  OptsConfig,
  OptsPropConfig,
  PropConfig,
  RuntimeConfig,
} from "../types";
import { effector } from "./effect";
import {
  camelToDash,
  Converter,
  isNullish,
  isPojo,
  isPrimitiveConstructor,
  PropSerializer,
} from "@excom/kit-utils";
import { getAttr, setAttr, TokenList } from "@excom/kit-utils";
import { deepClone, unique } from "@excom/kit-utils";

export const isBuiltInElement = (el: HTMLElement): boolean =>
  !!el?.nodeName && !el?.nodeName.includes("-");

const defaultGetProp = (
  element: TNeutronElement,
  propStore: Record<string, unknown>,
  propConfig: PropConfig
) => {
  const validatePropValue = (
    value: unknown,
    { canSetDefault = false }: { canSetDefault: boolean }
  ) => {
    const isTokens = propConfig.type === TokenList;
    // invalid / nullish → default
    const isValid = (v) => !propConfig.isValid || propConfig.isValid(v);
    if (isNullish(value) || (!isTokens && !isValid(value))) {
      const defaultValue = propConfig.defaultValue();
      if (canSetDefault) {
        /* `setAttr()` serializes; defaults are props, so store raw
         * (or serialized only when there is no attr). */
        propStore[propConfig.prop] = propConfig.attr
          ? defaultValue
          : propConfig.serialize(defaultValue);
      }
      return defaultValue;
    }
    if (isTokens) {
      return !propConfig.isValid ? value : (value as string[]).filter(isValid);
    }
    return value;
  };
  if (propStore.hasOwnProperty(propConfig.prop) && propConfig.attr) {
    /*
     * Observed attrs: `attributeChangedCallback` already wrote
     * `propStore` (`canSetDefault: true`), so later reads skip
     * `getAttribute()`. Unobserved attrs parse from the attribute
     * below.
     * TODO: would notifying every attr and always reading
     * `propStore` be faster?
     */
    return validatePropValue(propStore[propConfig.prop], {
      canSetDefault: true,
    });
  } else if (!propConfig.attr) {
    // rich prop: deserialize from `propStore`
    return validatePropValue(
      propConfig.deserialize(propStore[propConfig.prop]),
      { canSetDefault: true }
    );
  } else {
    // attribute-backed: parse the live attr
    const val = Converter.type(propConfig.type).attr.convert(
      propConfig.deserialize(getAttr(element, propConfig.attr as string))
    );
    return validatePropValue(val, { canSetDefault: false });
  }
};

const defaultSetProp = (
  element: TNeutronElement,
  propStore: Record<string, unknown>,
  propConfig: PropConfig,
  value: unknown
) => {
  const name = propConfig.prop;
  const attrName = propConfig.attr;
  if (attrName) {
    setAttr(
      element,
      attrName,
      // prop → attribute
      propConfig.serialize(Converter.type(propConfig.type).prop.convert(value))
    );
  } else {
    // prop → `propStore`
    propStore[name] = propConfig.serialize(value);
    if (
      propConfig.type === Promise ||
      propConfig.type?.prototype instanceof Promise
    ) {
      const queue = element._n_.queueManager.getQueue(name);
      if (queue.state.status !== "pending" || !value) {
        // replace / clear: cancel the previous Promise queue
        queue.reset();
      }
      if (value) {
        queue.settle(value);
      }
    }
  }
};

export const createPropConfig = (
  name: string,
  conf: OptsConfig["props"][string],
  isDefault: boolean = false
): PropConfig => {
  const configuredObject = (
    isPojo(conf) ? conf : { type: conf }
  ) as OptsPropConfig;
  if (!configuredObject.type) {
    throw new NeutronError(
      "Incorrect property config: " + JSON.stringify(name)
    );
  }
  const serializer =
    typeof configuredObject.store === "string"
      ? PropSerializer[configuredObject.store] || PropSerializer.dfault
      : typeof configuredObject.store === "object"
        ? configuredObject.store
        : PropSerializer.dfault;
  const result = {
    prop: name,
    attr: isPrimitiveConstructor(configuredObject.type)
      ? Converter.getAttrName(name)
      : false,
    defaultValue: () =>
      Converter.type(configuredObject.type)?.prop.defaultValue ?? null,
    isValid: configuredObject.isValid ?? null,
    notify: false as const,
    get: defaultGetProp,
    set: defaultSetProp,
    serialize: serializer.serialize,
    deserialize: serializer.deserialize,
    store: configuredObject.store || "default",
    ...configuredObject,
    type: configuredObject.type,
  };
  if (!isDefault && PROTECTED_PROP_NAMES.includes(name)) {
    throw new NeutronError(`Cannot use protected prop name: "${name}"`);
  }
  if (!isDefault && PROTECTED_ATTR_NAMES.some((n) => n.test(result.attr))) {
    throw new NeutronError(`Cannot use protected attr: "${result.attr}"`);
  }
  return result;
};

export const initRenderRootConfig = (
  renderRootConfig?: OptsConfig["renderRoot"]
): RuntimeConfig["renderRoot"] | undefined => {
  if (renderRootConfig) {
    const isShadow = ["open", "closed"].includes(
      renderRootConfig.shadow as string
    );
    return {
      tag: renderRootConfig.tag || "div",
      shadow: isShadow ? renderRootConfig.shadow : undefined,
      defaultSlots: renderRootConfig.defaultSlots ?? isShadow,
    };
  }
};

export const createBuiltConfig = (optsConfig: OptsConfig): BuiltConfig => ({
  ...optsConfig,
  reflectDefaultProps: optsConfig.reflectDefaultProps || [],
  renderRoot: initRenderRootConfig(optsConfig.renderRoot),
  events: optsConfig.events || {},
  broadcasts: optsConfig.broadcasts || {},
  methods: optsConfig.methods || [],
  lifecycles: {
    constructed: optsConfig.lifecycles?.constructed || [],
    connected: optsConfig.lifecycles?.connected || [],
    adopted: optsConfig.lifecycles?.adopted || [],
    disconnected: optsConfig.lifecycles?.disconnected || [],
    error: optsConfig.lifecycles?.error || [],
    promiseResolved: optsConfig.lifecycles?.promiseResolved || [],
    promiseRejected: optsConfig.lifecycles?.promiseRejected || [],
    broadcast: optsConfig.lifecycles?.broadcast || [],
    event: optsConfig.lifecycles?.event || [],
    eventDefault: optsConfig.lifecycles?.eventDefault || [],
    command: optsConfig.lifecycles?.command || [],
    effect: optsConfig.lifecycles?.effect || [],
    propUnset: optsConfig.lifecycles?.propUnset || [],
    propSet: optsConfig.lifecycles?.propSet || [],
    propChanged: optsConfig.lifecycles?.propChanged || [],
  },
  props: Object.keys(optsConfig.props || {}).reduce((acc, propName) => {
    acc[propName] = createPropConfig(
      propName,
      optsConfig.props[propName],
      false
    );
    return acc;
  }, {}),
});

export const createRuntimeConfig = (
  builtConfig: BuiltConfig
): RuntimeConfig => {
  const lifecycles = Object.fromEntries(
    Object.entries({
      ...builtConfig.lifecycles,
      propSet: [
        ...builtConfig.lifecycles!.propSet,
        /* `provision` is the public rich-data surface: every set
         * announces to app JS (Quark reads the property directly). */
        ...("provision" in builtConfig.props
          ? [[["provision"], () => ({ emit: ["neutron-provision"] })]]
          : [null]),
      ].filter(Boolean),
    }).map(([key, value]) => [
      key,
      value.map(([nameArray, fn]) => {
        const conf = LifecycleConfigMap[key];
        const batchNames = unique(conf.batchNames?.(nameArray) || nameArray);
        const opts: EffectorOptions = conf?.effectorOptions?.(nameArray) || {};
        return [batchNames, effector(fn, opts)];
      }),
    ])
  ) as unknown as RuntimeConfig["lifecycles"];
  const allPropNames = [
    ...(lifecycles?.connected || []),
    ...(lifecycles?.adopted || []),
    ...(lifecycles?.disconnected || []),
    ...(lifecycles?.error || []),
    ...(lifecycles?.effect || []),
    ...(lifecycles?.propUnset || []),
    ...(lifecycles?.propSet || []),
    ...(lifecycles?.propChanged || []),
  ].flatMap(([names]) => names);
  return {
    ...builtConfig,
    props: Object.fromEntries(
      Object.entries({
        ...builtConfig.props,
        ...Object.keys(DEFAULT_CONFIG.props).reduce((acc, propName) => {
          acc[propName] = createPropConfig(
            propName,
            DEFAULT_CONFIG.props[propName],
            true
          );
          if (
            builtConfig.reflectDefaultProps?.includes(
              propName as DefaultPropName
            )
          ) {
            acc[propName].attr = camelToDash(propName);
          }
          return acc;
        }, {}),
      }).map(([key, value]: [string, PropConfig]) => [
        key,
        {
          ...value,
          notify:
            value.notify ||
            (allPropNames.includes(key) ? buildPropNotify(value) : false),
        },
      ])
    ),
    methods: builtConfig.methods.map(([name, fn]) => [name, effector(fn)]),
    lifecycles,
  };
};

function buildPropNotify(propConfig: PropConfig): "attr" | "prop" {
  return propConfig.attr && isPrimitiveConstructor(propConfig.type)
    ? "attr"
    : "prop";
}

export type MergeCustomTypes<T extends { CustomTypes: any }[]> = T extends [
  infer F extends { CustomTypes: any },
  ...infer R extends { CustomTypes: any }[],
]
  ? F["CustomTypes"] & MergeCustomTypes<R>
  : {};

// Merge each mixin's `Config`
export type MergeConfig<T extends { Config: any }[]> = T extends [
  infer F extends { Config: any },
  ...infer R extends { Config: any }[],
]
  ? F["Config"] & MergeConfig<R>
  : {};

export const compose = <T extends any[]>(inheriting: [...T]) => {
  return Neutron<MergeCustomTypes<T>, MergeConfig<T>>(
    inheriting
      .map(({ builtConfig }) => deepClone(builtConfig))
      .reduce(
        (acc: BuiltConfig, conf: BuiltConfig) => {
          if (!acc) return conf;
          return {
            ...acc,
            ...conf,
            events: {
              ...acc.events,
              ...conf.events,
            },
            broadcasts: {
              ...acc.broadcasts,
              ...conf.broadcasts,
            },
            props: {
              ...acc.props,
              ...conf.props,
            },
            methods: [...acc.methods, ...conf.methods],
            lifecycles: {
              constructed: [
                ...acc.lifecycles.constructed,
                ...conf.lifecycles.constructed,
              ],
              connected: [
                ...acc.lifecycles.connected,
                ...conf.lifecycles.connected,
              ],
              adopted: [...acc.lifecycles.adopted, ...conf.lifecycles.adopted],
              disconnected: [
                ...acc.lifecycles.disconnected,
                ...conf.lifecycles.disconnected,
              ],
              error: [...acc.lifecycles.error, ...conf.lifecycles.error],
              promiseResolved: [
                ...acc.lifecycles.promiseResolved,
                ...conf.lifecycles.promiseResolved,
              ],
              promiseRejected: [
                ...acc.lifecycles.promiseRejected,
                ...conf.lifecycles.promiseRejected,
              ],
              broadcast: [
                ...acc.lifecycles.broadcast,
                ...conf.lifecycles.broadcast,
              ],
              event: [...acc.lifecycles.event, ...conf.lifecycles.event],
              eventDefault: [
                ...acc.lifecycles.eventDefault,
                ...conf.lifecycles.eventDefault,
              ],
              command: [
                ...(acc.lifecycles.command ?? []),
                ...(conf.lifecycles.command ?? []),
              ],
              effect: [...acc.lifecycles.effect, ...conf.lifecycles.effect],
              propUnset: [
                ...acc.lifecycles.propUnset,
                ...conf.lifecycles.propUnset,
              ],
              propSet: [...acc.lifecycles.propSet, ...conf.lifecycles.propSet],
              propChanged: [
                ...acc.lifecycles.propChanged,
                ...conf.lifecycles.propChanged,
              ],
            },
          };
        },
        null as unknown as BuiltConfig
      )
  );
};
