import type { SelectionSnapshot } from "../../lib/protocol";
import { DUMP_EXPRESSION, SelectionSource } from "../../lib/selection-source";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { createFakeAdapter, infoFor, recordFor } from "./fake-adapter";

const effect = (seq: number, elementId = "7") =>
  recordFor(seq, elementId, ["neutron", "effect"], { signature: "x", effect: {} });

const flushMicrotasks = () => Promise.resolve().then(() => Promise.resolve());

describe("SelectionSource", () => {
  let fake: ReturnType<typeof createFakeAdapter>;
  let snapshots: SelectionSnapshot[];
  let source: SelectionSource;

  beforeEach(() => {
    vi.useFakeTimers();
    fake = createFakeAdapter();
    snapshots = [];
    source = new SelectionSource(fake.adapter, (s) => snapshots.push(s));
  });

  afterEach(() => {
    source.stop();
    vi.useRealTimers();
  });

  it("starts with an empty selection", async () => {
    fake.setInfo(infoFor(null, null));
    source.start();
    await flushMicrotasks();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      state: "empty",
      tag: null,
      hasPublications: false,
      records: [],
    });
  });

  it("dump() evaluates the agent tools' bug report in the page", async () => {
    fake.setInfo(infoFor(null, null));
    source.start();
    await flushMicrotasks();
    const before = fake.evalCount;
    fake.setInfo('{"tool":"nucleus-devtools"}' as never);
    await expect(source.dump()).resolves.toBe('{"tool":"nucleus-devtools"}');
    expect(fake.evalCount).toBe(before + 1);
    fake.setInfo(null);
    await expect(source.dump()).resolves.toBeNull();
    // the expression guards a page without the tools
    expect(DUMP_EXPRESSION).toContain("api.tools.dump");
    expect(DUMP_EXPRESSION).toContain('typeof dump !== "function"');
  });

  it("reports the page API as unavailable when eval fails", async () => {
    fake.setInfo(null);
    source.start();
    await flushMicrotasks();
    expect(snapshots.at(-1)).toMatchObject({ state: "unavailable", records: [] });
  });

  it("reads history and inspect for the selected element", async () => {
    const inspect = { neutron: { props: { a: 1 } }, quark: null };
    fake.setInfo(infoFor("x-el", "7", [effect(1)], inspect));
    source.start();
    await flushMicrotasks();
    expect(snapshots.at(-1)).toMatchObject({
      state: "selected",
      tag: "x-el",
      hasPublications: true,
      inspect,
    });
    expect(snapshots.at(-1)!.records.map((r) => r.seq)).toEqual([1]);
  });

  it("flags a selected element that never published", async () => {
    fake.setInfo(infoFor("plain-el", null));
    source.start();
    await flushMicrotasks();
    expect(snapshots.at(-1)).toMatchObject({
      state: "selected",
      tag: "plain-el",
      hasPublications: false,
    });
  });

  it("appends matching records immediately, then resyncs current values", async () => {
    fake.setInfo(infoFor("x-el", "7", [effect(1)]));
    source.start();
    await flushMicrotasks();
    const evalsBefore = fake.evalCount;

    fake.setInfo(infoFor("x-el", "7", [effect(1), effect(2)], {
      neutron: { props: { fresh: true } },
      quark: null,
    }));
    fake.deliverRuntime(effect(2));
    // appended without waiting on the page
    expect(snapshots.at(-1)!.records.map((r) => r.seq)).toEqual([1, 2]);
    expect(fake.evalCount).toBe(evalsBefore);

    // debounced refresh pulls the new inspect snapshot
    await vi.advanceTimersByTimeAsync(32);
    await flushMicrotasks();
    expect(fake.evalCount).toBe(evalsBefore + 1);
    expect(snapshots.at(-1)!.inspect.neutron).toEqual({ props: { fresh: true } });
  });

  it("dedupes the same record arriving on both channels, then resyncs from the page", async () => {
    fake.setInfo(infoFor("x-el", "7"));
    source.start();
    await flushMicrotasks();
    const evalsBefore = fake.evalCount;
    fake.deliverRuntime(effect(3));
    fake.deliverPort(effect(3));
    expect(snapshots.at(-1)!.records.map((r) => r.seq)).toEqual([3]);
    // the page history is authoritative for duplicates (matches the old pane)
    fake.setInfo(infoFor("x-el", "7", [effect(3)]));
    await vi.advanceTimersByTimeAsync(32);
    await flushMicrotasks();
    expect(fake.evalCount).toBe(evalsBefore + 1);
    expect(snapshots.at(-1)!.records.map((r) => r.seq)).toEqual([3]);
  });

  it("ignores foreign messages and records for other elements (resyncs instead)", async () => {
    fake.setInfo(infoFor("x-el", "7"));
    source.start();
    await flushMicrotasks();
    const evalsBefore = fake.evalCount;
    const count = snapshots.length;

    fake.deliverRaw({ source: "someone-else", type: "publicize" });
    fake.deliverRaw({ source: "nucleus-devtools", type: "ready" });
    expect(snapshots).toHaveLength(count);
    expect(fake.evalCount).toBe(evalsBefore);

    fake.deliverRuntime(effect(9, "other"));
    expect(snapshots).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(32);
    await flushMicrotasks();
    expect(fake.evalCount).toBe(evalsBefore + 1);
  });

  it("does nothing with records while nothing is selected", async () => {
    fake.setInfo(infoFor(null, null));
    source.start();
    await flushMicrotasks();
    const count = snapshots.length;
    fake.deliverRuntime(effect(1));
    await vi.advanceTimersByTimeAsync(50);
    expect(snapshots).toHaveLength(count);
  });

  it("re-reads the page when the Elements selection changes", async () => {
    fake.setInfo(infoFor("x-el", "7"));
    source.start();
    await flushMicrotasks();
    fake.selectElement(infoFor("other-el", "8", [effect(4, "8")]));
    await flushMicrotasks();
    expect(snapshots.at(-1)).toMatchObject({ tag: "other-el", hasPublications: true });
    expect(snapshots.at(-1)!.records.map((r) => r.seq)).toEqual([4]);
  });

  it("keeps the background port alive and reconnects when it drops", async () => {
    fake.setInfo(infoFor(null, null));
    source.start();
    expect(fake.ports).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20000);
    expect(fake.ports[0].posted).toEqual([
      { source: "nucleus-devtools", type: "ready" },
    ]);
    fake.dropPort();
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.ports).toHaveLength(2);
    // the dead port stops pinging
    await vi.advanceTimersByTimeAsync(20000);
    expect(fake.ports[0].posted).toHaveLength(1);
    expect(fake.ports[1].posted).toHaveLength(1);
  });

  it("exposes the latest snapshot as `current` and ignores a second start()", async () => {
    expect(source.current).toMatchObject({ state: "empty", records: [] });
    fake.setInfo(infoFor("x-el", "7", [effect(1)]));
    source.start();
    source.start();
    await flushMicrotasks();
    expect(fake.runtimeListenerCount()).toBe(1);
    expect(fake.ports).toHaveLength(1);
    expect(source.current).toBe(snapshots.at(-1));
    expect(source.current.records.map((r) => r.seq)).toEqual([1]);
  });

  it("defaults missing lifecycles / inspect in the page probe result", async () => {
    fake.setInfo({ id: "7", tag: "x-el" } as never);
    source.start();
    await flushMicrotasks();
    expect(snapshots.at(-1)).toMatchObject({
      state: "selected",
      records: [],
      inspect: { neutron: null, quark: null },
    });
  });

  it("drops a refresh that resolves after stop()", async () => {
    fake.setInfo(infoFor("x-el", "7"));
    source.start();
    source.stop();
    await flushMicrotasks();
    expect(snapshots).toHaveLength(0);
  });

  it("ignores non-object bridge messages", async () => {
    fake.setInfo(infoFor("x-el", "7"));
    source.start();
    await flushMicrotasks();
    const count = snapshots.length;
    fake.deliverRaw(null);
    fake.deliverRaw("publicize");
    await vi.advanceTimersByTimeAsync(50);
    expect(snapshots).toHaveLength(count);
    expect(fake.evalCount).toBe(1);
  });

  it("forgets the oldest seen ids past `maxSeen` so a very old seq can be re-appended", async () => {
    source.stop();
    source = new SelectionSource(fake.adapter, (s) => snapshots.push(s), { maxSeen: 2 });
    fake.setInfo(infoFor("x-el", "7"));
    source.start();
    await flushMicrotasks();
    fake.deliverRuntime(effect(1));
    fake.deliverRuntime(effect(2));
    fake.deliverRuntime(effect(3)); // evicts 1
    fake.deliverRuntime(effect(2)); // still remembered
    fake.deliverRuntime(effect(1)); // forgotten → appended again
    expect(snapshots.at(-1)!.records.map((r) => r.seq)).toEqual([1, 2, 3, 1]);
  });

  it("forgets seen ids when the selection changes", async () => {
    fake.setInfo(infoFor("x-el", "7"));
    source.start();
    await flushMicrotasks();
    fake.deliverRuntime(effect(5));
    expect(snapshots.at(-1)!.records.map((r) => r.seq)).toEqual([5]);
    fake.selectElement(infoFor("x-el", "7"));
    await flushMicrotasks();
    expect(snapshots.at(-1)!.records).toEqual([]);
    fake.deliverRuntime(effect(5));
    expect(snapshots.at(-1)!.records.map((r) => r.seq)).toEqual([5]);
  });

  it("stops pinging a port whose postMessage throws", async () => {
    source.stop();
    let attempts = 0;
    const adapter = {
      ...fake.adapter,
      connectPort: (name: string) => {
        const port = fake.adapter.connectPort(name);
        return {
          ...port,
          postMessage: () => {
            attempts++;
            throw new Error("Attempting to use a disconnected port object");
          },
        };
      },
    };
    source = new SelectionSource(adapter, (s) => snapshots.push(s));
    fake.setInfo(infoFor(null, null));
    source.start();
    await vi.advanceTimersByTimeAsync(20000 * 3);
    expect(attempts).toBe(1);
    expect(fake.ports).toHaveLength(1);
  });

  it("does not reconnect a port that drops after stop()", async () => {
    fake.setInfo(infoFor(null, null));
    source.start();
    source.stop();
    fake.dropPort();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.ports).toHaveLength(1);
  });

  it("stop() removes listeners and timers", async () => {
    fake.setInfo(infoFor("x-el", "7"));
    source.start();
    await flushMicrotasks();
    expect(fake.runtimeListenerCount()).toBe(1);
    expect(fake.selectionListenerCount()).toBe(1);
    fake.deliverRuntime(effect(9, "other")); // schedules a refresh
    source.stop();
    const count = snapshots.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.runtimeListenerCount()).toBe(0);
    expect(fake.selectionListenerCount()).toBe(0);
    expect(snapshots).toHaveLength(count);
  });
});
