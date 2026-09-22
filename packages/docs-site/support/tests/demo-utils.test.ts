import "@excom/quark";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  DEMO_STORAGE_KEY,
  appendOutputFromDetail,
  getPlanets,
  incrementFromJs,
  loadPolyfills,
  noteEvent,
  seedDemoStorage,
  setOutputFromDetail,
  setOutputFromElementData,
} from "../../public/demo-utils";

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("setOutputFromDetail / appendOutputFromDetail", () => {
  it("writes the event detail into the nearest output", () => {
    document.body.innerHTML = "<div><output></output></div>";
    const scope = document.querySelector("div")!;
    const output = document.querySelector("output")!;
    scope.addEventListener("demo", setOutputFromDetail);
    scope.dispatchEvent(new CustomEvent("demo", { detail: { a: 1 } }));
    expect(output.textContent).toBe('{\n  "a": 1\n}');
    scope.dispatchEvent(new CustomEvent("demo", { detail: null }));
    expect(output.textContent).toBe("{}");
  });

  it("targets the output itself and appends lines", () => {
    document.body.innerHTML = "<output>first</output>";
    const output = document.querySelector("output")!;
    output.addEventListener("demo", appendOutputFromDetail);
    output.dispatchEvent(new CustomEvent("demo", { detail: { b: 2 } }));
    expect(output.textContent).toBe('first\n{\n  "b": 2\n}');
  });

  it("does nothing without an output", () => {
    document.body.innerHTML = "<div></div>";
    const scope = document.querySelector("div")!;
    scope.addEventListener("demo", setOutputFromDetail);
    expect(() =>
      scope.dispatchEvent(new CustomEvent("demo", { detail: { a: 1 } }))
    ).not.toThrow();
    expect(scope.textContent).toBe("");
  });
});

describe("setOutputFromElementData", () => {
  it("writes the target provision into the scope output", () => {
    document.body.innerHTML =
      "<div><provider-x></provider-x><output></output></div>";
    const scope = document.querySelector("div")!;
    const source = document.querySelector("provider-x") as Element & {
      provision?: unknown;
    };
    const output = document.querySelector("output")!;
    scope.addEventListener("neutron-provision", setOutputFromElementData);
    source.provision = { ok: true };
    source.dispatchEvent(new Event("neutron-provision", { bubbles: true }));
    expect(output.textContent).toBe('{\n  "ok": true\n}');
    source.provision = undefined;
    source.dispatchEvent(new Event("neutron-provision", { bubbles: true }));
    expect(output.textContent).toBe("null");
  });

  it("targets the output itself and skips missing outputs", () => {
    document.body.innerHTML = "<output></output><div></div>";
    const output = document.querySelector("output") as HTMLOutputElement & {
      provision?: unknown;
    };
    output.provision = 1;
    output.addEventListener("neutron-provision", setOutputFromElementData);
    output.dispatchEvent(new Event("neutron-provision"));
    expect(output.textContent).toBe("1");

    const div = document.querySelector("div")!;
    div.addEventListener("neutron-provision", setOutputFromElementData);
    expect(() =>
      div.dispatchEvent(new Event("neutron-provision"))
    ).not.toThrow();
    expect(div.textContent).toBe("");
  });
});

describe("small helpers", () => {
  it("incrementFromJs bumps the owner's $count binding per call", () => {
    const owner = document.createElement("div");
    const handler = incrementFromJs(owner);
    handler();
    handler();
    expect(owner.quark.getPropertyValue("$count")).toBe(2);
  });

  it("getPlanets is static", () => {
    expect(getPlanets()).toEqual(["Mercury", "Venus", "Earth", "Mars"]);
  });

  it("noteEvent reports the intercepted event type in the sibling output", () => {
    document.body.innerHTML = "<div><a href='#'>go</a><output></output></div>";
    const link = document.querySelector("a")!;
    link.addEventListener("click", noteEvent);
    link.dispatchEvent(new Event("click"));
    expect(document.querySelector("output")!.textContent).toBe(
      '"click" handled — navigation prevented'
    );

    document.body.innerHTML = "<div><a href='#'>go</a></div>";
    const bare = document.querySelector("a")!;
    bare.addEventListener("click", noteEvent);
    expect(() => bare.dispatchEvent(new Event("click"))).not.toThrow();
  });

  it("loadPolyfills logs and returns a marker", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(loadPolyfills({ name: "safari" })).toBe("polyfills loaded");
    expect(log).toHaveBeenCalledWith(
      "<detect-browser> polyfill demo data:",
      { name: "safari" }
    );
  });
});

describe("seedDemoStorage", () => {
  it("writes a payload and re-keys the provider", () => {
    document.body.innerHTML =
      "<div><provider-storage key-name='x'></provider-storage></div>";
    const scope = document.querySelector("div")!;
    const el = document.querySelector("provider-storage") as Element & {
      keyName: string;
    };
    const writes: string[] = [];
    Object.defineProperty(el, "keyName", {
      set: (v: string) => writes.push(v),
      get: () => writes.at(-1) ?? "",
    });
    scope.addEventListener("click", seedDemoStorage);
    scope.dispatchEvent(new Event("click"));
    expect(writes).toEqual(["", DEMO_STORAGE_KEY]);
    expect(
      JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY)!)
    ).toHaveProperty("seededAt");
  });

  it("does nothing without a provider", () => {
    document.body.innerHTML = "<div></div>";
    const scope = document.querySelector("div")!;
    scope.addEventListener("click", seedDemoStorage);
    scope.dispatchEvent(new Event("click"));
    expect(localStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  });
});
