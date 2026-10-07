/**
 * Keyed paints: of a commit's paints of one element and key (an attribute,
 * a `class` string or list, text `content`), only the last writes; the
 * others keep their turn and their bookkeeping, without the write. Other
 * paints (nodes, html, wipes, a class map, `dataset` / `ariaset`, `--x`)
 * write as before, so the final DOM is the same in every order, but for
 * the live state a replaced form-control write never sets. The new
 * behaviour is tested within one pass, where time order and source order
 * agree.
 */
import { Quark } from "../../index";
import { PAINT_QUEUES, schedulePaint } from "../../src/paint";
import { getQuarkInternal } from "../../src/quark-internal";
import {
  createSheet,
  flush,
  installViewTransitionStub,
  mount,
  unregisterAll,
} from "./helpers";
import { LoopGuard } from "@excom/kit-utils";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/nucleus-test";

/** Records every mutation below `node`; the returned function stops and reads them. */
const recordMutations = (node: Node) => {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((list) => records.push(...list));
  observer.observe(node, {
    attributes: true,
    attributeOldValue: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  return () => {
    records.push(...observer.takeRecords());
    observer.disconnect();
    return records;
  };
};

/** `[name, old value]` of each attribute record. */
const attributeChanges = (records: MutationRecord[]) =>
  records
    .filter((r) => r.type === "attributes")
    .map((r) => [r.attributeName, r.oldValue]);

/** Two rules writing one key of `[bind-x]` in one pass. */
const twoWriters = (body: string, first: string, second: string) =>
  createSheet(
    body,
    `[bind-x] { ${first} }
     p[bind-x], ul[bind-x], select [bind-x] { ${second} }`
  );

/** `twoWriters`, registered and settled: the `[bind-x]` element. */
const painted = async (
  body: string,
  first: string,
  second: string,
  items?: unknown
) => {
  const { root, register } = twoWriters(body, first, second);
  if (items) root.quark.setProperty("items", items);
  register();
  await flush();
  return root.querySelector("[bind-x]") as HTMLElement;
};

/**
 * One commit of two sheets on nested hosts: the outer writes `data-x: "a"`,
 * then the inner unpacks `o` and writes `data-x` too. A new `$o` drops the
 * `data-*` the inner sheet set before.
 */
const twoSheets = async (markup: string, o: unknown, second: string) => {
  const root = fixture<HTMLElement>(
    `<section><div id="one"></div><div><div id="two"></div>${markup}</div></section>`
  );
  const inner = root.querySelector("#two")!.parentElement!;
  inner.quark.setProperty("o", o);
  const one = new Quark({
    src: `[bind-x] { data-x: "a"; }`,
    options: { isScoped: true },
  });
  const two = new Quark({
    src: `[bind-x] { dataset: $o; }
          p[bind-x] { data-x: ${second}; }`,
    options: { isScoped: true },
  });
  one.register({ sheetElement: root.querySelector("#one") as HTMLElement });
  two.register({ sheetElement: root.querySelector("#two") as HTMLElement });
  await flush();
  const el = root.querySelector("p")!;
  return {
    el,
    hasSet: () => !!getQuarkInternal(el).getAllAttrs(two.hash)["data-x"],
    setO: async (o: unknown) => {
      inner.quark.setProperty("o", o);
      await flush();
    },
  };
};

describe("keyed paints", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("keyed kinds write once, the last value", () => {
    it("content: one text write", async () => {
      const { root, register } = twoWriters(
        `<p bind-x></p>`,
        `content: "draft";`,
        `content: "final";`
      );
      const el = root.querySelector("[bind-x]")!;
      const stop = recordMutations(el);
      register();
      await flush();
      const records = stop();
      expect(el.textContent).toBe("final");
      expect(records).toHaveLength(1);
      expect(records[0].addedNodes[0].textContent).toBe("final");
    });

    it("content: a prerendered text node already showing the final text is kept", async () => {
      const { root, register } = twoWriters(
        `<p bind-x>final</p>`,
        `content: "draft";`,
        `content: "final";`
      );
      const el = root.querySelector("[bind-x]")!;
      const serverText = el.firstChild;
      const stop = recordMutations(el);
      register();
      await flush();
      expect(stop()).toEqual([]);
      expect(el.childNodes).toHaveLength(1);
      expect(el.firstChild).toBe(serverText);
    });

    it("content: the replaced write's stamp removal is kept", async () => {
      // the replaced "draft" would have replaced the stamped source
      const el = await painted(
        `<p bind-x n-tpl="#source">final</p>`,
        `content: "draft";`,
        `content: "final";`
      );
      expect(el.hasAttribute("n-tpl")).toBe(false);
      expect(el.textContent).toBe("final");
    });

    it("attribute: an element sees only the last value", async () => {
      const changes: Array<[string | null, string | null]> = [];
      customElements.define(
        "keyed-paint-probe",
        class extends HTMLElement {
          static observedAttributes = ["api-url"];
          attributeChangedCallback(
            _: string,
            from: string | null,
            to: string | null
          ) {
            changes.push([from, to]);
          }
        }
      );
      const { register } = createSheet(
        `<keyed-paint-probe></keyed-paint-probe>`,
        `keyed-paint-probe { api-url: "/api/draft"; }
         keyed-paint-probe:not([hidden]) { api-url: "/api/final"; }`
      );
      register();
      await flush();
      expect(changes).toEqual([[null, "/api/final"]]);
    });

    it("class string: one class write", async () => {
      const { root, register } = twoWriters(
        `<p bind-x></p>`,
        `class: "draft";`,
        `class: "card wide";`
      );
      const el = root.querySelector("[bind-x]")!;
      const stop = recordMutations(el);
      register();
      await flush();
      expect(attributeChanges(stop())).toEqual([["class", null]]);
      expect(el.getAttribute("class")).toBe("card wide");
    });

    it("a replaced write still counts as its sheet's: a later pass skips it as before", async () => {
      // the later rule writes what is there: only the replaced paint differs
      const { root, register } = twoWriters(
        `<p bind-x data-v="final"></p>`,
        `data-v: $draft; data-echo: attr("data-z");`,
        `data-v: "final";`
      );
      root.quark.setProperty("draft", "draft");
      register();
      await flush();
      const el = root.querySelector("[bind-x]")!;
      expect(el.getAttribute("data-v")).toBe("final");
      // a pass for `data-z` re-runs what reads it, not the applied `$draft` read
      el.setAttribute("data-z", "1");
      await flush();
      expect(el.getAttribute("data-echo")).toBe("1");
      expect(el.getAttribute("data-v")).toBe("final");
    });

    it("a form control's live property is not set by a replaced write", async () => {
      // the one difference from writing both: the replaced `selected` never
      // selects, so the option selected before stays (written in turn: 0)
      const el = await painted(
        `<select><option bind-x>first</option><option selected>second</option></select>`,
        `selected: true;`,
        `selected: none;`
      );
      const select = el.parentElement as HTMLSelectElement;
      expect(el.hasAttribute("selected")).toBe(false);
      expect(select.selectedIndex).toBe(1);
    });
  });

  describe("other content writes as before, in any order", () => {
    const host = `<ul bind-x><template><li>row</li></template>old</ul>`;

    it.each([
      ["text, then a wipe", `content: "x";`, `content: none;`, ""],
      [
        "text, then template()",
        `content: "t";`,
        `content: template();`,
        "t<li>row</li>",
      ],
      [
        "iterate(), then text",
        `content: iterate($items, none, "id");`,
        `content: "done";`,
        "done<li>row</li>",
      ],
      ["a wipe, then text", `content: none;`, `content: "t";`, "t"],
      ["template(), then text", `content: template();`, `content: "t";`, "t"],
      [
        "text, then iterate()",
        `content: "t";`,
        `content: iterate($items, none, "id");`,
        "t",
      ],
      [
        "text, then dangerous-html()",
        `content: "t";`,
        `content: dangerous-html("<b>h</b>");`,
        "<b>h</b>",
      ],
      [
        "dangerous-html(), then text",
        `content: dangerous-html("<b>h</b>");`,
        `content: "t";`,
        "t",
      ],
    ])("%s", async (_, first, second, html) => {
      const el = await painted(host, first, second, [{ id: "1" }]);
      expect(el.innerHTML).toBe(html);
    });

    it.each([
      ["iterate()", `content: iterate($items, none, "id");`, "y"],
      ["a wipe", `content: none;`, "y"],
      ["dangerous-html()", `content: dangerous-html("<b>h</b>");`, "y"],
    ])("text, %s, text", async (_, between, html) => {
      const { root, register } = createSheet(
        host,
        `[bind-x] { content: "x"; }
         ul[bind-x] { ${between} }
         [bind-x]:not([hidden]) { content: "y"; }`
      );
      root.quark.setProperty("items", [{ id: "1" }]);
      register();
      await flush();
      expect(root.querySelector("[bind-x]")!.innerHTML).toBe(html);
    });

    it("an empty iterate(), then the empty state's text", async () => {
      const el = await painted(
        `<ul bind-x data-is-empty><template><li></li></template></ul>`,
        `content: iterate($items, none, "id");`,
        `content: "Nothing to do";`,
        []
      );
      expect(el.innerHTML).toBe("Nothing to do");
    });

    it("two iterate() rows stay current", async () => {
      const { root, register } = createSheet(
        `<ul bind-list filtered><template><li></li></template></ul>`,
        `[bind-list] { content: iterate($items, none, "id"); }
         [bind-list][filtered] { content: iterate($items, none, "id"); }
         li { content: item.label; }`
      );
      const labels = () =>
        [...root.querySelectorAll("li")].map((li) => li.textContent);
      root.quark.setProperty("items", [
        { id: "1", label: "one" },
        { id: "2", label: "two" },
      ]);
      register();
      await flush();
      expect(labels()).toEqual(["one", "two"]);
      // the first rule's iterate() marks row 1 changed; the second finds it current
      root.quark.setProperty("items", [
        { id: "1", label: "one!" },
        { id: "2", label: "two" },
      ]);
      await flush();
      expect(labels()).toEqual(["one!", "two"]);
    });
  });

  describe("merging kinds apply every declaration, as before", () => {
    it("class map: both toggles", async () => {
      const el = await painted(
        `<p bind-x></p>`,
        `class: (draft: true);`,
        `class: (final: true);`
      );
      expect([...el.classList].sort()).toEqual(["draft", "final"]);
    });

    it.each(["dataset", "ariaset"])("%s: the last value", async (kind) => {
      const { root, register } = twoWriters(
        `<p bind-x></p>`,
        `${kind}: $first;`,
        `${kind}: $second;`
      );
      root.quark.setProperty("first", { label: "draft" });
      root.quark.setProperty("second", { label: "final" });
      register();
      await flush();
      const name = kind === "dataset" ? "data-label" : "aria-label";
      expect(root.querySelector("[bind-x]")!.getAttribute(name)).toBe("final");
    });

    it("custom property: the last value", async () => {
      const el = await painted(
        `<p bind-x></p>`,
        `--tone: "red";`,
        `--tone: "blue";`
      );
      expect(el.style.getPropertyValue("--tone")).toBe("blue");
    });

    it("@on: both listeners", async () => {
      const el = await painted(
        `<p bind-x></p>`,
        `@on click { data-first: ""; }`,
        `@on click { data-second: ""; }`
      );
      el.click();
      await flush();
      expect(el.hasAttribute("data-first")).toBe(true);
      expect(el.hasAttribute("data-second")).toBe(true);
    });

    it("$variable: the later write is read", async () => {
      const { root, register } = createSheet(
        `<p bind-x><span></span></p>`,
        `[bind-x] { $tone: "draft"; }
         p[bind-x] { $tone: "final"; }
         [bind-x] span { content: $tone; }`
      );
      register();
      await flush();
      expect(root.querySelector("span")!.textContent).toBe("final");
    });
  });

  describe("@view-transition", () => {
    let stub: ReturnType<typeof installViewTransitionStub> | undefined;

    afterEach(async () => {
      if (stub) {
        await Promise.all(stub.calls.map((call) => call.finished));
        stub.restore();
        stub = undefined;
      }
    });

    /** Mount, let the first render pass, then change `data-n` once. */
    const change = async (sheet: string) => {
      stub = installViewTransitionStub();
      const { root } = mount(`<p id="out" data-n="1"></p>`, sheet);
      await flush();
      await Quark.whenSettled();
      const out = root.querySelector("#out")!;
      out.setAttribute("data-n", "2");
      await flush();
      await Quark.whenSettled();
      return out;
    };

    it("the paint carries the last write's types", async () => {
      const out = await change(
        `#out { @view-transition (types: "draft") { data-copy: attr("data-n"); } }
         #out { @view-transition (types: "final") { data-copy: attr("data-n") + "!"; } }`
      );
      expect(out.getAttribute("data-copy")).toBe("2!");
      expect(stub!.calls).toHaveLength(1);
      expect([...stub!.calls[0].types]).toEqual(["final"]);
    });

    it("a last write outside any block commits plainly", async () => {
      const out = await change(
        `#out { @view-transition (types: "draft") { data-copy: attr("data-n"); } }
         #out { data-copy: attr("data-n") + "!"; }`
      );
      expect(out.getAttribute("data-copy")).toBe("2!");
      expect(stub!.calls).toHaveLength(0);
    });
  });

  describe("committed", () => {
    afterEach(() => LoopGuard.reset());

    const committed = (el: Element, name: string) =>
      getQuarkInternal(el).cascade?.get(name)?.committed;

    it("is what the guarded write wrote", () => {
      const el = document.createElement("p");
      const internal = getQuarkInternal(el);
      internal.setAttr("sheet", "data-x", "a");
      expect(committed(el, "data-x")).toBe("a");
      internal.setAttr("sheet", "data-x", 2);
      expect(committed(el, "data-x")).toBe("2");
      internal.setAttr("sheet", "data-x", true);
      expect(committed(el, "data-x")).toBe("");
      internal.setAttr("sheet", "data-x", null);
      expect(committed(el, "data-x")).toBeNull();
    });

    it("is not recorded when nothing was written", () => {
      const el = document.createElement("p");
      el.setAttribute("data-same", "a");
      el.setAttribute("data-zero", "0");
      const internal = getQuarkInternal(el);
      internal.setAttr("sheet", "data-same", "a");
      internal.setAttr("sheet", "data-zero", 0);
      internal.setAttr("sheet", "data-gone", null);
      internal.setAttr("sheet", "data-kept", undefined);
      internal.setAttr("sheet", "data-replaced", "a", true);
      LoopGuard.configure({ log: () => {} });
      LoopGuard.run(LoopGuard.limit, () =>
        internal.setAttr("sheet", "data-dropped", "a")
      );
      const names = ["same", "zero", "gone", "kept", "replaced", "dropped"];
      expect(names.map((name) => committed(el, `data-${name}`))).toEqual(
        names.map(() => undefined)
      );
      expect(el.hasAttribute("data-replaced")).toBe(false);
      expect(el.hasAttribute("data-dropped")).toBe(false);
    });

    it("holds the last of two rules' values", async () => {
      const el = await painted(
        `<p bind-x></p>`,
        `data-x: "draft";`,
        `data-x: "final";`
      );
      expect(committed(el, "data-x")).toBe("final");
    });
  });

  describe("a replaced paint's bookkeeping", () => {
    afterEach(() => LoopGuard.reset());

    /** One commit: `writes` in queue order, all but the last replaced. */
    const commit = (
      el: Element,
      writes: Array<[sheet: string, value: string]>
    ) => {
      const internal = getQuarkInternal(el);
      writes.forEach(([sheet, value], index) =>
        internal.setAttr(sheet, "data-x", value, index < writes.length - 1)
      );
      return (sheet: string) => !!internal.getAllAttrs(sheet)["data-x"];
    };

    it("a dataset between two sheets' writes counts in turn", async () => {
      // in turn: "a" over "d", the dataset's "d" over "a", then "a" again
      const { el, hasSet, setO } = await twoSheets(
        `<p bind-x data-x="d"></p>`,
        { x: "d" },
        `"a"`
      );
      expect(el.getAttribute("data-x")).toBe("a");
      expect(hasSet()).toBe(true);
      await setO({ z: "1" });
      expect(el.hasAttribute("data-x")).toBe(false);
      expect(el.getAttribute("data-z")).toBe("1");
    });

    it("the later sheet counts against what the replaced paint would have left", async () => {
      // in turn: "a" over "b", then "b" over "a": the inner sheet set it
      const { el, hasSet, setO } = await twoSheets(
        `<p bind-x data-x="b"></p>`,
        {},
        `"b"`
      );
      expect(el.getAttribute("data-x")).toBe("b");
      expect(hasSet()).toBe(true);
      await setO({ z: "1" });
      expect(el.hasAttribute("data-x")).toBe(false);
    });

    it("counts each sheet as if every paint had written in turn", () => {
      // as written in turn: "a" changes "b", then "b" changes "a"
      const el = document.createElement("p");
      el.setAttribute("data-x", "b");
      const stop = recordMutations(el);
      const hasSet = commit(el, [
        ["one", "a"],
        ["two", "b"],
      ]);
      expect(stop()).toEqual([]);
      expect([hasSet("one"), hasSet("two")]).toEqual([true, true]);
    });

    it("does not count a write that would have changed nothing", () => {
      // as written in turn: the second "b" finds "b" there
      const el = document.createElement("p");
      el.setAttribute("data-x", "c");
      const hasSet = commit(el, [
        ["one", "b"],
        ["two", "b"],
      ]);
      expect(el.getAttribute("data-x")).toBe("b");
      expect([hasSet("one"), hasSet("two")]).toEqual([true, false]);
    });

    it("does not count a write the loop guard would have dropped", () => {
      const el = document.createElement("p");
      const internal = getQuarkInternal(el);
      LoopGuard.configure({ log: () => {} });
      LoopGuard.run(LoopGuard.limit, () =>
        internal.setAttr("one", "data-x", "a", true)
      );
      internal.setAttr("two", "data-x", "b");
      expect(internal.getAllAttrs("one")["data-x"]).toBeUndefined();
      expect(internal.getAllAttrs("two")["data-x"]).toBe(true);
    });
  });

  describe("queue", () => {
    it("writes the last paint of a key; an earlier one keeps its turn without the write", async () => {
      const key = {};
      const order: string[] = [];
      const paint = (name: string) => (isReplaced?: boolean) =>
        order.push(isReplaced ? `${name} replaced` : name);
      schedulePaint(paint("draft"), 1, undefined, key);
      schedulePaint(paint("other"));
      schedulePaint(paint("final"), 1, undefined, key);
      await wait(0);
      expect(order).toEqual(["draft replaced", "other", "final"]);
      expect(PAINT_QUEUES.every((queue) => queue.size === 0)).toBe(true);
    });

    it("still writes a paint that one of the next commit replaced", async () => {
      const key = {};
      const order: string[] = [];
      schedulePaint(() => {
        order.push("reaction");
        schedulePaint(() => order.push("final"), 1, undefined, key);
      });
      schedulePaint(
        (isReplaced) => order.push(isReplaced ? "draft replaced" : "draft"),
        1,
        undefined,
        key
      );
      await wait(0);
      expect(order).toEqual(["reaction", "draft"]);
      await wait(0);
      expect(order).toEqual(["reaction", "draft", "final"]);
    });
  });
});
