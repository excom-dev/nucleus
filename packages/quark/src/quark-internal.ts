import { syncFormControlAttribute } from "./form-controls";
import type { UtilFn } from "./types";

/** How an `@on` slot's functions are registered on the DOM (once per event type). */
export interface ListenerMeta {
  eventTypes: string[];
  target: EventTarget;
  options: AddEventListenerOptions;
}
import { deref, QuarkLogger } from "./utils";
import { hashObject } from "@excom/hash-object";
import { LoopGuard } from "@excom/kit-utils";
export interface TQuarkElement extends HTMLElement {
  _q_: QuarkInternal;
}

export const getQuarkInternal = (_el): InstanceType<typeof QuarkInternal> => {
  let element = deref(_el);
  if (element) {
    if (!element._q_) {
      new QuarkInternal(element);
    }
    return element._q_;
  }
  // lie to everything else...
  return QuarkLogger.error(
    "Quark: Element not found"
  ) as unknown as InstanceType<typeof QuarkInternal>;
};

export class QuarkInternal {
  element: HTMLElement;
  loop: {
    item?: any;
    index?: any;
    hash?: any;
    key?: any;
  } = {};
  /**
   * $variable bindings. Shared across sheets (CSS custom-property
   * semantics: no per-sheet isolation; last writer wins per element).
   * Non-primitives are stored as `[hash, value]` for change detection.
   */
  vars: Record<string, [string, any] | any> = {};
  /**
   * Nearest binding owner seen per $name on this element's last reads.
   * Lets change-event fan-out skip re-runs for shadowed (farther) owners.
   */
  varOwners: Record<string, WeakRef<HTMLElement>> = {};
  instances: {
    [hash: string]: {
      modules: Record<string, any>;
      attributes: Record<string, boolean>;
      rules: {
        [id: number]: {
          /** Attached listener functions per `@on` slot (`@on click (once)`). */
          listeners: Record<string, Array<UtilFn | undefined>>;
          /** Where and how each slot's functions were registered. */
          listenerMeta: Record<string, ListenerMeta>;
        };
      };
    };
  } = {};
  constructor(_element: HTMLElement) {
    const element = _element as unknown as TQuarkElement;
    if (!element._q_) {
      this.element = element;
      element._q_ = this;
    }
  }
  getLoopItem() {
    return this.loop.item;
  }
  setLoopItem(value) {
    this.loop.item = value;
  }
  getLoopIndex() {
    return this.loop.index;
  }
  setLoopIndex(value) {
    this.loop.index = value;
  }
  getLoopHash() {
    return this.loop.hash;
  }
  setLoopHash(value) {
    this.loop.hash = value;
  }
  getLoopKey() {
    return this.loop.key;
  }
  setLoopKey(value) {
    this.loop.key = value;
  }
  /*
    Modules and listeners are scoped to the quark instance (sheet).
    Variables are not: like CSS custom properties, they live on the
    element and cascade to descendants, whichever sheet set them.
    Attributes are shared and compared across instances.
    TBD: item/index iterations
    */
  getInstance(quarkHash) {
    if (!this.instances[quarkHash]) {
      this.instances[quarkHash] = {
        modules: {
          dfault: {},
        },
        attributes: {},
        rules: {},
      };
    }
    return this.instances[quarkHash];
  }
  getRule(instance, ruleId) {
    if (!instance.rules[ruleId]) {
      instance.rules[ruleId] = {
        listeners: {},
        listenerMeta: {},
      };
    }
    return instance.rules[ruleId];
  }
  /** Write a binding. Returns `true` when the stored value actually changed. */
  setVar(varName: string, value: unknown): boolean {
    const isComparable =
      value === null ||
      value === undefined ||
      ["string", "number", "boolean", "symbol"].includes(typeof value);
    // This will skip hashing for primitives,
    // which can be compared directly
    if (isComparable) {
      const isDefined = varName in this.vars;
      if (!isDefined || this.vars[varName] !== value) {
        this.vars[varName] = value;
        return true;
      }
      return false;
    }
    const existingHash = this.vars[varName]?.[0];
    const newHash = hashObject(value);
    if (existingHash === newHash) {
      return false;
    }
    this.vars[varName] = [newHash, value];
    return true;
  }
  getVar(varName: string) {
    return Array.isArray(this.vars[varName])
      ? this.vars[varName]?.[1]
      : this.vars[varName];
  }
  hasVar(varName: string): boolean {
    return varName in this.vars;
  }
  /** `unset`: remove the binding so descendants fall through to an ancestor. */
  deleteVar(varName: string): boolean {
    if (!(varName in this.vars)) return false;
    delete this.vars[varName];
    delete this.varOwners[varName];
    return true;
  }
  propertyHasBeenSet(
    quarkHash: string,
    ruleId: number,
    type: "variable" | "listener" | "attribute" | "diagnostic" | "delay",
    key: string,
    // unused
    _value?: string
  ) {
    const instance = this.getInstance(quarkHash);
    if (type === "variable") {
      // a def is "set" when the binding exists on this element
      return key in this.vars;
    } else if (type === "listener") {
      const rule = this.getRule(instance, ruleId);
      return !!rule.listeners[key]; // ?.has?.(value);
    } else if (type === "attribute") {
      return !!instance.attributes[key];
      /*
       * if (element) {
       *   const instance = QuarkElement.getInstance(element, quarkHash);
       *   return !!instance.listeners[key];
       * } else {
       *   return false;
       * }
       */
    }
  }

  setModule(quarkHash, moduleName = "dfault", value) {
    const instance = this.getInstance(quarkHash);
    // replace, never mutate: the expression scope caches per modules record
    instance.modules = { ...instance.modules, [moduleName]: value };
  }
  addModules(quarkHash, modules) {
    const instance = this.getInstance(quarkHash);
    instance.modules = {
      ...instance.modules,
      ...modules,
    };
  }
  getAllAttrs(quarkHash: string): Record<string, boolean> {
    const instance = this.getInstance(quarkHash);
    return instance.attributes;
  }
  setAttr(
    quarkHash: string,
    name: string,
    value: string | null | undefined | unknown | boolean
  ) {
    // `undefined` = no-op (leave the attribute alone). `null` / false = wipe.
    if (value === undefined) return;
    const instance = this.getInstance(quarkHash);
    const _val = typeof value === "boolean" ? (value ? "" : null) : value;
    const shouldRemove = _val === null;
    const oldVal = this.element.getAttribute(name);
    if (_val !== oldVal) {
      // one causal hop for the loop guard; past its limit the write is
      // dropped and the runaway chain ends here
      const written = LoopGuard.write(this.element, name, () => {
        this.element[shouldRemove ? "removeAttribute" : "setAttribute"](
          name,
          _val as string
        );
        return true;
      });
      if (written === false) return;
      instance.attributes[name] = true;
    }
    /*
     * Form controls: the attr is authoritative. Keep the live
     * (dirty-flag) property in step even when the attr itself did not
     * change, since the user may have edited the control away from it.
     */
    syncFormControlAttribute(
      this.element,
      name,
      shouldRemove ? null : String(_val)
    );
  }
  setContentAttr(quarkHash: string) {
    const instance = this.getInstance(quarkHash);
    instance.attributes.content = true;
  }
  /**
   * Write a CSS custom property (`--x:`) on the inline style. `undefined`
   * = no-op; `null` = remove. A trailing `!important` in the value maps
   * to the priority arg (`setProperty` rejects it inline). Recorded in
   * `instance.attributes` so `propertyIsNew` gating works. `--` names
   * cannot clash with real attrs.
   */
  setStyleProperty(
    quarkHash: string,
    name: string,
    value: string | null | undefined
  ) {
    if (value === undefined) return;
    const instance = this.getInstance(quarkHash);
    const style = (this.element as HTMLElement).style;
    if (value === null) {
      style.removeProperty(name);
    } else {
      const important = /\s*!important\s*$/i.test(value);
      style.setProperty(
        name,
        important ? value.replace(/\s*!important\s*$/i, "") : value,
        important ? "important" : ""
      );
    }
    instance.attributes[name] = true;
  }
  getModule(quarkHash, moduleName = "dfault") {
    const instance = this.getInstance(quarkHash);
    return instance.modules[moduleName];
  }
  getModules(quarkHash) {
    const instance = this.getInstance(quarkHash);
    return instance.modules;
  }

  getListeners(quarkHash, ruleId, slot) {
    const instance = this.getInstance(quarkHash);
    const rule = this.getRule(instance, ruleId);
    if (!rule.listeners[slot]) {
      rule.listeners[slot] = [];
    }
    return rule.listeners[slot];
  }
  setListeners(quarkHash, ruleId, slot, value) {
    const instance = this.getInstance(quarkHash);
    const rule = this.getRule(instance, ruleId);
    rule.listeners[slot] = value;
  }
  /** Registration target / options recorded for a slot, if any. */
  getListenerMeta(quarkHash, ruleId, slot): ListenerMeta | undefined {
    const instance = this.getInstance(quarkHash);
    return this.getRule(instance, ruleId).listenerMeta[slot];
  }

  /** Detach every function registered under `slot` and forget the slot. */
  removeAllListeners(quarkHash, ruleId, slot) {
    const instance = this.getInstance(quarkHash);
    const rule = this.getRule(instance, ruleId);
    const meta = rule.listenerMeta[slot];
    const listenerArray = rule.listeners[slot] ?? [];
    if (meta) {
      listenerArray.forEach((fn) => {
        if (fn) {
          meta.eventTypes.forEach((eventType) =>
            meta.target.removeEventListener(eventType, fn, meta.options)
          );
        }
      });
    }
    rule.listeners[slot] = [];
    delete rule.listenerMeta[slot];
  }

  /**
   * Make the registered functions for `slot` equal `fnList`, in order,
   * touching only positions whose function identity changed. A change of
   * target or registration options re-registers everything.
   */
  setOrderedListeners(quarkHash, ruleId, slot, fnList, meta: ListenerMeta) {
    const instance = this.getInstance(quarkHash);
    const rule = this.getRule(instance, ruleId);
    const previous = rule.listenerMeta[slot];
    let listenerArray = this.getListeners(quarkHash, ruleId, slot);
    if (
      fnList.length !== listenerArray.length ||
      (previous &&
        (previous.target !== meta.target ||
          previous.eventTypes.join("\0") !== meta.eventTypes.join("\0") ||
          !!previous.options.capture !== !!meta.options.capture ||
          !!previous.options.passive !== !!meta.options.passive))
    ) {
      this.removeAllListeners(quarkHash, ruleId, slot);
      listenerArray = this.getListeners(quarkHash, ruleId, slot);
    }
    rule.listenerMeta[slot] = meta;
    const { target, eventTypes, options } = meta;
    const add = (fn: UtilFn | undefined) =>
      fn &&
      eventTypes.forEach((type) => target.addEventListener(type, fn, options));
    const remove = (fn: UtilFn | undefined) =>
      fn &&
      eventTypes.forEach((type) =>
        target.removeEventListener(type, fn, options)
      );
    if (listenerArray.length === 0) {
      fnList.forEach((fn) => {
        add(fn);
        listenerArray.push(fn);
      });
      return;
    }
    fnList.forEach((fn, index) => {
      const existingListener = listenerArray[index];
      if (fn === existingListener) return;
      remove(existingListener);
      add(fn);
      listenerArray[index] = fn;
    });
  }
}
