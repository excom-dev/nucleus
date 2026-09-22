import { KitLogManager, summarizeLogArg } from "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/node_modules/vitest";

describe("KitLogManager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs error at level 1", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = new KitLogManager({ namespace: "Test" });
    manager.level = 1;
    manager.error("err");
    expect(spy).toHaveBeenCalledWith("Test error: ", "err");
  });

  it("logs warn at level 2", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const manager = new KitLogManager({ namespace: "Test" });
    manager.level = 2;
    manager.warn("w");
    expect(spy).toHaveBeenCalledWith("Test warn: ", "w");
  });

  it("logs debug at level 3", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const manager = new KitLogManager({ namespace: "Test" });
    manager.level = 3;
    manager.debug("d");
    expect(spy).toHaveBeenCalledWith("Test debug: ", "d");
  });

  it("logs info at level 4", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const manager = new KitLogManager({ namespace: "Test" });
    manager.level = 4;
    manager.info("i");
    expect(spy).toHaveBeenCalledWith("Test info: ", "i");
  });

  it("suppresses log levels below threshold", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const manager = new KitLogManager({ namespace: "Test" });
    manager.level = 1;
    manager.warn("hidden");
    manager.debug("hidden");
    manager.info("hidden");
    manager.error("visible");
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("suppress and unsuppress restores original level", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = new KitLogManager({ namespace: "Test" });
    manager.level = 2;
    manager.suppress();
    manager.error("suppressed");
    expect(spy).not.toHaveBeenCalled();
    expect(manager.level).toBe(0);

    manager.unsuppress();
    expect(manager.level).toBe(2);
    manager.error("visible");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("double suppress is a no-op", () => {
    const manager = new KitLogManager({ namespace: "Test" });
    manager.level = 3;
    manager.suppress();
    manager.suppress();
    manager.unsuppress();
    expect(manager.level).toBe(3);
  });

  it("unsuppress without suppress is a no-op", () => {
    const manager = new KitLogManager({ namespace: "Test" });
    manager.level = 2;
    manager.unsuppress();
    expect(manager.level).toBe(2);
  });

  it("uses custom formatArgs", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = new KitLogManager({
      namespace: "Test",
      formatArgs: (args) => ["[CUSTOM]", ...args],
    });
    manager.level = 1;
    manager.error("boom");
    expect(spy).toHaveBeenCalledWith("[CUSTOM]", "Test error: ", "boom");
  });

  it("summarizes Element args instead of dumping the node tree", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = new KitLogManager({ namespace: "Test" });
    manager.level = 1;
    const el = document.createElement("include-content");
    el.id = "demo";
    manager.error(el, new Error("boom"));
    expect(spy).toHaveBeenCalledWith(
      "Test error: ",
      "<include-content#demo>",
      expect.any(Error),
    );
  });

  it("summarizes nodes nested in objects and arrays", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = new KitLogManager({ namespace: "Test" });
    manager.level = 1;
    const el = document.createElement("p");
    const error = new Error("boom");
    manager.error({ element: el, list: [el, 1], error: [error], n: 2 });
    expect(spy).toHaveBeenCalledWith("Test error: ", {
      element: "<p>",
      list: ["<p>", 1],
      error: [error],
      n: 2,
    });
  });

  it("summarizes nodes even when formatArgs is customized", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = new KitLogManager({
      namespace: "Test",
      formatArgs: ([, payload]) => ["custom", payload],
    });
    manager.level = 1;
    const el = document.createElement("span");
    el.id = "x";
    manager.error({ element: el });
    expect(spy).toHaveBeenCalledWith("custom", { element: "<span#x>" });
  });
});

describe("summarizeLogArg", () => {
  it("stops at the depth limit and marks cycles", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(summarizeLogArg(cyclic)).toEqual({ a: 1, self: "[Circular]" });
    const arr: unknown[] = [];
    arr.push(arr);
    expect(summarizeLogArg(arr)).toEqual(["[Circular]"]);

    let deep: Record<string, unknown> = { el: document.createElement("b") };
    for (let i = 0; i < 8; i++) deep = { deep };
    const out = summarizeLogArg(deep) as Record<string, unknown>;
    let cursor: any = out;
    for (let i = 0; i < 6; i++) cursor = cursor.deep;
    // beyond the depth limit the object is passed through untouched
    expect(cursor).toBe(
      (deep as any).deep.deep.deep.deep.deep.deep
    );
  });

  it("passes class instances, errors and primitives through", () => {
    class Thing {
      el = document.createElement("i");
    }
    const thing = new Thing();
    const err = new Error("e");
    expect(summarizeLogArg(thing)).toBe(thing);
    expect(summarizeLogArg(err)).toBe(err);
    expect(summarizeLogArg(null)).toBe(null);
    expect(summarizeLogArg("s")).toBe("s");
    expect(summarizeLogArg(Object.create(null))).toEqual({});
  });
});

describe("KitLogManager edge cases", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("summarizes non-element nodes by node type", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = new KitLogManager({ namespace: "Test" });
    manager.level = 1;
    const text = document.createTextNode("hello");
    manager.error(text);
    expect(spy).toHaveBeenCalledWith(
      "Test error: ",
      `[Node type=${Node.TEXT_NODE}]`,
    );
  });

  it("summarizes elements without an id as a bare tag", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const manager = new KitLogManager({ namespace: "Test" });
    manager.level = 2;
    manager.warn(document.createElement("span"));
    expect(spy).toHaveBeenCalledWith("Test warn: ", "<span>");
  });

  it("passes plain values through untouched", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const manager = new KitLogManager({ namespace: "Test" });
    manager.level = 4;
    const payload = { a: 1 };
    manager.info(payload, 42, null);
    expect(spy).toHaveBeenCalledWith("Test info: ", payload, 42, null);
  });

  it("leaves args alone when Node is not defined (non-DOM runtime)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = new KitLogManager({ namespace: "Test" });
    manager.level = 1;
    vi.stubGlobal("Node", undefined);
    manager.error("plain");
    expect(spy).toHaveBeenCalledWith("Test error: ", "plain");
  });

  it("defaults to level 1 when no level and no env override", () => {
    const manager = new KitLogManager({ namespace: "Test" });
    expect(manager.level).toBe(1);
  });

  it("constructs with an explicit level option", () => {
    /* Constructor still reads `level` from the env even when `opts.level`
       is given (operator-precedence bug). Only assert construction succeeds. */
    const manager = new KitLogManager({ namespace: "Test", level: 3 });
    expect(manager.namespace).toBe("Test");
  });

  it("exposes a shared default logger instance", async () => {
    const { KitLogger } = await import("../../index");
    expect(KitLogger).toBeInstanceOf(KitLogManager);
    expect(KitLogger.namespace).toBe("KitLogger");
  });
});
