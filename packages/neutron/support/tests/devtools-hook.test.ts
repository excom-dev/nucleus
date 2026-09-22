import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  attachDevtools,
  NUCLEUS_DEVTOOLS_HOOK_KEY,
  pathMatches,
  type DevtoolsHook,
  type NeutronRenderer,
  type PublicizeMeta,
  type PublicizePath,
} from "../../index";
import { Neutron } from "../../index";

const TestProbeEl = Neutron({
  tag: "test-probe-el",
  props: {
    label: String,
  },
})
  .onPropSet("label", () => ({}))
  .onError(() => ({}));

TestProbeEl.define();

const ErroringEl = Neutron({
  tag: "test-probe-error-el",
  props: {
    boom: Boolean,
  },
}).onPropSet("boom", () => {
  throw new Error("boom-from-probe");
});

ErroringEl.define();

type Publication = { path: PublicizePath; meta: PublicizeMeta };

describe("Nucleus DevTools hook", () => {
  const publications: Publication[] = [];
  let injectedRenderer: NeutronRenderer | null = null;

  const ofPath = (...tokens: string[]) =>
    publications.filter((p) => pathMatches(p.path, tokens));

  const installHook = () => {
    const hook: DevtoolsHook = {
      version: 1,
      inject: (renderer) => {
        injectedRenderer = renderer as NeutronRenderer;
      },
      publicize: (path, meta) => {
        publications.push({ path, meta });
      },
    };
    attachDevtools(hook);
    return hook;
  };

  afterEach(() => {
    document.body.innerHTML = "";
    delete (globalThis as any)[NUCLEUS_DEVTOOLS_HOOK_KEY];
    publications.length = 0;
    injectedRenderer = null;
  });

  it("pathMatches supports prefix and wildcard", () => {
    expect(pathMatches(["neutron", "constructed"], ["neutron"])).toBe(true);
    expect(pathMatches(["neutron", "constructed"], ["neutron", "constructed"])).toBe(
      true,
    );
    expect(pathMatches(["neutron", "constructed"], ["quark"])).toBe(false);
    expect(pathMatches(["neutron", "constructed"], ["*", "constructed"])).toBe(
      true,
    );
    expect(pathMatches(["neutron"], ["neutron", "constructed"])).toBe(false);
  });

  it("is dormant when no hook is installed", () => {
    const el = fixture<HTMLElement>(`<test-probe-el></test-probe-el>`);
    expect(el.isConnected).toBe(true);
    expect(publications).toHaveLength(0);
  });

  it("injects the renderer and publicizes constructed/connected", async () => {
    installHook();
    // define() already ran above; re-attach forces inject for late hooks
    attachDevtools((globalThis as any)[NUCLEUS_DEVTOOLS_HOOK_KEY]);

    const el = fixture<HTMLElement>(`<test-probe-el label="hi"></test-probe-el>`);
    await wait(0);

    expect(injectedRenderer).not.toBeNull();
    expect(injectedRenderer!.version).toBe(1);
    expect(injectedRenderer!.isNeutronElement(el)).toBe(true);

    const constructed = ofPath("neutron", "constructed");
    expect(constructed).toHaveLength(1);
    expect(constructed[0].meta.tag).toBe("test-probe-el");
    expect((constructed[0].meta.weakElement as WeakRef<Element>).deref()).toBe(
      el,
    );

    const connected = ofPath("neutron", "connected");
    expect(connected.length).toBeGreaterThanOrEqual(1);
    expect(connected[0].meta.tag).toBe("test-probe-el");
    expect(connected[0].meta.isFirstMount).toBe(true);
    expect((connected[0].meta.weakElement as WeakRef<Element>).deref()).toBe(el);
  });

  it("publicizes disconnected when removed", async () => {
    installHook();
    attachDevtools((globalThis as any)[NUCLEUS_DEVTOOLS_HOOK_KEY]);

    const el = fixture<HTMLElement>(`<test-probe-el></test-probe-el>`);
    await wait(0);
    publications.length = 0;

    el.remove();
    await wait(0);

    const disconnected = ofPath("neutron", "disconnected");
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0].meta.tag).toBe("test-probe-el");
    expect(disconnected[0].meta.isMoving).toBeFalsy();
  });

  it("publicizes commit with changed prop names on batch unlock", async () => {
    installHook();
    attachDevtools((globalThis as any)[NUCLEUS_DEVTOOLS_HOOK_KEY]);

    const el = fixture<HTMLElement>(`<test-probe-el></test-probe-el>`);
    await wait(0);
    publications.length = 0;

    (el as any).label = "updated";
    await wait(0);

    const labelCommits = ofPath("neutron", "commit").filter((p) =>
      (p.meta.changedProps as string[]).includes("label"),
    );
    expect(labelCommits.length).toBeGreaterThanOrEqual(1);
    expect((labelCommits[0].meta.weakElement as WeakRef<Element>).deref()).toBe(
      el,
    );
  });

  it("inspect() returns a primitive-safe snapshot", async () => {
    installHook();
    attachDevtools((globalThis as any)[NUCLEUS_DEVTOOLS_HOOK_KEY]);

    const el = fixture<HTMLElement>(
      `<test-probe-el id="probe-1" label="snap"></test-probe-el>`,
    );
    await wait(0);

    const snap = injectedRenderer!.inspect(el);
    expect(snap).not.toBeNull();
    expect(snap!.tag).toBe("test-probe-el");
    expect(snap!.id).toBe("probe-1");
    expect(snap!.isMounted).toBe(true);
    expect(snap!.props.label).toBe("snap");
    expect(snap!.propNames).toContain("label");
  });

  it("publicizes effect with effector signature and output", async () => {
    installHook();
    attachDevtools((globalThis as any)[NUCLEUS_DEVTOOLS_HOOK_KEY]);

    const el = fixture<HTMLElement>(`<test-probe-el></test-probe-el>`);
    await wait(0);
    publications.length = 0;

    (el as any).label = "updated";
    await wait(0);

    const effects = ofPath("neutron", "effect").filter(
      (p) => p.meta.signature === 'onPropSet("label")',
    );
    expect(effects.length).toBeGreaterThanOrEqual(1);
    expect(effects[0].meta.tag).toBe("test-probe-el");
    expect(effects[0].meta.effect).toEqual({});
    expect(effects[0].meta.lockDepth).toBeGreaterThanOrEqual(1);
    expect((effects[0].meta.weakElement as WeakRef<Element>).deref()).toBe(el);
  });

  it("publicizes error when an effector throws", async () => {
    installHook();
    attachDevtools((globalThis as any)[NUCLEUS_DEVTOOLS_HOOK_KEY]);

    const el = fixture<HTMLElement>(`<test-probe-error-el></test-probe-error-el>`);
    await wait(0);
    publications.length = 0;

    expect(() => {
      (el as any).boom = true;
    }).toThrow();

    const errors = ofPath("neutron", "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(String(errors[0].meta.errorMessage)).toContain("boom-from-probe");
    expect(errors[0].meta.tag).toBe("test-probe-error-el");
  });
});
