import { Neutron } from "../../src/neutron";
import { NeutronError } from "../../src/neutron-error";
import { effector, processEffectorResult } from "../../src/utils/effect";
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
import { observeProperty } from "@excom/kit-utils";

Neutron({
  tag: "order-host",
  props: {
    childEl: { type: HTMLElement, store: "weak" },
    stepText: String,
    provision: Object,
    recordFn: Function,
    payload: Object,
  },
})
  .defineMethods({
    // applies whatever effect the caller passes
    run: (_el, effect) => effect,
  })
  .define();

const mount = async () => {
  const el = fixture<any>(`<order-host></order-host>`);
  await wait(0);
  return el;
};

describe("Effects: application", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("applies the keys of one effect in the documented order", async () => {
    const el = await mount();
    const order: string[] = [];
    observeProperty(el, "childEl", () => {
      order.push("childEl");
    });
    observeProperty(el, "stepText", () => {
      order.push("stepText");
    });
    observeProperty(el, "provision", () => {
      order.push("provision");
    });
    el.recordFn = function () {
      order.push(`method:${this === el}`);
    };
    el.addEventListener("order-host-done", () => {
      order.push("emit");
    });
    // remove runs before add, so a listener removed and re-added in the
    // same effect ends up registered exactly once
    const fnX = vi.fn();
    el.run({ addListener: ["order-host-x", fnX] });

    const child = document.createElement("span");
    const result = el.run({
      emit: ["order-host-done"],
      recordFn: [],
      provision: { ready: true },
      stepText: "step",
      childEl: child,
      addListener: ["order-host-x", fnX],
      removeListener: ["order-host-x", fnX],
      returns: "done",
    });
    expect(result).toBe("done");
    expect(order).toEqual([
      "childEl",
      "stepText",
      "method:true",
      "provision",
      "emit",
    ]);
    expect(el.childEl).toBe(child);
    expect(el.provision).toEqual({ ready: true });
    el.dispatchEvent(new CustomEvent("order-host-x"));
    expect(fnX).toHaveBeenCalledTimes(1);
  });

  it("collects `returns` across array effects and skips empty / non-object entries", async () => {
    const el = await mount();
    expect(
      el.run([
        { stepText: "a" },
        null,
        false,
        { stepText: "b", returns: 1 },
        { returns: 2 },
      ])
    ).toEqual([1, 2]);
    expect(el.stepText).toBe("b");
    expect(el.run({ stepText: "c" })).toBeUndefined();
    expect(el.stepText).toBe("c");
    // non-POJO results are ignored
    expect(el.run(new Map())).toBeUndefined();
    expect(el.run(undefined)).toBeUndefined();
  });

  it("calls native methods and Function props with array arguments; ignores empty values", async () => {
    const el = await mount();
    el.recordFn = vi.fn();
    const onEmpty = vi.fn();
    el.addEventListener("order-host-empty", onEmpty);
    el.run({
      setAttribute: ["data-marker", "set"],
      focus: null,
      blur: undefined,
      recordFn: false,
      emit: null,
      emits: "",
    });
    expect(el.getAttribute("data-marker")).toBe("set");
    expect(el.recordFn).not.toHaveBeenCalled();
    expect(onEmpty).not.toHaveBeenCalled();
    el.run({ recordFn: ["a", "b"] });
    expect(el.recordFn).toHaveBeenCalledWith("a", "b");
    // a function held by an Object prop is a value, so it is replaced, not called
    el.payload = () => "fn";
    el.run({ payload: 5 });
    expect(el.payload).toBe(5);
  });

  it("rejects non-array arguments for calls", async () => {
    const el = await mount();
    expect(() => el.run({ emit: true })).toThrow(NeutronError);
    expect(() => el.run({ emit: true })).toThrow(
      "Cannot call function `emit` on order-host - arguments must be an array. Received: `true`..."
    );
    expect(() => el.run({ setAttribute: "data-marker" })).toThrow(
      "Cannot call function `setAttribute` on order-host - arguments must be an array. Received: `data-marke`..."
    );
    const unnamed = { toString: () => "", constructor: { name: "" } };
    expect(() => el.run({ setAttribute: unnamed })).toThrow(
      "Received: unknown"
    );
  });

  it("validates element-prop effects", async () => {
    const el = await mount();
    expect(() => el.run({ childEl: { title: "x" } })).toThrow(
      "Cannot set properties of `childEl` on element. Element must be set as a property first."
    );
    expect(() => el.run({ childEl: "nope" })).toThrow(
      "Cannot set property `childEl` on order-host - value must be an element or an object."
    );
    const child = document.createElement("span");
    el.run({ childEl: child });
    el.run({ childEl: { title: "nested" } });
    expect(child.title).toBe("nested");
    el.run({ childEl: null });
    expect(el.childEl).toBe(null);
    // renderRoot is always treated as an element prop
    const root = document.createElement("div");
    el.run({ renderRoot: root });
    el.run({ renderRoot: { title: "root" } });
    expect(el.renderRoot).toBe(root);
    expect(root.title).toBe("root");
  });
});

describe("Effects: effector()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the same wrapper when given an effector and warns", () => {
    const warn = vi.spyOn(KitLogger, "warn").mockImplementation(() => {});
    const wrapped = effector(() => ({ title: "t" }));
    expect(effector(wrapped)).toBe(wrapped);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("is already an effector");
  });

  it("returns several `returns` values as an array and undefined without any", () => {
    const div = document.createElement("div");
    expect(
      effector(() => [{ returns: 1 }, { title: "x" }, { returns: 2 }]).call(div)
    ).toEqual([1, 2]);
    expect(effector(() => ({ title: "y" })).call(div)).toBeUndefined();
    expect(div.title).toBe("y");
  });

  it("validateInput reshapes arguments and validateOutput can veto a result", () => {
    const div = document.createElement("div");
    const fn = vi.fn((_el, n: number) => ({ title: `n${n}`, returns: n }));
    const run = effector(fn, {
      validateInput: ([el, n]) => [el, n * 2],
      validateOutput: (_args, result: any) => result.returns < 10,
    });
    expect(run.call(div, 2)).toBe(4);
    expect(div.title).toBe("n4");
    expect(run.call(div, 10)).toBeUndefined();
    expect(div.title).toBe("n4");

    const skipped = vi.fn(() => ({ title: "no" }));
    expect(
      effector(skipped, { validateInput: () => false }).call(div)
    ).toBeUndefined();
    expect(skipped).not.toHaveBeenCalled();
  });

  it("rethrows errors with or without a host element", () => {
    const div = document.createElement("div");
    expect(() =>
      effector(() => {
        throw new Error("unhosted");
      })()
    ).toThrow("unhosted");
    expect(() =>
      effector(() => {
        throw new Error("hosted");
      }).call(div)
    ).toThrow("hosted");
  });

  it("delayNextTask defers the effect to the next task and returns a promise", async () => {
    const div = document.createElement("div");
    const p = effector(() => ({ title: "later", returns: "r" }), {
      delayNextTask: true,
    }).call(div);
    expect(p).toBeInstanceOf(Promise);
    expect(div.title).toBe("");
    expect(await p).toBe("r");
    expect(div.title).toBe("later");
  });

  it("processEffectorResult ignores non-object results and merges style", () => {
    const div = document.createElement("div");
    expect(processEffectorResult(div, null)).toBeUndefined();
    expect(processEffectorResult(div, 0)).toBeUndefined();
    expect(
      processEffectorResult(div, {
        returns: "r",
        style: { color: "red" },
      })
    ).toBe("r");
    expect(div.style.color).toBe("red");
    processEffectorResult(div, { style: { marginTop: "1px" } });
    expect(div.style.color).toBe("red");
    expect(div.style.marginTop).toBe("1px");
  });
});
