import {
  BROADCAST_CHANNEL,
  buildEventType,
  CommonElement,
  deref,
  getNamespace,
} from "../../src/common-element";
import { Neutron } from "../../src/neutron";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { KitLogger } from "@excom/kit-logger";

const onPing = vi.fn();
const onToast = vi.fn();

const ListenerHost = Neutron({
  tag: "listener-host",
  props: { hitCount: Number },
  events: { ping: { prefixWithTag: true } },
  broadcasts: { toast: { prefixWithTag: true } },
})
  .defineMethods({
    // lets a test apply an arbitrary effect to the element
    applyEffect: (_el, effect) => effect,
  })
  .onEvent("ping", onPing)
  .onBroadcast("toast", onToast);
ListenerHost.define();

type ListenerHostElement = HTMLElement & {
  _n_: any;
  applyEffect: (effect: unknown) => unknown;
};

const mount = async () => {
  const el = fixture<ListenerHostElement>(`<listener-host></listener-host>`);
  await wait(0);
  return el;
};

const cleanup = () => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  onPing.mockClear();
  onToast.mockClear();
};

describe("CommonElement: event types and namespaces", () => {
  it("prefixes configured events and broadcasts with the tag", () => {
    const ctr = ListenerHost as any;
    expect(buildEventType("ping", ctr)).toBe("listener-host-ping");
    expect(buildEventType("toast", ctr, { _broadcast: true })).toBe(
      "listener-host-toast"
    );
    // a name configured only as an event is not prefixed on the broadcast
    // channel, and vice versa
    expect(buildEventType("ping", ctr, { _broadcast: true })).toBe("ping");
    expect(buildEventType("toast", ctr)).toBe("toast");
    expect(buildEventType("other", ctr)).toBe("other");
    expect(buildEventType("other", undefined)).toBe("other");
  });

  it("getNamespace fills in missing registries; deref unwraps WeakRefs", () => {
    const div = document.createElement("div") as any;
    div._n_ = { element: div };
    const ns = getNamespace(div);
    expect(ns.eventListeners).toEqual([]);
    expect(ns.broadcastListeners).toEqual([]);
    expect(getNamespace(div)).toBe(ns);
    const fresh = document.createElement("div");
    expect(getNamespace(fresh).element).toBe(fresh);
    expect(deref(new WeakRef(div))).toBe(div);
    expect(deref(div)).toBe(div);
  });
});

describe("CommonElement: emit / broadcast", () => {
  afterEach(cleanup);

  it("emit defaults bubbles/cancelable/composed to true and honours overrides", async () => {
    const el = await mount();
    const seen: CustomEvent[] = [];
    document.body.addEventListener("listener-host-ping", (e) => {
      seen.push(e as CustomEvent);
    });
    const ev = CommonElement.emit.apply(el, [
      "ping",
      { detail: { n: 1 } },
    ]) as CustomEvent;
    expect(ev.type).toBe("listener-host-ping");
    expect([ev.bubbles, ev.cancelable, ev.composed]).toEqual([
      true,
      true,
      true,
    ]);
    expect(ev.detail).toEqual({ n: 1 });
    expect(seen).toEqual([ev]);
    expect(onPing).toHaveBeenCalledTimes(1);
    expect(onPing.mock.calls[0][0]).toBe(el);
    expect(onPing.mock.calls[0][1]).toBe(ev);

    const quiet = CommonElement.emit.apply(el, [
      "ping",
      { bubbles: false, cancelable: false, composed: false },
    ]) as CustomEvent;
    expect([quiet.bubbles, quiet.cancelable, quiet.composed]).toEqual([
      false,
      false,
      false,
    ]);
    // did not bubble to the body
    expect(seen).toHaveLength(1);
    expect(onPing).toHaveBeenCalledTimes(2);
  });

  it("emit dispatches from another target and rejects a missing type / target", async () => {
    const el = await mount();
    const other = document.createElement("div");
    document.body.append(other);
    const fn = vi.fn();
    other.addEventListener("ping", fn);
    el.applyEffect({ emit: ["ping", { target: other }] });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].target).toBe(other);
    // `other` has no Neutron config, so nothing is prefixed
    expect(onPing).not.toHaveBeenCalled();

    expect(() => CommonElement.emit.apply(el, ["" as any])).toThrow(
      "Event target and type are required"
    );
    expect(() => CommonElement.emit.call(undefined, "ping")).toThrow(
      "Event target and type are required"
    );
  });

  it("warns when emitting or broadcasting from a disconnected element", () => {
    const warn = vi.spyOn(KitLogger, "warn").mockImplementation(() => {});
    const el = document.createElement("listener-host") as ListenerHostElement;
    CommonElement.emit.apply(el, ["ping"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(
      /not connected: "listener-host"\. Dispatched event "listener-host-ping"/
    );
    CommonElement.broadcast.apply(el, ["toast"]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][0]).toMatch(
      /Dispatched broadcast "listener-host-toast"/
    );
  });

  it("broadcast is non-bubbling, goes through the shared channel, and reaches every instance", async () => {
    const a = await mount();
    const b = fixture<ListenerHostElement>(`<listener-host></listener-host>`);
    await wait(0);
    const onElement = vi.fn();
    a.addEventListener("listener-host-toast", onElement);
    const onChannel = vi.fn();
    BROADCAST_CHANNEL.addEventListener("listener-host-toast", onChannel);
    a.applyEffect({
      broadcast: ["toast", { detail: { msg: "hi" }, bubbles: true }],
    });
    BROADCAST_CHANNEL.removeEventListener("listener-host-toast", onChannel);

    expect(onElement).not.toHaveBeenCalled();
    expect(onChannel).toHaveBeenCalledTimes(1);
    const ev = onChannel.mock.calls[0][0] as CustomEvent;
    // forced off, even when the init asks for bubbling
    expect(ev.bubbles).toBe(false);
    expect(ev.detail).toEqual({ msg: "hi" });
    expect(onToast).toHaveBeenCalledTimes(2);
    expect(onToast.mock.calls.map(([el]) => el)).toEqual([a, b]);
  });
});

describe("CommonElement: listener registries", () => {
  afterEach(cleanup);

  it("dedupes identical listeners and tracks foreign targets weakly", async () => {
    const el = await mount();
    const fn = vi.fn();
    el.applyEffect({ addListener: ["custom-hit", fn] });
    el.applyEffect({ addListener: ["custom-hit", fn] });
    el.dispatchEvent(new CustomEvent("custom-hit"));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(
      el._n_.eventListeners.filter(([t]) => t === "custom-hit")
    ).toHaveLength(1);

    const other = document.createElement("div");
    document.body.append(other);
    const onOther = vi.fn();
    el.applyEffect({ addListener: ["other-hit", onOther, { target: other }] });
    const entry = el._n_.eventListeners.find(([t]) => t === "other-hit");
    expect(entry[2].target).toBeInstanceOf(WeakRef);
    expect(entry[2].target.deref()).toBe(other);
    other.dispatchEvent(new CustomEvent("other-hit"));
    expect(onOther).toHaveBeenCalledTimes(1);

    el.applyEffect({
      removeListener: ["other-hit", onOther, { target: other }],
    });
    other.dispatchEvent(new CustomEvent("other-hit"));
    expect(onOther).toHaveBeenCalledTimes(1);
    expect(
      el._n_.eventListeners.find(([t]) => t === "other-hit")
    ).toBeUndefined();
  });

  it("disconnect detaches every listener (foreign targets included); reconnect restores all but `once`", async () => {
    const el = await mount();
    const other = document.createElement("div");
    document.body.append(other);
    const onOther = vi.fn();
    const onOnce = vi.fn();
    const onPlain = vi.fn();
    el.applyEffect({
      addListeners: [
        ["other-hit", onOther, { target: other }],
        ["once-hit", onOnce, { once: true }],
        ["plain-hit", onPlain],
      ],
    });

    el.remove();
    await wait(0);
    expect(getEventListeners(el)).toEqual({});
    other.dispatchEvent(new CustomEvent("other-hit"));
    expect(onOther).not.toHaveBeenCalled();
    expect(el._n_.disconnectedEventListeners.map(([t]) => t)).toEqual([
      "listener-host-ping",
      "other-hit",
      "once-hit",
      "plain-hit",
    ]);

    document.body.append(el);
    expect(el._n_.disconnectedEventListeners).toEqual([]);
    other.dispatchEvent(new CustomEvent("other-hit"));
    el.dispatchEvent(new CustomEvent("once-hit"));
    el.dispatchEvent(new CustomEvent("plain-hit"));
    el.dispatchEvent(new CustomEvent("listener-host-ping"));
    expect(onOther).toHaveBeenCalledTimes(1);
    expect(onPlain).toHaveBeenCalledTimes(1);
    expect(onOnce).not.toHaveBeenCalled();
    expect(onPing).toHaveBeenCalledTimes(1);
  });

  it("removeAllListeners clears the element registry and skips collected targets", async () => {
    const el = await mount();
    const fn = vi.fn();
    el.applyEffect({
      addListeners: [
        ["a-hit", fn],
        ["b-hit", fn, { target: document.body }],
      ],
    });
    // a foreign target that has since been garbage-collected is skipped
    // instead of being dereferenced
    const collected = Object.create(WeakRef.prototype, {
      deref: { value: () => undefined },
    });
    el._n_.eventListeners.push(["ghost-hit", fn, { target: collected }]);

    el.applyEffect({ removeAllListeners: [] });
    expect(el._n_.eventListeners).toEqual([
      ["ghost-hit", fn, { target: collected }],
    ]);
    el.dispatchEvent(new CustomEvent("a-hit"));
    document.body.dispatchEvent(new CustomEvent("b-hit"));
    el.dispatchEvent(new CustomEvent("listener-host-ping"));
    expect(fn).not.toHaveBeenCalled();
    expect(onPing).not.toHaveBeenCalled();
  });

  it("manages broadcast listeners through the plural / toggle / removeAll variants", async () => {
    const el = await mount();
    const fnA = vi.fn();
    const fnB = vi.fn();
    const fnC = vi.fn();
    el.applyEffect({
      addBroadcastListeners: [
        ["bc-a", fnA],
        ["bc-b", fnB, { once: true }],
      ],
    });
    el.applyEffect({ broadcasts: [["bc-a"], ["bc-b", { detail: 2 }]] });
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
    expect((fnB.mock.calls[0][0] as CustomEvent).detail).toBe(2);

    el.applyEffect({
      toggleBroadcastListeners: [
        ["bc-a", fnA, false],
        ["bc-c", fnC, true],
      ],
    });
    el.applyEffect({ broadcasts: [["bc-a"], ["bc-c"]] });
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnC).toHaveBeenCalledTimes(1);

    el.applyEffect({ removeBroadcastListener: ["bc-c", fnC] });
    el.applyEffect({ removeBroadcastListeners: [["bc-b", fnB]] });
    expect(el._n_.broadcastListeners.map(([t]) => t)).toEqual([
      "listener-host-toast",
    ]);

    el.applyEffect({ removeAllBroadcastListeners: [] });
    expect(el._n_.broadcastListeners).toEqual([]);
    el.applyEffect({ broadcast: ["toast"] });
    expect(onToast).not.toHaveBeenCalled();
  });

  it("disconnect detaches broadcast listeners and reconnect restores them", async () => {
    const el = await mount();
    el.remove();
    await wait(0);
    expect(el._n_.broadcastListeners).toEqual([]);
    expect(el._n_.disconnectedBroadcastListeners.map(([t]) => t)).toEqual([
      "listener-host-toast",
    ]);

    const other = await mount();
    other.applyEffect({ broadcast: ["toast"] });
    expect(onToast).toHaveBeenCalledTimes(1);
    expect(onToast.mock.calls[0][0]).toBe(other);

    document.body.append(el);
    expect(el._n_.disconnectedBroadcastListeners).toEqual([]);
    other.applyEffect({ broadcast: ["toast"] });
    expect(onToast).toHaveBeenCalledTimes(3);
    expect(onToast.mock.calls.slice(1).map(([target]) => target)).toEqual(
      expect.arrayContaining([el, other])
    );
  });
});
