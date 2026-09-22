/**
 * Runaway effect loops are cut by the shared loop guard (kit-utils):
 * two reactions feeding each other inside one element (Neutron already
 * rejects a handler writing its *own* prop), two elements feeding each
 * other, and an attribute chain that arrives already deep.
 */
import { Neutron } from "../../src/neutron";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { LoopGuard, type LoopGuardTrip } from "@excom/kit-utils";

Neutron({
  tag: "loop-counter",
  props: {
    count: Number,
    other: Number,
    payload: Object,
    echo: Object,
    source: Number,
    mirror: Number,
  },
})
  // attribute-backed ping-pong: never settles
  .onPropChanged("count", ({ count }) => ({ other: count + 1 }))
  .onPropChanged("other", ({ other }) => ({ count: other + 1 }))
  // same through rich (prop-backed) properties
  .onPropChanged("payload", ({ payload }) => payload && { echo: { n: payload.n + 1 } })
  .onPropChanged("echo", ({ echo }) => echo && { payload: { n: echo.n + 1 } })
  // legitimate reaction: one dependent write
  .onPropChanged("source", ({ source }) => ({ mirror: source * 2 }))
  .define();

Neutron({
  tag: "loop-ping",
  props: { ping: Number, partner: { type: HTMLElement, store: "weak" } },
})
  .onPropChanged("ping", ({ ping, partner }) =>
    partner ? { partner: { pong: ping + 1 } } : undefined
  )
  .define();

Neutron({
  tag: "loop-pong",
  props: { pong: Number, partner: { type: HTMLElement, store: "weak" } },
})
  .onPropChanged("pong", ({ pong, partner }) =>
    partner ? { partner: { ping: pong + 1 } } : undefined
  )
  .define();

describe("Neutron: loop guard", () => {
  let trips: LoopGuardTrip[];
  let off: () => void;

  beforeEach(() => {
    LoopGuard.reset();
    LoopGuard.configure({ limit: 5, log: () => {} });
    trips = [];
    off = LoopGuard.onTrip((trip) => trips.push(trip));
  });

  afterEach(() => {
    off();
    LoopGuard.reset();
    document.body.innerHTML = "";
  });

  const mount = async <T,>(html: string) => {
    const el = fixture<T>(html);
    await wait(0);
    return el;
  };

  it("cuts two reactions feeding each other through attribute-backed props", async () => {
    const el = await mount<any>(`<loop-counter></loop-counter>`);
    expect(() => {
      el.count = 1;
    }).not.toThrow();
    expect(trips.length).toBeGreaterThanOrEqual(1);
    expect(trips[0].target).toBe(el);
    expect(el.count + el.other).toBeLessThanOrEqual(LoopGuard.limit * 6);
    // attributes and props agree: no write was half-applied
    expect(el.getAttribute("count")).toBe(String(el.count));
    expect(el.getAttribute("other")).toBe(String(el.other));
    // the element keeps working afterwards
    await wait(0);
    const settled = el.count;
    await wait(0);
    expect(el.count).toBe(settled);
  });

  it("cuts two reactions feeding each other through rich props", async () => {
    const el = await mount<any>(`<loop-counter></loop-counter>`);
    expect(() => {
      el.payload = { n: 0 };
    }).not.toThrow();
    expect(trips.length).toBeGreaterThanOrEqual(1);
    expect(trips[0]).toMatchObject({ kind: "batch", target: el });
    // the handler's dependency list (plus Neutron' mount marker)
    expect(trips[0].name).toMatch(/^(payload|echo)\b/);
    expect(el.payload.n + el.echo.n).toBeLessThanOrEqual(LoopGuard.limit * 6);
  });

  it("cuts two elements feeding each other through child effects", async () => {
    const root = await mount<HTMLElement>(
      `<div><loop-ping></loop-ping><loop-pong></loop-pong></div>`
    );
    const ping = root.querySelector("loop-ping") as any;
    const pong = root.querySelector("loop-pong") as any;
    ping.partner = pong;
    pong.partner = ping;
    expect(() => {
      ping.ping = 0;
    }).not.toThrow();
    expect(trips.length).toBeGreaterThanOrEqual(1);
    expect(ping.ping + pong.pong).toBeLessThanOrEqual(LoopGuard.limit * 4);
    expect(pong.getAttribute("pong")).toBe(String(pong.pong));
    expect(ping.getAttribute("ping")).toBe(String(ping.ping));
  });

  it("does not trip a legitimate one-step reaction, however often it fires", async () => {
    const el = await mount<any>(`<loop-counter></loop-counter>`);
    for (let i = 1; i <= 30; i++) {
      el.source = i;
    }
    expect(el.mirror).toBe(60);
    expect(el.getAttribute("mirror")).toBe("60");
    expect(trips).toEqual([]);
  });

  it("attributeChangedCallback inherits the chain that wrote the attribute", async () => {
    const el = await mount<any>(`<loop-counter></loop-counter>`);
    // a guarded writer (e.g. a Quark rule) stamps the attribute at the
    // limit: the element's own reaction is the hop that crosses it
    LoopGuard.run(LoopGuard.limit - 1, () =>
      LoopGuard.write(el, "count", () => el.setAttribute("count", "5"))
    );
    expect(el.count).toBe(5);
    expect(el.hasAttribute("other")).toBe(false);
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({
      kind: "depth",
      target: el,
      name: "other",
      depth: LoopGuard.limit + 1,
    });
    // a fresh (external) write in a later task starts a new chain, which
    // runs its full length before being cut again
    await wait(0);
    el.setAttribute("count", "7");
    expect(el.other).toBeGreaterThanOrEqual(8);
    expect(el.count + el.other).toBeLessThanOrEqual(LoopGuard.limit * 4 + 16);
    expect(trips.length).toBeGreaterThanOrEqual(2);
  });
});
