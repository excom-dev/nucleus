import { LoopGuard, type LoopGuardTrip } from "../../loop-guard";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";

describe("LoopGuard", () => {
  let trips: LoopGuardTrip[];
  let logs: string[];
  let off: () => void;

  beforeEach(() => {
    LoopGuard.reset();
    trips = [];
    logs = [];
    LoopGuard.configure({ log: (message) => logs.push(message) });
    off = LoopGuard.onTrip((trip) => trips.push(trip));
  });

  afterEach(() => {
    off();
    LoopGuard.reset();
    document.body.innerHTML = "";
  });

  describe("contexts", () => {
    it("is at depth 0 outside any context", () => {
      expect(LoopGuard.current()).toBe(0);
    });

    it("opens a context at max(current, inherited) and restores it after", () => {
      const seen: number[] = [];
      LoopGuard.run(3, () => {
        seen.push(LoopGuard.current());
        LoopGuard.run(1, () => seen.push(LoopGuard.current()));
        LoopGuard.run(7, () => seen.push(LoopGuard.current()));
        seen.push(LoopGuard.current());
      });
      expect(seen).toEqual([3, 3, 7, 3]);
      expect(LoopGuard.current()).toBe(0);
    });

    it("pops the context when fn throws", () => {
      expect(() =>
        LoopGuard.run(2, () => {
          throw new Error("boom");
        })
      ).toThrow("boom");
      expect(LoopGuard.current()).toBe(0);
    });

    it("returns fn's result", () => {
      expect(LoopGuard.run(1, () => "value")).toBe("value");
    });
  });

  describe("stamps", () => {
    it("write() stamps (target, name) one deeper than the current context", () => {
      const target = {};
      LoopGuard.write(target, "x", () => {});
      expect(LoopGuard.depthOf(target, "x")).toBe(1);
      LoopGuard.run(4, () => LoopGuard.write(target, "y", () => {}));
      expect(LoopGuard.depthOf(target, "y")).toBe(5);
      expect(LoopGuard.depthOf(target, "never")).toBe(0);
      expect(LoopGuard.depthOf({}, "x")).toBe(0);
    });

    it("stamp() records a depth without applying the limit", () => {
      LoopGuard.configure({ limit: 2 });
      const target = {};
      LoopGuard.run(10, () => LoopGuard.stamp(target, "x"));
      expect(LoopGuard.depthOf(target, "x")).toBe(11);
      LoopGuard.stamp(target, "y", 99);
      expect(LoopGuard.depthOf(target, "y")).toBe(99);
      expect(trips).toEqual([]);
    });

    it("stamps expire on the next macrotask, not within the task's microtasks", async () => {
      const target = {};
      LoopGuard.run(5, () => LoopGuard.write(target, "x", () => {}));
      expect(LoopGuard.depthOf(target, "x")).toBe(6);
      await Promise.resolve();
      await Promise.resolve();
      expect(LoopGuard.depthOf(target, "x")).toBe(6);
      await wait(0);
      expect(LoopGuard.depthOf(target, "x")).toBe(0);
    });

    it("a write in a later task starts a fresh chain even on a previously stamped address", async () => {
      const target = {};
      LoopGuard.run(20, () => LoopGuard.write(target, "x", () => {}));
      await wait(0);
      // an external writer (no context) does not inherit the old depth
      LoopGuard.write(target, "x", () => {});
      expect(LoopGuard.depthOf(target, "x")).toBe(1);
    });

    it("write() runs fn and returns its result", () => {
      const fn = vi.fn(() => 42);
      expect(LoopGuard.write({}, "x", fn)).toBe(42);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("the limit", () => {
    it("defaults to 50 and is configurable", () => {
      expect(LoopGuard.limit).toBe(50);
      LoopGuard.configure({ limit: 7 });
      expect(LoopGuard.limit).toBe(7);
      LoopGuard.configure({ limit: 0 });
      expect(LoopGuard.limit).toBe(7);
      LoopGuard.configure({ limit: 3.9 });
      expect(LoopGuard.limit).toBe(3);
      LoopGuard.reset();
      expect(LoopGuard.limit).toBe(50);
    });

    it("drops a write past the limit, reports it and returns false", () => {
      LoopGuard.configure({ limit: 3 });
      const target = document.createElement("div");
      const fn = vi.fn();
      // depth 3 is still allowed …
      expect(LoopGuard.run(2, () => LoopGuard.write(target, "x", fn))).not.toBe(
        false
      );
      expect(fn).toHaveBeenCalledTimes(1);
      // … depth 4 is not
      expect(LoopGuard.run(3, () => LoopGuard.write(target, "y", fn))).toBe(
        false
      );
      expect(fn).toHaveBeenCalledTimes(1);
      expect(LoopGuard.depthOf(target, "y")).toBe(0);
      expect(trips).toHaveLength(1);
      expect(trips[0]).toMatchObject({
        kind: "depth",
        target,
        name: "y",
        depth: 4,
        limit: 3,
      });
      expect(trips[0].message).toContain('"y"');
      expect(trips[0].message).toContain("<div>");
    });

    it("chains climb one hop at a time through inherited stamps", () => {
      LoopGuard.configure({ limit: 5 });
      const target = {};
      // simulate engine hops: each reaction inherits the stamp it reacts to
      let hops = 0;
      const hop = (name: string) =>
        LoopGuard.run(LoopGuard.depthOf(target, name), () => {
          const next = name === "a" ? "b" : "a";
          if (LoopGuard.write(target, next, () => hops++) !== false) hop(next);
        });
      hop("a");
      expect(hops).toBe(5);
      expect(trips).toHaveLength(1);
      expect(trips[0].depth).toBe(6);
    });
  });

  describe("reporting", () => {
    it("logs once per name per task but notifies listeners every time", () => {
      LoopGuard.configure({ limit: 1 });
      const target = {};
      LoopGuard.run(1, () => {
        LoopGuard.write(target, "x", () => {});
        LoopGuard.write(target, "x", () => {});
        LoopGuard.write(target, "z", () => {});
      });
      expect(trips).toHaveLength(3);
      expect(logs).toHaveLength(2);
      expect(logs[0]).toContain("Loop guard");
    });

    it("logs again in a later task", async () => {
      LoopGuard.configure({ limit: 1 });
      const target = {};
      LoopGuard.run(1, () => LoopGuard.write(target, "x", () => {}));
      await wait(0);
      LoopGuard.run(1, () => LoopGuard.write(target, "x", () => {}));
      expect(logs).toHaveLength(2);
    });

    it("logs to console.error by default", () => {
      LoopGuard.reset();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      LoopGuard.report({
        kind: "depth",
        target: {},
        name: "x",
        depth: 51,
        limit: 50,
        message: "custom message",
      });
      expect(error).toHaveBeenCalledWith("custom message");
    });

    it("unsubscribes listeners", () => {
      off();
      LoopGuard.configure({ limit: 1 });
      LoopGuard.run(1, () => LoopGuard.write({}, "x", () => {}));
      expect(trips).toEqual([]);
      off = () => {};
    });

    it("reset() keeps listeners but clears contexts, stamps and configuration", () => {
      const target = {};
      LoopGuard.configure({ limit: 2 });
      LoopGuard.stamp(target, "x", 9);
      LoopGuard.reset();
      expect(LoopGuard.depthOf(target, "x")).toBe(0);
      expect(LoopGuard.current()).toBe(0);
      expect(LoopGuard.limit).toBe(50);
      LoopGuard.configure({ log: () => {} });
      LoopGuard.run(50, () => LoopGuard.write(target, "x", () => {}));
      expect(trips).toHaveLength(1);
    });
  });
});
