/**
 * Bindings: named `$variable` values stored on an element's `_q_` when a
 * `$variable:` declaration runs. They behave like CSS custom properties:
 *
 * - Tree-scoped, not sheet-scoped. Any sheet (or JS via
 *   `element.quark.setProperty()`, see element-api.ts) can
 *   read a binding another set. Walk ancestors, self first; nearest
 *   owner wins.
 * - `unset` deletes it so descendants fall through (CSS `unset` /
 *   inherit).
 * - A real change fires bubbling `quark-binding-change` from the owner.
 *   Sheets listen at their root (same bus as `quark-prop-change`) and
 *   re-run readers in the owner's subtree.
 *
 * `prop()` is the property-side twin: value on the matched element,
 * `quark-prop-change` in props.ts.
 */
import { SYMBOL_UNSET } from "./constants";
import { getQuarkInternal, type TQuarkElement } from "./quark-internal";
import type { RunTrace } from "./types";
import { LoopGuard } from "@excom/kit-utils";

export const BINDING_CHANGE_EVENT = "quark-binding-change";

export interface BindingChangeDetail {
  name: string;
  /** Writing sheet; `null` for a JS write through `element.quark`. */
  sheetId?: number | null;
  runId?: string;
  isFirstRun?: boolean;
  /** Deferred writes (see `Quark.queueBindingChange`), see QuarkOptions. */
  sinceSeq?: number;
  trace?: RunTrace;
  /**
   * This sheet's run already hit every reader of this write after it
   * happened; only other sheets need to react.
   */
  selfCovered?: boolean;
}

/** How a binding write announces itself (`writeBinding`'s `notify`). */
export type BindingChangeNotifier = (
  element: Element,
  detail: BindingChangeDetail
) => void;

/**
 * Nearest element (self first) that holds a binding for `name`. `null`
 * if nothing up the tree has it.
 */
export const findBindingOwner = (
  element: Element | null,
  name: string
): TQuarkElement | null => {
  for (let el = element; el; el = el.parentElement) {
    if ((el as TQuarkElement)._q_?.hasVar(name)) return el as TQuarkElement;
  }
  return null;
};

/**
 * Resolve a binding by walking ancestors. `undefined` if none holds it.
 * The owner is recorded on the consumer so change-event fan-out can skip
 * shadowed (farther) owners.
 */
export const readBinding = (element: Element, name: string) => {
  const owner = findBindingOwner(element, name);
  const consumerInternal = getQuarkInternal(element);
  if (!owner) {
    delete consumerInternal.varOwners[name];
    return undefined;
  }
  consumerInternal.varOwners[name] = new WeakRef(owner as HTMLElement);
  return getQuarkInternal(owner).getVar(name);
};

/** Fire the bubbling change event all sheets listen for. */
export const dispatchBindingChange = (
  element: Element,
  detail: BindingChangeDetail
): void => {
  element.dispatchEvent(
    new CustomEvent<BindingChangeDetail>(BINDING_CHANGE_EVENT, {
      bubbles: true,
      detail,
    })
  );
};

/**
 * Write a binding (`unset` deletes it). A real change fires bubbling
 * `quark-binding-change` from the owner so sheets re-run readers. Pass
 * `notify` to defer (a sheet mid-run).
 */
export const writeBinding = (
  element: Element,
  name: string,
  value: unknown,
  detail: Omit<BindingChangeDetail, "name"> = {},
  notify: BindingChangeNotifier = dispatchBindingChange
): boolean => {
  const elementInternal = getQuarkInternal(element);
  // one causal hop for the loop guard (a `$a` ↔ `$b` cycle across sheets
  // recurses synchronously); past the limit the write is dropped
  const changed =
    LoopGuard.write(element, name, () =>
      value === SYMBOL_UNSET
        ? elementInternal.deleteVar(name)
        : elementInternal.setVar(name, value)
    ) === true;
  if (changed) {
    notify(element, { name, ...detail });
  }
  return changed;
};
