import { Neutron } from "../../src/neutron";
import {
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/node_modules/vitest";
import { wait } from "@excom/heft-rig/profiles/default/config/test-utils";

/**
 * "Recomposition": an app author imports a package's raw builder (the
 * element source file, not the `index.ts` that calls `.define()`), edits its
 * lifecycles / methods / config, and only then registers it.
 */

// What a package's raw source file would export.
const onConnectedOriginal = vi.fn(() => ({ isReady: true }));
const onTickSetOriginal = vi.fn(() => ({ emit: ["tick"] }));
const makeRaw = (tag: string) =>
  Neutron({
    tag,
    props: { isReady: Boolean, tickCount: Number },
    events: { tick: { prefixWithTag: true } },
  })
    .onConnected(onConnectedOriginal)
    .onPropSet("tickCount", onTickSetOriginal)
    .defineMethods({
      bump: ({ tickCount }) => ({ tickCount: (tickCount ?? 0) + 1 }),
    });

describe("Neutron: recomposition before define()", () => {
  it("removes and replaces lifecycles by handler reference", async () => {
    const Raw = makeRaw("recompose-a");
    // registry shape the docs describe: [propNames, handler] pairs
    expect(Raw.builtConfig.lifecycles.connected).toEqual([
      [[], onConnectedOriginal],
    ]);
    expect(Raw.builtConfig.lifecycles.propSet).toEqual([
      [["tickCount"], onTickSetOriginal],
    ]);

    const onConnectedReplacement = vi.fn(() => ({ isReady: false }));
    Raw.offConnected(onConnectedOriginal)
      .onConnected(onConnectedReplacement)
      .offPropSet("tickCount", onTickSetOriginal);
    expect(Raw.builtConfig.lifecycles.connected).toEqual([
      [[], onConnectedReplacement],
    ]);
    expect(Raw.builtConfig.lifecycles.propSet).toEqual([]);

    Raw.define();
    const el = document.createElement("recompose-a") as any;
    document.body.append(el);
    await wait(1);
    expect(onConnectedOriginal).not.toHaveBeenCalled();
    expect(onConnectedReplacement).toHaveBeenCalledTimes(1);
    expect(el.hasAttribute("is-ready")).toBe(false);

    const tickListener = vi.fn();
    el.addEventListener("recompose-a-tick", tickListener);
    el.bump();
    await wait(1);
    expect(el.getAttribute("tick-count")).toBe("1");
    expect(onTickSetOriginal).not.toHaveBeenCalled();
    expect(tickListener).not.toHaveBeenCalled();
    el.remove();
  });

  it("adds lifecycles, methods, and (via compose) props", async () => {
    const Raw = makeRaw("recompose-b");
    const Recomposed = Neutron.compose([
      Raw,
      Neutron({ tag: "recompose-b", props: { extraLabel: String } }),
    ])
      .onPropSet("tickCount", () => ({ extraLabel: "ticked" }))
      .defineMethods({
        reset: () => ({ tickCount: null, extraLabel: null }),
      });
    Recomposed.define();

    const el = document.createElement("recompose-b") as any;
    document.body.append(el);
    await wait(1);
    // original lifecycles survive alongside the additions
    expect(el.hasAttribute("is-ready")).toBe(true);
    el.bump();
    await wait(1);
    expect(el.getAttribute("tick-count")).toBe("1");
    expect(el.getAttribute("extra-label")).toBe("ticked");
    el.reset();
    await wait(1);
    expect(el.hasAttribute("tick-count")).toBe(false);
    expect(el.hasAttribute("extra-label")).toBe(false);
    // compose deep-clones: the raw builder is untouched
    expect(Raw.builtConfig.props.extraLabel).toBeUndefined();
    expect(Raw.builtConfig.methods.map(([name]) => name)).toEqual(["bump"]);
    el.remove();
  });

  it("registers under another tag but keeps the configured event prefix", async () => {
    const Raw = makeRaw("recompose-c");
    Raw.define("recompose-c-custom");
    expect(customElements.get("recompose-c")).toBeUndefined();

    const el = document.createElement("recompose-c-custom") as any;
    document.body.append(el);
    await wait(1);
    const tickListener = vi.fn();
    el.addEventListener("recompose-c-tick", tickListener);
    el.bump();
    await wait(1);
    expect(tickListener).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it("ignores edits made after define()", async () => {
    const Raw = makeRaw("recompose-d");
    Raw.define();
    const late = vi.fn(() => ({ isReady: false }));
    Raw.onConnected(late);

    const el = document.createElement("recompose-d") as any;
    document.body.append(el);
    await wait(1);
    expect(late).not.toHaveBeenCalled();
    expect(el.hasAttribute("is-ready")).toBe(true);
    el.remove();
  });
});
