import { CommonElement } from "./common-element";
import type { DefaultConfig } from "./types";
import { camelToDash } from "@excom/kit-utils";

const ALWAYS_IGNORE = [undefined, NaN, 0n];
export const IGNORED_STR_VALUES = [false, 0, ...ALWAYS_IGNORE];
export const IGNORED_NUM_VALUES = [false, "", ...ALWAYS_IGNORE];
export const IGNORED_BOOL_VALUES = [0, "", ...ALWAYS_IGNORE];
export const IGNORED_PROP_VALUES = [0, false, "", ...ALWAYS_IGNORE];
export const IGNORED_FUNC_VALUES = [null, ...IGNORED_PROP_VALUES];
export const IGNORED_EFFECTOR_RESULT = [null, ...IGNORED_PROP_VALUES];
export type IgnoredEffectorResult = void | undefined | null | false | "" | 0;

export const DEFAULT_CONFIG: DefaultConfig = {
  props: {
    isMounted: {
      type: Boolean,
      notify: false,
      attr: false,
    },
    isAdopted: {
      type: Boolean,
      notify: false,
      attr: false,
    },
    wasMounted: {
      type: Boolean,
      notify: false,
      attr: false,
    },
    isMoving: {
      type: Boolean,
      notify: false,
      attr: false,
    },
    renderRoot: {
      type: HTMLElement,
      notify: false,
      attr: false,
    },
  },
};

export const PROTECTED_PROP_NAMES = [
  // NeutronInternal statics
  "builtConfig",
  "runtimeConfig",
  "connected",
  "constructed",
  "adopted",
  "error",
  "propSet",
  "propUnset",
  "promiseResolved",
  "promiseRejected",
  "disconnected",
  "broadcast",
  "event",
  "eventDefault",
  "command",
  "NeutronElement",
  "CustomElement",
  // NeutronElement instances
  "element",
  "ctr",
  "eventListeners",
  "disconnectedEventListeners",
  "broadcastListeners",
  "disconnectedBroadcastListeners",
  "props",
  "propStore",
  "queueManager",
  "debug",
  // CommonElement keys
  ...Object.keys(CommonElement),
  // custom-element statics
  "observedAttributes",
  "NeutronInternal",
  // custom-element instances
  "_n_",
  "_q_",
  "connectedCallback",
  "adoptedCallback",
  "disconnectedCallback",
  "attributeChangedCallback",
  ...Object.keys(DEFAULT_CONFIG.props),
  // Other
  "returns",
  // `content` is too generic; Quark and CSS already use it for children.
  "content",
];

export const PROTECTED_ATTR_NAMES = [
  /^q-/,
  /^n-/,
  /^on-/,
  /^off-/,
  ...PROTECTED_PROP_NAMES.map((p) => new RegExp(`^${camelToDash(p)}$`)),
];

export const PROPS_TO_DEEP_MERGE = ["style"];
