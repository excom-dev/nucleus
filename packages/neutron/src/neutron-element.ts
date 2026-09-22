import type { NeutronInternal as TNeutronInternal } from "./neutron-internal";
import type { PropConfig, RuntimeConfig } from "./types";

export class NeutronElement extends HTMLElement {
  static observedAttributes: string[] = [];
  static NeutronInternal: typeof TNeutronInternal;

  /* --- PUBLIC: STATIC INTROSPECTION --- */
  /**
   * The element's runtime configuration, its `tag`, every prop's
   * `PropConfig` (keyed by prop name: `prop`, `attr`, `type`, defaults,
   * `notify`, …), events, broadcasts, methods and lifecycles, as built by
   * `define()`. `undefined` before the element is defined. Reach it from an
   * instance through its constructor (`el.constructor.getConfig()`) or from
   * the registry (`customElements.get("my-tag").getConfig()`). Read-only by
   * contract: mutating it changes the running definition.
   */
  static getConfig(): RuntimeConfig | undefined {
    return this.NeutronInternal?.runtimeConfig;
  }
  /**
   * One prop's `PropConfig`, looked up by attribute name (`{ attr: "is-open" }`)
   * or prop name (`{ prop: "isOpen" }`). `undefined` when unknown or before
   * `define()`.
   */
  static getPropConfig({
    attr,
    prop,
  }: {
    attr?: string;
    prop?: string;
  }): PropConfig | undefined {
    return Object.values(this.getConfig()?.props ?? {}).find((c) =>
      attr ? c.attr === attr : c.prop === prop
    );
  }
  _n_: TNeutronInternal;
  isMounted: boolean;
  isAdopted: boolean;
  wasMounted: boolean;
  isMoving: boolean;
  renderRoot?: HTMLElement;

  constructor() {
    super();
    const NeutronInternal = (
      this.constructor as unknown as typeof NeutronElement
    ).NeutronInternal;
    this._n_ = new NeutronInternal(this);
  }

  /* Native lifecycle callbacks */
  connectedCallback() {
    this._n_.connectedCallback();
  }
  connectedMoveCallback() {
    this._n_.connectedMoveCallback();
  }
  adoptedCallback() {
    this._n_.adoptedCallback();
  }
  disconnectedCallback() {
    this._n_.disconnectedCallback();
  }
  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null
  ) {
    this._n_.attributeChangedCallback(name, oldValue, newValue);
  }
}
