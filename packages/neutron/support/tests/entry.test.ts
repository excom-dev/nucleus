import * as barrel from "../../index";
import { NeutronError } from "../../src/neutron-error";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { NUCLEUS_DEVTOOLS_HOOK_KEY } from "@excom/kit-devtools";

describe("Package entry", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[
      NUCLEUS_DEVTOOLS_HOOK_KEY
    ];
  });

  it("re-exports the public surface", () => {
    expect(barrel.Neutron).toBeTypeOf("function");
    expect(barrel.NeutronElement).toBeTypeOf("function");
    expect(barrel.NeutronInternal).toBeTypeOf("function");
    expect(barrel.TokenList).toBeTypeOf("function");
    expect(barrel.attachDevtools).toBeTypeOf("function");
    expect(barrel.effector).toBeTypeOf("function");
    expect(barrel.compose).toBe(barrel.Neutron.compose);
    expect(barrel.Neutron.DOM.TokenList).toBe(barrel.TokenList);
    expect(barrel.Neutron.attachDevtools).toBe(barrel.attachDevtools);
  });

  it("NeutronError carries its class name", () => {
    const err = new NeutronError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NeutronError);
    expect(err.name).toBe("NeutronError");
    expect(err.message).toBe("boom");
    class SubError extends NeutronError {}
    expect(new SubError("x").name).toBe("SubError");
  });

  it("publishes `neutron/defined` with the tag and prop / attr pairs when an element is defined", () => {
    const published: Array<{ path: string[]; meta: Record<string, unknown> }> =
      [];
    barrel.attachDevtools({
      version: 1,
      publicize: (path, meta) => published.push({ path: [...path], meta }),
    });
    barrel.Neutron({
      tag: "defined-host",
      props: {
        labelText: String,
        hostEl: { type: HTMLElement, store: "weak" },
      },
    });
    const defined = published.filter(
      (p) => p.path.join("/") === "neutron/defined"
    );
    expect(defined).toHaveLength(1);
    expect(defined[0].meta).toEqual({
      tag: "defined-host",
      props: [
        { prop: "labelText", attr: "label-text" },
        { prop: "hostEl", attr: false },
      ],
    });
    // a definition, not an instance: nothing to deref
    expect(defined[0].meta.weakElement).toBeUndefined();
  });
});
