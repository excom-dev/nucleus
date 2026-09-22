/**
 * `element.quark`: the JS side of `$variable` bindings, shaped like
 * `element.style` (`setProperty` / `removeProperty` / `getPropertyValue`).
 *
 * The element you call it on becomes the binding's owner, exactly as a
 * rule declaring `$name` there would: descendants (in any sheet) resolve
 * it by walking up, a nearer owner shadows it, and a real change fires
 * the bubbling `quark-binding-change` that re-runs readers. It works on
 * elements no rule has matched — that is the owner case. Writes carry
 * `sheetId: null` so DevTools can tell a JS write from a rule's.
 *
 * Change detection is by value (`hashObject` for objects): pass a new
 * object, an in-place mutation is invisible — same as a rule. Primitives
 * that should be selectable belong in attributes (`setAttribute` +
 * `attr()`); this API earns its place for rich values and for `$name`
 * reads in a subtree. One writer per name per element: a rule that
 * declares `$name` on the same element rewrites a JS value when its def
 * re-runs (last writer wins; revisited with specificity / priority).
 */
import {
  type BindingChangeDetail,
  dispatchBindingChange,
  readBinding,
  writeBinding,
} from "./bindings";
import { SYMBOL_UNSET } from "./constants";

/** `count` and `$count` both name the `$count` binding. */
const bindingName = (name: string): string =>
  name.startsWith("$") ? name : `$${name}`;

const JS_WRITE: Omit<BindingChangeDetail, "name"> = { sheetId: null };

export class QuarkElementApi {
  private readonly element: Element;
  constructor(element: Element) {
    this.element = element;
  }
  /**
   * Write a binding on this element. Returns `true` when the stored value
   * changed (readers re-run synchronously before it returns).
   */
  setProperty(name: string, value: unknown): boolean {
    return writeBinding(this.element, bindingName(name), value, JS_WRITE);
  }
  /**
   * Write several bindings, announcing them after all are stored, so a
   * reader of two names sees both new values on its one re-run.
   */
  setProperties(values: Record<string, unknown>): boolean {
    const pending: BindingChangeDetail[] = [];
    let changed = false;
    for (const [name, value] of Object.entries(values)) {
      changed =
        writeBinding(
          this.element,
          bindingName(name),
          value,
          JS_WRITE,
          (_owner, detail) => {
            pending.push(detail);
          }
        ) || changed;
    }
    pending.forEach((detail) => dispatchBindingChange(this.element, detail));
    return changed;
  }
  /** `unset`: delete the binding so descendants fall through to an ancestor. */
  removeProperty(name: string): boolean {
    return writeBinding(
      this.element,
      bindingName(name),
      SYMBOL_UNSET,
      JS_WRITE
    );
  }
  /** The value a rule on this element would read (nearest owner, self first). */
  getPropertyValue(name: string): unknown {
    return readBinding(this.element, bindingName(name));
  }
}

declare global {
  interface Element {
    /** Quark bindings on this element, see `QuarkElementApi`. */
    readonly quark: QuarkElementApi;
  }
}

const handles = new WeakMap<Element, QuarkElementApi>();

/**
 * Define the lazy `quark` accessor on `Element.prototype` (SVG nodes can
 * own bindings too). Idempotent; `configurable` so tests can remove it.
 */
export const installElementApi = (
  proto: object = typeof Element === "undefined" ? {} : Element.prototype
): void => {
  if (Object.getOwnPropertyDescriptor(proto, "quark")) return;
  Object.defineProperty(proto, "quark", {
    configurable: true,
    enumerable: false,
    get(this: Element): QuarkElementApi {
      let handle = handles.get(this);
      if (!handle) handles.set(this, (handle = new QuarkElementApi(this)));
      return handle;
    },
  });
};
