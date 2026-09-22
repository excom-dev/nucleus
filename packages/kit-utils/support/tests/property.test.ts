import {
  defineObservableProperty,
  isObservedProperty,
  observeProperty,
} from "../../property";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";

describe("observeProperty", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("observes an own data property and keeps its value", () => {
    const obj: { n: number } = { n: 1 };
    const seen = vi.fn();
    const stop = observeProperty(obj, "n", seen);
    expect(obj.n).toBe(1);
    obj.n = 2;
    expect(obj.n).toBe(2);
    expect(seen).toHaveBeenCalledWith(2, 1);
    obj.n = 2;
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
  });

  it("restores a data property when the last observer leaves", () => {
    const obj: { n: number } = { n: 1 };
    const stop = observeProperty(obj, "n", () => {});
    obj.n = 5;
    expect(Object.getOwnPropertyDescriptor(obj, "n")?.get).toBeTypeOf(
      "function",
    );
    stop();
    const restored = Object.getOwnPropertyDescriptor(obj, "n");
    expect(restored?.value).toBe(5);
    expect(restored?.writable).toBe(true);
    expect(isObservedProperty(obj, "n")).toBe(false);
  });

  it("shadows an inherited accessor and still runs its setter", () => {
    class Box {
      #v = "a";
      calls = 0;
      get v() {
        return this.#v;
      }
      set v(next: string) {
        this.calls++;
        this.#v = next;
      }
    }
    const box = new Box();
    const seen = vi.fn();
    const stop = observeProperty(box, "v", seen);
    box.v = "b";
    expect(box.v).toBe("b");
    expect(box.calls).toBe(1);
    expect(seen).toHaveBeenCalledWith("b", "a");
    stop();
    expect(Object.getOwnPropertyDescriptor(box, "v")).toBeUndefined();
    box.v = "c";
    expect(box.calls).toBe(2);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("observes a native element property set from JS", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const seen = vi.fn();
    const stop = observeProperty(input, "value", seen);
    input.value = "typed";
    expect(input.value).toBe("typed");
    expect(seen).toHaveBeenCalledWith("typed", "");
    // the wrapper delegates to the platform accessor: attribute untouched
    expect(input.getAttribute("value")).toBeNull();
    stop();
    expect(Object.getOwnPropertyDescriptor(input, "value")).toBeUndefined();
  });

  it("shares one wrapper between observers", () => {
    const obj: { n: number } = { n: 0 };
    const a = vi.fn();
    const b = vi.fn();
    const stopA = observeProperty(obj, "n", a);
    const stopB = observeProperty(obj, "n", b);
    obj.n = 1;
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    stopA();
    obj.n = 2;
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    expect(isObservedProperty(obj, "n")).toBe(true);
    stopB();
    expect(isObservedProperty(obj, "n")).toBe(false);
    expect(obj.n).toBe(2);
  });

  it("does nothing for read-only properties", () => {
    const obj = Object.freeze({ n: 1 });
    const stop = observeProperty(obj, "n", () => {});
    expect(obj.n).toBe(1);
    expect(isObservedProperty(obj, "n")).toBe(false);
    stop();
    const getterOnly = {
      get g() {
        return 1;
      },
    };
    expect(isObservedProperty(getterOnly, "g")).toBe(false);
    observeProperty(getterOnly, "g", () => {})();
    expect(getterOnly.g).toBe(1);
  });

  it("observes a property that does not exist yet", () => {
    const obj: Record<string, unknown> = {};
    const seen = vi.fn();
    const stop = observeProperty(obj, "later", seen);
    expect(obj.later).toBeUndefined();
    obj.later = { a: 1 };
    expect(seen).toHaveBeenCalledWith({ a: 1 }, undefined);
    stop();
    expect(obj.later).toEqual({ a: 1 });
  });
});

describe("defineObservableProperty", () => {
  it("defines a storage-owning accessor when nothing observes", () => {
    const obj: { n?: number } = {};
    let store = 0;
    defineObservableProperty(obj, "n", {
      get: () => store,
      set: (v) => {
        store = (v as number) * 10;
      },
    });
    obj.n = 2;
    expect(obj.n).toBe(20);
    expect(Object.getOwnPropertyDescriptor(obj, "n")?.enumerable).toBe(false);
  });

  it("keeps an installed observer when the base is defined afterwards (upgrade)", () => {
    // pre-upgrade: a plain data property with a value
    const el = document.createElement("div") as HTMLElement & {
      provision?: unknown;
    };
    el.provision = { early: true };
    const seen = vi.fn();
    const stop = observeProperty(el, "provision", seen);
    // upgrade: the element class takes over storage
    let store: unknown = null;
    defineObservableProperty(el, "provision", {
      get: () => store,
      set: (v) => {
        store = v;
      },
    });
    el.provision = { late: true };
    expect(store).toEqual({ late: true });
    expect(el.provision).toEqual({ late: true });
    expect(seen).toHaveBeenLastCalledWith({ late: true }, null);
    stop();
    // the base accessor is what remains
    el.provision = { after: true };
    expect(store).toEqual({ after: true });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("notifies after the base setter finished", () => {
    const obj: { n?: number } = {};
    const order: string[] = [];
    let store = 0;
    defineObservableProperty(obj, "n", {
      get: () => store,
      set: (v) => {
        order.push("base");
        store = v as number;
      },
    });
    observeProperty(obj, "n", () => order.push("observer"));
    obj.n = 1;
    expect(order).toEqual(["base", "observer"]);
  });

  it("falls through to a plain define when the wrapper was replaced", () => {
    const obj: Record<string, unknown> = { n: 1 };
    const seen = vi.fn();
    const stop = observeProperty(obj, "n", seen);
    // something redefines the property over the wrapper
    Object.defineProperty(obj, "n", {
      value: 5,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    let store = 0;
    defineObservableProperty(obj, "n", {
      get: () => store,
      set: (v) => {
        store = v as number;
      },
      enumerable: true,
    });
    obj.n = 7;
    expect(store).toBe(7);
    expect(obj.n).toBe(7);
    expect(seen).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(obj, "n")?.enumerable).toBe(true);
    stop();
    expect(obj.n).toBe(7);
  });

  it("installs the observer over an existing own accessor and restores it", () => {
    const obj: Record<string, unknown> = {};
    let store = "a";
    defineObservableProperty(obj, "v", {
      get: () => store,
      set: (next) => {
        store = next as string;
      },
      enumerable: true,
    });
    const seen = vi.fn();
    const stop = observeProperty(obj, "v", seen);
    obj.v = "b";
    expect(seen).toHaveBeenCalledWith("b", "a");
    stop();
    const restored = Object.getOwnPropertyDescriptor(obj, "v");
    expect(restored?.get).toBeTypeOf("function");
    expect(restored?.enumerable).toBe(true);
    obj.v = "c";
    expect(store).toBe("c");
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe("observeProperty edge cases", () => {
  it("observes an inherited data property through an own shadow", () => {
    const proto = { n: 1 };
    const obj = Object.create(proto) as { n: number };
    const seen = vi.fn();
    const stop = observeProperty(obj, "n", seen);
    expect(obj.n).toBe(1);
    obj.n = 2;
    expect(seen).toHaveBeenCalledWith(2, 1);
    expect(proto.n).toBe(1);
    stop();
    // the shadow is removed; reads fall back to the prototype
    expect(Object.getOwnPropertyDescriptor(obj, "n")).toBeUndefined();
    expect(obj.n).toBe(1);
  });

  it("leaves a non-configurable own accessor alone", () => {
    const obj = {} as { x: number };
    let store = 1;
    Object.defineProperty(obj, "x", {
      get: () => store,
      set: (v: number) => {
        store = v;
      },
      configurable: false,
    });
    const seen = vi.fn();
    const stop = observeProperty(obj, "x", seen);
    obj.x = 2;
    expect(store).toBe(2);
    expect(seen).not.toHaveBeenCalled();
    expect(isObservedProperty(obj, "x")).toBe(false);
    stop();
  });

  it("does not restore when something redefined the property meanwhile", () => {
    const obj: Record<string, unknown> = { n: 1 };
    const stop = observeProperty(obj, "n", () => {});
    Object.defineProperty(obj, "n", {
      value: "redefined",
      writable: false,
      configurable: true,
    });
    stop();
    expect(isObservedProperty(obj, "n")).toBe(false);
    const descriptor = Object.getOwnPropertyDescriptor(obj, "n");
    expect(descriptor?.value).toBe("redefined");
    expect(descriptor?.writable).toBe(false);
  });

  it("unsubscribing twice is harmless", () => {
    const obj: { n: number } = { n: 1 };
    const a = vi.fn();
    const b = vi.fn();
    const stopA = observeProperty(obj, "n", a);
    const stopB = observeProperty(obj, "n", b);
    stopA();
    stopA();
    expect(isObservedProperty(obj, "n")).toBe(true);
    obj.n = 2;
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(2, 1);
    stopB();
    expect(isObservedProperty(obj, "n")).toBe(false);
    expect(Object.getOwnPropertyDescriptor(obj, "n")?.value).toBe(2);
  });

  it("chains a reflected native accessor so the attribute still updates", () => {
    const el = document.createElement("div");
    document.body.append(el);
    const seen = vi.fn();
    const stop = observeProperty(el, "title", seen);
    el.title = "hint";
    expect(el.getAttribute("title")).toBe("hint");
    expect(seen).toHaveBeenCalledWith("hint", "");
    el.setAttribute("title", "changed");
    // attribute writes bypass the setter: no notification, but reads are live
    expect(el.title).toBe("changed");
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
    expect(Object.getOwnPropertyDescriptor(el, "title")).toBeUndefined();
    el.title = "after";
    expect(el.getAttribute("title")).toBe("after");
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("observes a property set only later on a class instance accessor", () => {
    class Widget {
      #count = 0;
      get count() {
        return this.#count;
      }
      set count(v: number) {
        this.#count = v;
      }
    }
    const w = new Widget();
    const seen = vi.fn();
    const stop = observeProperty(w, "count", seen);
    // the wrapper is an own property; the class accessor stays on the prototype
    expect(Object.getOwnPropertyDescriptor(w, "count")?.get).toBeTypeOf(
      "function",
    );
    w.count = 3;
    expect(w.count).toBe(3);
    expect(seen).toHaveBeenCalledWith(3, 0);
    w.count = 3;
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
    expect(Object.getOwnPropertyDescriptor(w, "count")).toBeUndefined();
    expect(w.count).toBe(3);
  });
});
