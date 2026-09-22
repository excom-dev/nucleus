/**
 * The `<devtools-selection>` Adapter on its own: the default adapter factory
 * (resolves the real `chrome` global), the attributes it reflects, and its
 * connect / move / disconnect lifecycle.
 */
import type { BrowserLike } from "../../lib/devtools-adapter";
import {
  defineDevtoolsSelection,
  DID_COPY_MS,
  DUMP_EVENT,
  setClipboardWriter,
  setDevtoolsAdapterFactory,
} from "../../lib/devtools-selection";
import type { SelectionInfo } from "../../lib/protocol";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { createFakeAdapter, infoFor } from "./fake-adapter";

defineDevtoolsSelection();

const g = globalThis as Record<string, unknown>;

/** A `chrome`-shaped global whose `$0` probe answers `info`. */
const makeChrome = (info: SelectionInfo) => {
  const ports: string[] = [];
  const chrome: BrowserLike = {
    devtools: {
      inspectedWindow: { eval: (_expression, cb) => cb(info, undefined) },
      panels: {
        elements: {
          onSelectionChanged: { addListener: () => {}, removeListener: () => {} },
        },
      },
    },
    runtime: {
      onMessage: { addListener: () => {}, removeListener: () => {} },
      connect: ({ name }) => {
        ports.push(name);
        return {
          postMessage: () => {},
          onMessage: { addListener: () => {} },
          onDisconnect: { addListener: () => {} },
        };
      },
    },
  };
  return { chrome, ports };
};

const settle = async () => {
  for (let i = 0; i < 4; i++) await wait(0);
};

const mount = async () => {
  const el = document.createElement("devtools-selection");
  document.body.append(el);
  await settle();
  return el;
};

describe("<devtools-selection>", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete g.chrome;
    delete g.browser;
  });

  // Runs first: later cases swap the adapter factory for the whole module.
  it("uses the real extension API by default (resolved from `chrome`)", async () => {
    const { chrome, ports } = makeChrome(infoFor("x-el", "7"));
    g.chrome = chrome;
    const el = await mount();
    expect(ports).toEqual(["nucleus-devtools"]);
    expect(el.getAttribute("selection-state")).toBe("selected");
    expect(el.getAttribute("selection-tag")).toBe("x-el");
    expect(el.hasAttribute("has-publications")).toBe(true);
    expect((el as unknown as { provision: { tag: string } }).provision.tag).toBe("x-el");
  });

  it("reflects the unavailable state when the probe cannot run", async () => {
    const fake = createFakeAdapter();
    fake.setInfo(null);
    setDevtoolsAdapterFactory(() => fake.adapter);
    const el = await mount();
    expect(el.getAttribute("selection-state")).toBe("unavailable");
    expect(el.hasAttribute("has-publications")).toBe(false);
  });

  it("keeps its source across a synchronous move and stops it on a real removal", async () => {
    const fake = createFakeAdapter();
    fake.setInfo(infoFor(null, null));
    setDevtoolsAdapterFactory(() => fake.adapter);
    const el = await mount();
    expect(fake.selectionListenerCount()).toBe(1);

    // remove + re-append before the disconnect microtask = a move
    const host = document.createElement("div");
    document.body.append(host);
    host.append(el);
    await settle();
    expect(fake.selectionListenerCount()).toBeGreaterThanOrEqual(1);

    el.remove();
    await settle();
    expect(fake.selectionListenerCount()).toBe(0);
  });

  it("copies the page's dump to the clipboard on `devtools-selection-dump` and flags did-copy", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeAdapter();
      fake.setInfo(infoFor("x-el", "7"));
      setDevtoolsAdapterFactory(() => fake.adapter);
      const written: string[] = [];
      setClipboardWriter(async (text) => {
        written.push(text);
      });
      const el = document.createElement("devtools-selection");
      document.body.append(el);
      await vi.advanceTimersByTimeAsync(20);

      // the next eval is the dump expression
      fake.setInfo('{"tool":"nucleus-devtools"}' as never);
      const event = new CustomEvent(DUMP_EVENT, { bubbles: true });
      const stop = vi.spyOn(event, "stopPropagation");
      el.querySelector("p")?.dispatchEvent(event) ?? el.dispatchEvent(event);
      await vi.advanceTimersByTimeAsync(20);
      expect(stop).toHaveBeenCalled();
      expect(written).toEqual(['{"tool":"nucleus-devtools"}']);
      expect(el.hasAttribute("did-copy")).toBe(true);
      await vi.advanceTimersByTimeAsync(DID_COPY_MS + 20);
      expect(el.hasAttribute("did-copy")).toBe(false);

      // nothing to copy (old probe): no clipboard write, no flag
      fake.setInfo(null);
      el.dispatchEvent(new CustomEvent(DUMP_EVENT));
      await vi.advanceTimersByTimeAsync(20);
      expect(written).toHaveLength(1);
      expect(el.hasAttribute("did-copy")).toBe(false);

      // a clipboard failure is swallowed
      fake.setInfo("{}" as never);
      setClipboardWriter(async () => {
        throw new Error("denied");
      });
      el.dispatchEvent(new CustomEvent(DUMP_EVENT));
      await vi.advanceTimersByTimeAsync(20);
      expect(el.hasAttribute("did-copy")).toBe(false);
    } finally {
      vi.useRealTimers();
      setClipboardWriter((text) => navigator.clipboard.writeText(text));
    }
  });

  it("defines the element only once", () => {
    const ctor = customElements.get("devtools-selection");
    expect(ctor).toBeDefined();
    expect(() => defineDevtoolsSelection()).not.toThrow();
    expect(customElements.get("devtools-selection")).toBe(ctor);
  });

  it("survives removal when the adapter could not be created (no extension API)", async () => {
    setDevtoolsAdapterFactory(() => {
      throw new Error("extension API unavailable");
    });
    /* Neutron connects synchronously, so the factory error escapes
     * `append()`; disconnect must cope with `_source` never being set. */
    const el = document.createElement("devtools-selection");
    expect(() => document.body.append(el)).toThrow(/extension API unavailable/);
    expect(el.hasAttribute("selection-state")).toBe(false);
    expect((el as unknown as { _source: unknown })._source ?? null).toBeNull();
    expect(() => el.remove()).not.toThrow();
    await settle();
    expect(el.isConnected).toBe(false);
  });
});
