import { Neutron } from "../../src/neutron";
import { NeutronElement } from "../../src/neutron-element";
import { NeutronError } from "../../src/neutron-error";
import {
  createPropConfig,
  initRenderRootConfig,
  isBuiltInElement,
} from "../../src/utils/element";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { TokenList } from "@excom/kit-utils";

describe("Prop configuration", () => {
  it("rejects incomplete configs, protected prop names, and protected attribute names", () => {
    const build = (props: Record<string, unknown>) => () =>
      Neutron({ tag: "bad-host", props: props as any });
    expect(build({ badProp: {} })).toThrow(NeutronError);
    expect(build({ badProp: {} })).toThrow(
      'Incorrect property config: "badProp"'
    );
    expect(build({ content: String })).toThrow(
      'Cannot use protected prop name: "content"'
    );
    expect(build({ renderRoot: HTMLElement })).toThrow(NeutronError);
    expect(build({ qValue: String })).toThrow(
      'Cannot use protected attr: "q-value"'
    );
    expect(build({ onValue: String })).toThrow(
      'Cannot use protected attr: "on-value"'
    );
    // default props are allowed to use otherwise protected names
    expect(
      createPropConfig("isMounted", { type: Boolean, attr: false }, true).prop
    ).toBe("isMounted");
  });

  it("expands a bare constructor and honours custom serializers", () => {
    const bare = createPropConfig("labelText", String);
    expect(bare).toMatchObject({
      prop: "labelText",
      attr: "label-text",
      type: String,
      store: "default",
      notify: false,
      isValid: null,
    });
    expect(bare.defaultValue()).toBe(null);

    const custom = {
      serialize: (v: unknown) => v,
      deserialize: (v: unknown) => v,
    };
    expect(
      createPropConfig("secretText", { type: String, store: custom as any })
    ).toMatchObject({
      serialize: custom.serialize,
      deserialize: custom.deserialize,
      store: custom,
    });

    const weak = createPropConfig("childEl", {
      type: HTMLElement,
      store: "weak",
    });
    expect(weak.attr).toBe(false);
    const div = document.createElement("div");
    expect(weak.serialize(div)).toBeInstanceOf(WeakRef);
    expect(weak.deserialize(weak.serialize(div))).toBe(div);
    // an unknown store name falls back to the default serializer
    expect(
      createPropConfig("childEl", { type: HTMLElement, store: "bogus" as any })
        .serialize
    ).toBe(bare.serialize);
  });

  it("initRenderRootConfig defaults the tag and derives defaultSlots from shadow", () => {
    expect(initRenderRootConfig(undefined)).toBeUndefined();
    expect(initRenderRootConfig({})).toEqual({
      tag: "div",
      shadow: undefined,
      defaultSlots: false,
    });
    expect(initRenderRootConfig({ shadow: "open" })).toEqual({
      tag: "div",
      shadow: "open",
      defaultSlots: true,
    });
    expect(
      initRenderRootConfig({
        tag: "main",
        shadow: "closed",
        defaultSlots: false,
      })
    ).toEqual({ tag: "main", shadow: "closed", defaultSlots: false });
    expect(
      initRenderRootConfig({ shadow: "bogus" as any, defaultSlots: true })
    ).toEqual({ tag: "div", shadow: undefined, defaultSlots: true });
  });
});

describe("Prop reflection", () => {
  const ReflectHost = Neutron({
    tag: "reflect-props",
    props: {
      labelText: String,
      countValue: Number,
      isOpen: Boolean,
      tagNames: TokenList,
      payload: Object,
      childEl: { type: HTMLElement, store: "weak" },
      hardEl: HTMLElement,
      secretText: {
        type: String,
        store: {
          serialize: (v: unknown) => (v == null ? v : `s:${v}`),
          deserialize: (v: unknown) =>
            typeof v === "string" ? v.replace(/^s:/, "") : v,
        },
      },
    },
  }).onPropChanged(["labelText", "countValue"], vi.fn());
  ReflectHost.define();

  it("reflects primitives in both directions", () => {
    const el = document.createElement("reflect-props") as any;
    // String (observed attribute: read back from the prop store)
    el.labelText = 5;
    expect(el.getAttribute("label-text")).toBe("5");
    expect(el.labelText).toBe("5");
    el.setAttribute("label-text", "from-attr");
    expect(el.labelText).toBe("from-attr");
    el.labelText = null;
    expect(el.hasAttribute("label-text")).toBe(false);
    expect(el.labelText).toBe(null);
    // Number
    el.countValue = 3;
    expect(el.getAttribute("count-value")).toBe("3");
    el.setAttribute("count-value", "4.5");
    expect(el.countValue).toBe(4.5);
    el.setAttribute("count-value", "not-a-number");
    expect(el.countValue).toBe(null);
    el.setAttribute("count-value", "");
    expect(el.countValue).toBe(null);
    el.countValue = 7;
    el.countValue = "";
    expect(el.hasAttribute("count-value")).toBe(false);
    // Boolean (unobserved attribute: parsed from the attribute on read)
    el.isOpen = true;
    expect(el.getAttribute("is-open")).toBe("");
    el.isOpen = false;
    expect(el.hasAttribute("is-open")).toBe(false);
    el.setAttribute("is-open", "anything");
    expect(el.isOpen).toBe(true);
    el.removeAttribute("is-open");
    expect(el.isOpen).toBe(false);
    // TokenList
    el.tagNames = ["a", "", null, "b"];
    expect(el.getAttribute("tag-names")).toBe("a b");
    expect(el.tagNames).toEqual(["a", "b"]);
    el.setAttribute("tag-names", " x  y ");
    expect(el.tagNames).toEqual(["x", "y"]);
    el.tagNames = null;
    expect(el.hasAttribute("tag-names")).toBe(false);
    expect(el.tagNames).toBe(null);
    // custom serializer wraps the attribute value only
    el.secretText = "abc";
    expect(el.getAttribute("secret-text")).toBe("s:abc");
    expect(el.secretText).toBe("abc");
  });

  it("stores rich props on the instance, weakly when configured", () => {
    const el = document.createElement("reflect-props") as any;
    el.payload = { a: 1 };
    expect(el.hasAttribute("payload")).toBe(false);
    expect(el.payload).toEqual({ a: 1 });
    expect(el._n_.propStore.payload).toEqual({ a: 1 });
    const child = document.createElement("span");
    el.childEl = child;
    expect(el._n_.propStore.childEl).toBeInstanceOf(WeakRef);
    expect(el.childEl).toBe(child);
    el.hardEl = child;
    expect(el._n_.propStore.hardEl).toBe(child);
    el.childEl = null;
    expect(el.childEl).toBe(null);
    // only props with a reaction observe their attribute
    expect(ReflectHost.CustomElement.observedAttributes).toEqual([
      "label-text",
      "count-value",
    ]);
  });
});

describe("renderRoot", () => {
  Neutron({
    tag: "root-light",
    props: {},
    renderRoot: { tag: "section" },
  }).define();
  Neutron({
    tag: "root-shadow",
    props: {},
    renderRoot: { shadow: "open" },
  }).define();
  Neutron({
    tag: "root-closed",
    props: {},
    renderRoot: { tag: "main", shadow: "closed", defaultSlots: false },
  }).define();

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("appends a light-DOM render root once, on first connect", async () => {
    const el = fixture<any>(`<root-light><p>kept</p></root-light>`);
    await wait(0);
    expect(el.shadowRoot).toBe(null);
    expect(el.renderRoot.localName).toBe("section");
    expect(el.lastElementChild).toBe(el.renderRoot);
    expect(el.querySelector("p")!.textContent).toBe("kept");
    expect(el.querySelector("slot")).toBe(null);
    el.remove();
    await wait(0);
    document.body.append(el);
    expect(el.querySelectorAll("section")).toHaveLength(1);
  });

  it("attaches an open shadow root with a display:contents host and an adopt slot", async () => {
    const el = fixture<any>(`<root-shadow></root-shadow>`);
    await wait(0);
    const root = el.shadowRoot as ShadowRoot;
    expect(root).not.toBe(null);
    expect(el.renderRoot.parentNode).toBe(root);
    expect(el.renderRoot.localName).toBe("div");
    expect(el.renderRoot.getAttribute("style")).toContain("display: contents");
    const slot = root.querySelector(
      "slot[name=neutron-adopt]"
    ) as HTMLSlotElement;
    expect(slot).not.toBe(null);

    // slotted templates are imported into the shadow root; other slotted
    // nodes are ignored
    el.innerHTML = `<template slot="neutron-adopt"><p class="adopted">hi</p></template><span slot="neutron-adopt">no</span>`;
    slot.dispatchEvent(new Event("slotchange"));
    expect(root.querySelectorAll(".adopted")).toHaveLength(1);
    expect(root.querySelector("span")).toBe(null);
    // a re-import replaces the previous content instead of duplicating it
    slot.dispatchEvent(new Event("slotchange"));
    expect(root.querySelectorAll(".adopted")).toHaveLength(1);
  });

  it("supports a closed shadow root without default slots", async () => {
    const el = fixture<any>(`<root-closed></root-closed>`);
    await wait(0);
    expect(el.shadowRoot).toBe(null);
    const root = el.renderRoot.parentNode as ShadowRoot;
    expect(root).toBeInstanceOf(ShadowRoot);
    expect(root.mode).toBe("closed");
    expect(el.renderRoot.localName).toBe("main");
    expect(root.querySelector("slot")).toBe(null);
  });
});

describe("Element definition", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("Neutron() without props still defines a working element", async () => {
    const Empty = Neutron({ tag: "empty-host" } as any);
    Empty.define();
    const el = fixture<any>(`<empty-host></empty-host>`);
    await wait(0);
    expect(el.isMounted).toBe(true);
    expect(Object.keys(Empty.runtimeConfig.props)).toEqual([
      "isMounted",
      "isAdopted",
      "wasMounted",
      "isMoving",
      "renderRoot",
    ]);
    expect(isBuiltInElement(el)).toBe(false);
    expect(isBuiltInElement(undefined as any)).toBe(false);
  });
});

describe("static introspection", () => {
  it("getConfig() returns the runtime config after define() and undefined before", () => {
    const Builder = Neutron({
      tag: "config-probe",
      props: { isOpen: Boolean, openStage: Number, _secret: String },
      events: { toggled: { prefixWithTag: true } },
    });
    const Ctor = Builder.CustomElement as unknown as typeof NeutronElement;
    expect(Ctor.getConfig()).toBeUndefined();
    Builder.define();
    const config = Ctor.getConfig()!;
    expect(config.tag).toBe("config-probe");
    expect(Object.keys(config.props)).toEqual(
      expect.arrayContaining(["isOpen", "openStage", "_secret"])
    );
    expect(config.lifecycles.propSet).toBeDefined();
    // reachable through the registry and an instance's constructor
    const Registered = customElements.get("config-probe") as typeof NeutronElement;
    expect(Registered.getConfig()).toBe(config);
    const el = document.createElement("config-probe");
    expect((el.constructor as typeof NeutronElement).getConfig()).toBe(config);
  });

  it("getPropConfig() looks a prop up by attr or prop name", () => {
    const Ctor = customElements.get("config-probe") as typeof NeutronElement;
    expect(Ctor.getPropConfig({ attr: "open-stage" })).toMatchObject({
      prop: "openStage",
      attr: "open-stage",
      type: Number,
    });
    expect(Ctor.getPropConfig({ prop: "isOpen" })).toMatchObject({
      attr: "is-open",
      type: Boolean,
    });
    expect(Ctor.getPropConfig({ attr: "nope" })).toBeUndefined();
    expect(Ctor.getPropConfig({ prop: "nope" })).toBeUndefined();
  });
});
