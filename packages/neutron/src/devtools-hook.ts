import {
  type DevtoolsRenderer,
  injectRenderersIfNeeded,
  NUCLEUS_DEVTOOLS_HOOK_VERSION,
  registerRenderer,
  toDevtoolsJson,
} from "@excom/kit-devtools";

/**
 * Nucleus DevTools probe. The hook lives in `@excom/kit-devtools`;
 * this re-exports it and adds the Neutron renderer.
 *
 *   publicize(["neutron", "defined"], { tag, props }): once per `setup()`,
 *     no `weakElement`; extension audits attr names from it
 *   publicize(["neutron", "constructed"], { weakElement, tag })
 *   publicize(["neutron", "connected"], { weakElement, tag, isMoving, isFirstMount })
 *   publicize(["neutron", "disconnected"], { weakElement, tag, isMoving })
 *   publicize(["neutron", "effect"], { weakElement, tag, signature, effect, lockDepth, … })
 *   publicize(["neutron", "commit"], { weakElement, tag, changedProps })
 *   publicize(["neutron", "error"], { weakElement, tag, errorMessage, errorName })
 */
export {
  attachDevtools,
  DEVTOOLS_SERIALIZERS,
  type DevtoolsHook,
  type DevtoolsRenderer,
  type DevtoolsRendererKind,
  getDevtoolsHook,
  NUCLEUS_DEVTOOLS_HOOK_KEY,
  NUCLEUS_DEVTOOLS_HOOK_VERSION,
  pathMatches,
  publicize,
  type PublicizeMeta,
  type PublicizePath,
} from "@excom/kit-devtools";

export type NeutronInspectSnapshot = {
  tag: string;
  id: string | null;
  isMounted: boolean;
  wasMounted: boolean;
  isMoving: boolean;
  isAdopted: boolean;
  propNames: string[];
  /** Primitive-safe prop values. Element/object refs are tagged, not retained. */
  props: Record<string, unknown>;
};

export type NeutronRenderer = DevtoolsRenderer & {
  kind: "neutron";
  walkRoot: () => Element;
  isNeutronElement: (el: Element) => boolean;
  inspect: (el: Element) => NeutronInspectSnapshot | null;
};

const renderer: NeutronRenderer = {
  version: NUCLEUS_DEVTOOLS_HOOK_VERSION,
  kind: "neutron",
  walkRoot: () => document.body,
  isNeutronElement: (el) => !!(el as any)?._n_?.ctr,
  inspect: (el) => {
    const internal = (el as any)?._n_;
    if (!internal?.ctr) return null;
    const propNames = Object.keys(internal.ctr.runtimeConfig?.props ?? {});
    const props: Record<string, unknown> = {};
    for (const name of propNames) {
      try {
        props[name] = toDevtoolsJson(el[name as keyof typeof el]);
      } catch {
        props[name] = "[unreadable]";
      }
    }
    return {
      tag: el.localName,
      id: el.id || null,
      isMounted: !!el["isMounted" as keyof typeof el],
      wasMounted: !!el["wasMounted" as keyof typeof el],
      isMoving: !!el["isMoving" as keyof typeof el],
      isAdopted: !!el["isAdopted" as keyof typeof el],
      propNames,
      props,
    };
  },
};

registerRenderer(renderer);

/**
 * Inject the Neutron renderer into an installed hook (no-op when none, or
 * when already injected). Called on the first `define()` after a hook is
 * installed at `document_start`; late attachers use `attachDevtools()`.
 */
export const injectRendererIfNeeded = injectRenderersIfNeeded;
