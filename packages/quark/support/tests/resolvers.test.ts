/**
 * Field resolvers: value semantics (wipe / preserve) per declaration kind,
 * content rendering of raw nodes and promises, and the DevTools result
 * presentation of each shape.
 */
import { Quark } from "../../index";
import { SYMBOL_NOOP } from "../../src/constants";
import { FIELD_RESOLVERS, resolveField } from "../../src/resolvers";
import { NUCLEUS_DEVTOOLS_HOOK_KEY } from "@excom/kit-devtools";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { flush, mount, unregisterAll } from "./helpers";

describe("resolvers", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    delete (globalThis as any)[NUCLEUS_DEVTOOLS_HOOK_KEY];
    vi.restoreAllMocks();
  });

  describe("content", () => {
    it("wipes rendered rows but keeps the source <template>", async () => {
      const { root } = mount(
        `<ul><template><li></li></template><li>old</li></ul>`,
        `ul { content: none; }`
      );
      await flush();
      const ul = root.querySelector("ul")!;
      expect(ul.querySelector("template")).toBeTruthy();
      expect(ul.querySelectorAll("li")).toHaveLength(0);
    });

    it("wipes on null and on unbound variables", async () => {
      const { root } = mount(
        `<p bind-a>stale</p><p bind-b>stale</p>`,
        `[bind-a] { content: null; }
         [bind-b] { content: $missing; }`
      );
      await flush();
      expect(root.querySelector("[bind-a]")?.textContent).toBe("");
      expect(root.querySelector("[bind-b]")?.textContent).toBe("");
    });

    it("paints a Node and a NodeList into a regular element", async () => {
      const node = document.createElement("em");
      node.textContent = "one";
      const wrap = document.createElement("div");
      wrap.innerHTML = `<i>a</i><i>b</i>`;
      const { root } = mount(
        `<p bind-node></p><p bind-list></p>`,
        `[bind-node] { content: getNode(); }
         [bind-list] { content: getList(); }`,
        { getNode: () => node, getList: () => wrap.childNodes }
      );
      await flush();
      expect(root.querySelector("[bind-node]")?.innerHTML).toBe("<em>one</em>");
      expect(root.querySelector("[bind-list]")?.innerHTML).toBe(
        "<i>a</i><i>b</i>"
      );
    });

    it("settles promises: strings paint, wipes clear, preserve keeps", async () => {
      const { root } = mount(
        `<p bind-s>stale</p><p bind-w>stale</p><p bind-p>stale</p>`,
        `[bind-s] { content: later("done"); }
         [bind-w] { content: later(null); }
         [bind-p] { content: later(keep); }`,
        {
          later: (v: unknown) => Promise.resolve(v),
          keep: SYMBOL_NOOP,
        }
      );
      await flush();
      expect(root.querySelector("[bind-s]")?.textContent).toBe("done");
      expect(root.querySelector("[bind-w]")?.textContent).toBe("");
      expect(root.querySelector("[bind-p]")?.textContent).toBe("stale");
    });

    it("logs a rejected content promise without touching the element", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { root } = mount(
        `<p bind-x>stale</p>`,
        `[bind-x] { content: failing(); }`,
        { failing: () => Promise.reject(new Error("nope")) }
      );
      await flush();
      expect(root.querySelector("[bind-x]")?.textContent).toBe("stale");
      expect(error).toHaveBeenCalled();
    });

    it("re-paints only when the text differs from the sole text node", async () => {
      const { root, quark } = mount(
        `<p bind-x>same</p>`,
        `[bind-x] { content: "same"; }`
      );
      await flush();
      const p = root.querySelector("[bind-x]")!;
      const first = p.firstChild;
      quark.queueRunRules({ element: p as HTMLElement, attribute: "NEW_SELF" });
      await flush();
      expect(p.firstChild).toBe(first);
    });
  });

  describe("class", () => {
    it("accepts strings, arrays and maps; preserve and none", async () => {
      const { root } = mount(
        `<p bind-a class="old"></p><p bind-b class="old"></p>
         <p bind-c class="keep"></p><p bind-d class="gone"></p>`,
        `[bind-a] { class: ["x", "y"]; }
         [bind-b] { class: (old: false, z: true); }
         [bind-c] { class: preserve; }
         [bind-d] { class: none; }`
      );
      await flush();
      expect(root.querySelector("[bind-a]")?.className).toBe("x y");
      expect(root.querySelector("[bind-b]")?.className).toBe("z");
      expect(root.querySelector("[bind-c]")?.className).toBe("keep");
      expect(root.querySelector("[bind-d]")?.hasAttribute("class")).toBe(false);
    });
  });

  describe("dataset / ariaset", () => {
    it("replaces previously written prefixed attributes and honours wipe / preserve", async () => {
      const { root } = mount(
        `<p bind-x data-mode="a" title="t"></p><p bind-y></p><p bind-z aria-label="k"></p>`,
        `[bind-x] { title: "t2"; dataset: prop("box"); ariaset: prop("aria"); }
         [bind-y] { dataset: none; ariaset: none; }
         [bind-z] { dataset: preserve; ariaset: preserve; }`
      );
      const p = root.querySelector("[bind-x]") as HTMLElement & {
        box?: unknown;
        aria?: unknown;
      };
      p.box = { first: 1 };
      p.aria = { label: "one" };
      await flush();
      expect(p.getAttribute("data-first")).toBe("1");
      expect(p.getAttribute("aria-label")).toBe("one");
      p.box = { second: 2 };
      p.aria = { hidden: "true" };
      await flush();
      // attributes written by the earlier object are removed; foreign ones stay
      expect(p.hasAttribute("data-first")).toBe(false);
      expect(p.getAttribute("data-second")).toBe("2");
      expect(p.hasAttribute("aria-label")).toBe(false);
      expect(p.getAttribute("aria-hidden")).toBe("true");
      expect(p.getAttribute("data-mode")).toBe("a");
      expect(p.getAttribute("title")).toBe("t2");
      expect(root.querySelector("[bind-z]")?.getAttribute("aria-label")).toBe(
        "k"
      );
    });
  });

  describe("direct resolver calls", () => {
    it("publishes failures without a rule and with non-Error throws", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const publications: { path: string[]; meta: any }[] = [];
      Quark.attachDevtools({
        version: 1,
        inject: () => {},
        publicize: (path, meta) => {
          publications.push({ path: path as string[], meta });
        },
      });
      const element = document.createElement("p");
      expect(
        resolveField({
          element,
          key: "data-x",
          value: "nope()",
          options: {},
          hash: "h",
        })
      ).toBe(SYMBOL_NOOP);
      const [err] = publications.filter(
        (p) => p.path.join("/") === "quark/error"
      );
      expect(err.meta).toMatchObject({
        selector: null,
        ruleId: null,
        sheetId: null,
        runId: null,
        errorName: "QuarkEvalError",
      });
      const [apply] = publications.filter(
        (p) => p.path.join("/") === "quark/apply"
      );
      expect(apply.meta).toMatchObject({
        selector: null,
        ruleId: null,
        isNoop: true,
      });
      expect(error).toHaveBeenCalledTimes(1);
    });

    it("stringifies thrown non-Error values", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const publications: { path: string[]; meta: any }[] = [];
      Quark.attachDevtools({
        version: 1,
        inject: () => {},
        publicize: (path, meta) => {
          publications.push({ path: path as string[], meta });
        },
      });
      const { root } = mount(
        `<p bind-x>stale</p>`,
        `[bind-x] { content: boom(); }`,
        {
          boom: () => {
            throw "plain string";
          },
        }
      );
      await flush();
      expect(root.querySelector("[bind-x]")?.textContent).toBe("stale");
      const [err] = publications.filter(
        (p) => p.path.join("/") === "quark/error"
      );
      expect(err.meta.errorMessage).toBe("plain string");
      expect(err.meta.errorName).toBeUndefined();
    });

    it("ignores falsy non-wipe dataset values and unsupported class shapes", async () => {
      const { root } = mount(
        `<p bind-x class="keep"></p>`,
        `[bind-x] { dataset: false; ariaset: 0; class: 5; }`
      );
      await flush();
      const p = root.querySelector("[bind-x]")!;
      expect(p.className).toBe("keep");
      expect([...p.attributes].map((a) => a.name)).toEqual(["bind-x", "class"]);
    });

    it("treats an empty declaration value as a wipe", async () => {
      const element = document.createElement("p");
      element.setAttribute("data-x", "1");
      const result = FIELD_RESOLVERS.attribute({
        element,
        key: "data-x",
        value: "",
        options: {},
        hash: "h",
      });
      expect(result).toBeUndefined();
      await wait(0);
      expect(element.hasAttribute("data-x")).toBe(false);
    });
  });

  describe("listener", () => {
    it("leaves listeners untouched when the handler list is preserve", async () => {
      const handler = vi.fn();
      const { root } = mount(
        `<button type="button" bind-x></button>`,
        `[bind-x] { @on click (handle: handler); }
         [bind-x] { @on click (handle: preserve); }`,
        { handler }
      );
      await flush();
      (root.querySelector("[bind-x]") as HTMLButtonElement).click();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("DevTools result presentation", () => {
    const publications: { path: string[]; meta: any }[] = [];
    const installHook = () =>
      Quark.attachDevtools({
        version: 1,
        inject: () => {},
        publicize: (path, meta) => {
          publications.push({ path: path as string[], meta });
        },
      });
    afterEach(() => {
      publications.length = 0;
    });
    const applyFor = (selector: string) =>
      publications.find(
        (p) =>
          p.path.join("/") === "quark/apply" &&
          p.meta.key === "content" &&
          p.meta.selector === selector
      )!;

    it("expands NodeLists, fragments and arrays; unwraps rejected promises", async () => {
      installHook();
      const wrap = document.createElement("div");
      wrap.innerHTML = `<i>a</i><i>b</i>`;
      const fragment = document.createDocumentFragment();
      fragment.appendChild(document.createTextNode("  "));
      fragment.appendChild(document.createTextNode("txt"));
      fragment.appendChild(document.createElement("b"));
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      mount(
        `<p bind-list></p><p bind-frag></p><p bind-arr></p><p bind-fail></p>`,
        `[bind-list] { content: getList(); }
         [bind-frag] { content: getFragment(); }
         [bind-arr] { data-x: getArray(); }
         [bind-fail] { content: failing(); }`,
        {
          getList: () => wrap.childNodes,
          getFragment: () => fragment,
          getArray: () => ["a", 1],
          failing: () => Promise.reject(new Error("nope")),
        }
      );
      await flush();
      expect(applyFor("[bind-list]").meta.result).toEqual([
        { $element: "i", id: null },
        { $element: "i", id: null },
      ]);
      // whitespace-only text nodes are dropped; others serialise as nodes
      expect(applyFor("[bind-frag]").meta.result).toEqual([
        { $node: "#text" },
        { $element: "b", id: null },
      ]);
      const arr = publications.find((p) => p.meta.key === "data-x")!;
      expect(arr.meta.result).toEqual(["a", 1]);
      const failed = applyFor("[bind-fail]");
      expect(failed.meta.result).toBeUndefined();
      expect(failed.meta.isNoop).toBe(false);
      expect(error).toHaveBeenCalled();
    });

    it("publishes a settled promise that resolves to preserve as a no-op", async () => {
      installHook();
      mount(`<p bind-x>stale</p>`, `[bind-x] { content: later(keep); }`, {
        later: (v: unknown) => Promise.resolve(v),
        keep: SYMBOL_NOOP,
      });
      await flush();
      expect(applyFor("[bind-x]").meta.isNoop).toBe(true);
    });
  });
});
