import {
  type DevtoolsHook,
  injectRendererIfNeeded,
  Neutron,
  NUCLEUS_DEVTOOLS_HOOK_KEY,
  type NeutronRenderer,
  type PublicizeMeta,
  type PublicizePath,
} from "../../index";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";

Neutron({
  tag: "render-probe",
  props: {
    labelText: String,
    brokenProp: {
      type: Object,
      get: () => {
        throw new Error("unreadable");
      },
    },
    isBroken: Boolean,
  },
})
  .onPropSet("isBroken", () => {
    // a non-Error throw: no `.message` / `.name` to report
    throw "plain-failure";
  })
  .define();

type Publication = { path: PublicizePath; meta: PublicizeMeta };

describe("Neutron devtools renderer", () => {
  let renderer: NeutronRenderer | null = null;
  const injects: unknown[] = [];
  const publications: Publication[] = [];
  const hook: DevtoolsHook = {
    version: 1,
    inject: (r) => {
      injects.push(r);
      renderer = r as NeutronRenderer;
    },
    publicize: (path, meta) => {
      publications.push({ path, meta });
    },
  };

  beforeEach(() => {
    injects.length = 0;
    publications.length = 0;
    renderer = null;
    Neutron.attachDevtools(hook);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    delete (globalThis as any)[NUCLEUS_DEVTOOLS_HOOK_KEY];
  });

  it("injects the neutron renderer once per hook", () => {
    expect(injects).toHaveLength(1);
    expect(renderer!.kind).toBe("neutron");
    expect(renderer!.walkRoot()).toBe(document.body);
    injectRendererIfNeeded();
    expect(injects).toHaveLength(1);
    delete (globalThis as any)[NUCLEUS_DEVTOOLS_HOOK_KEY];
    expect(() => injectRendererIfNeeded()).not.toThrow();
    expect(injects).toHaveLength(1);
  });

  it("recognises only Neutron elements and snapshots their props safely", async () => {
    const div = document.createElement("div");
    expect(renderer!.isNeutronElement(div)).toBe(false);
    expect(renderer!.inspect(div)).toBe(null);

    const el = fixture<HTMLElement>(
      `<render-probe label-text="hi"></render-probe>`
    );
    await wait(0);
    expect(renderer!.isNeutronElement(el)).toBe(true);
    const snap = renderer!.inspect(el)!;
    expect(snap).toMatchObject({
      tag: "render-probe",
      id: null,
      isMounted: true,
      wasMounted: false,
      isMoving: false,
      isAdopted: false,
    });
    expect(snap.props.labelText).toBe("hi");
    expect(snap.props.brokenProp).toBe("[unreadable]");
    expect(snap.propNames).toEqual(
      expect.arrayContaining(["labelText", "brokenProp", "isMounted"])
    );
  });

  it("publishes non-Error throws with a stringified message and no name", async () => {
    const el = fixture<any>(`<render-probe></render-probe>`);
    await wait(0);
    publications.length = 0;
    let caught: unknown;
    try {
      el.isBroken = true;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe("plain-failure");
    const errors = publications.filter((p) => p.path[1] === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].meta).toMatchObject({
      tag: "render-probe",
      errorMessage: "plain-failure",
    });
    expect(errors[0].meta.errorName).toBeUndefined();
    expect((errors[0].meta.weakElement as WeakRef<Element>).deref()).toBe(el);
  });
});
