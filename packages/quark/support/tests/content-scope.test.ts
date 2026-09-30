/**
 * Insertions run rules for the inserted nodes only; existing matches re-run
 * just for child / sibling-position deps, and nodes gone by run time cost nothing.
 */
import type { Quark } from "../../index";
import { DIRECT_SCAN_MAX, planScans } from "../../src/rule";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "@excom/nucleus-test";
import {
  bypassSelectorCache,
  flush,
  mount,
  unregisterAll,
} from "./helpers";

/** `tick(element)` records every element a declaration evaluated on. */
const counter = () => {
  const seen: Element[] = [];
  const tick = vi.fn((el: Element) => {
    seen.push(el);
    return "";
  });
  return { tick, seen, ids: () => seen.map((el) => el.id || el.localName) };
};

/** Counts the rules' fan-out queries from now on. */
const spyQueries = (quark: Quark) => {
  const qsa = vi.spyOn(Element.prototype, "querySelectorAll");
  return () => {
    const selectors = new Set(
      quark.rules.flatMap((r) => [r.matchSelector, r.scopedSelector()])
    );
    return qsa.mock.calls.filter(([s]) => selectors.has(s)).length;
  };
};

const el = (html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.firstElementChild as HTMLElement;
};

describe("insertion scope", () => {
  let restoreSelectorCache: () => void;
  beforeAll(() => {
    restoreSelectorCache = bypassSelectorCache();
  });
  afterAll(() => restoreSelectorCache());
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not re-run existing matches when an unrelated element is inserted", async () => {
    const { tick, seen } = counter();
    const { root, quark } = mount(
      `<p id="a"></p><div id="box"><p id="b"></p></div>`,
      `p { data-n: tick(element); }
       :scope { data-host: tick(element); }`,
      { tick }
    );
    await flush();
    expect(seen).toHaveLength(3);
    const queries = spyQueries(quark);

    root.append(document.createElement("aside"));
    root.querySelector("#box")!.append(document.createElement("span"));
    await flush();
    expect(seen).toHaveLength(3);
    // `p`: the two inserted nodes are queried, never the host
    expect(queries()).toBe(2);
  });

  it("runs the inserted subtree's own matches, nested ones included", async () => {
    const { tick, ids } = counter();
    const { root } = mount(`<p id="old"></p>`, `p { data-n: tick(element); }`, {
      tick,
    });
    await flush();
    root.append(
      el(`<div><p id="x"></p><section><article><p id="y"></p></article></section></div>`)
    );
    root.append(el(`<p id="w"></p>`));
    await flush();
    expect(ids()).toEqual(["old", "x", "y", "w"]);
  });

  it("queries a few inserted nodes directly, never the parent's subtree", async () => {
    const { tick, ids } = counter();
    const { root, quark } = mount(
      `<div id="big">${"<p></p>".repeat(20)}</div>`,
      `p { data-n: tick(element); }`,
      { tick }
    );
    await flush();
    const qsa = vi.spyOn(Element.prototype, "querySelectorAll");
    root.querySelector("#big")!.append(el(`<div id="new"><p id="x"></p></div>`));
    await flush();
    expect(ids().slice(20)).toEqual(["x"]);
    const sel = quark.rules[0].scopedSelector();
    const scanned = qsa.mock.calls.flatMap(([s], i) =>
      s === sel ? [qsa.mock.contexts[i]] : []
    );
    expect(scanned).toEqual([root.querySelector("#new")]);
  });

  it("scans the parent once when many nodes arrive together", async () => {
    const { tick, seen } = counter();
    const { root, quark } = mount(
      `<div id="big"><p></p></div>`,
      `p { data-n: tick(element); }`,
      { tick }
    );
    await flush();
    const qsa = vi.spyOn(Element.prototype, "querySelectorAll");
    const big = root.querySelector("#big")!;
    for (let i = 0; i <= DIRECT_SCAN_MAX; i++) big.append(el(`<p></p>`));
    await flush();
    expect(seen).toHaveLength(2 + DIRECT_SCAN_MAX);
    const sel = quark.rules[0].scopedSelector();
    const scanned = qsa.mock.calls.flatMap(([s], i) =>
      s === sel ? [qsa.mock.contexts[i]] : []
    );
    expect(scanned).toEqual([big]);
  });

  it("merges nested insertions of one batch into one query", async () => {
    const { tick, ids } = counter();
    const { root, quark } = mount(
      `<p id="old"></p>`,
      `p { data-n: tick(element); }`,
      { tick }
    );
    await flush();
    const queries = spyQueries(quark);
    const outer = el(`<div><p id="x"></p></div>`);
    root.append(outer);
    outer.append(el(`<p id="y"></p>`));
    await flush();
    expect(ids()).toEqual(["old", "x", "y"]);
    expect(queries()).toBe(1);
  });

  it("runs nothing for an element inserted and removed in the same tick", async () => {
    const { tick, seen } = counter();
    const { root, quark } = mount(
      `<p id="a"></p><dialog id="d"></dialog>`,
      `p { data-n: tick(element); }
       button { data-proxy: tick(element); }`,
      { tick }
    );
    await flush();
    expect(seen).toHaveLength(1);
    const runs = quark.rules.map((r) => r.numberOfRuns);
    const queries = spyQueries(quark);

    // Neutron's invoker proxy for `show-modal` / `toggle-popover`
    const proxy = document.createElement("button");
    proxy.setAttribute("command", "show-modal");
    proxy.setAttribute("commandfor", "d");
    root.append(proxy);
    proxy.click();
    proxy.remove();
    await flush();

    expect(seen).toHaveLength(1);
    expect(quark.rules.map((r) => r.numberOfRuns)).toEqual(runs);
    expect(queries()).toBe(0);
  });

  it("falls back to the whole subtree for a content entry queued without nodes", async () => {
    const { tick, ids } = counter();
    const { root, quark } = mount(
      `<p id="a"></p><p id="b"></p>`,
      `p { data-n: tick(element); }`,
      { tick }
    );
    await flush();
    root.append(el(`<p id="c"></p>`));
    // same batch: the observer's scoped entry and a direct one (iterate requeue)
    quark.queueRunRules({ element: root, attribute: "content" });
    await flush();
    expect(ids().slice(2).sort()).toEqual(["a", "b", "c"]);

    // direct first, observer second: still the whole subtree
    quark.queueRunRules({ element: root, attribute: "content" });
    quark.queueRunRules({ element: root, attribute: "content", added: [] });
    await flush();
    expect(ids().slice(5).sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps one query when inserted rows are also requeued as NEW_SELF", async () => {
    const { tick, ids } = counter();
    const { root, quark } = mount(
      `<ul><li id="a"></li><li id="b"></li></ul>`,
      `li { data-n: tick(element); }`,
      { tick }
    );
    await flush();
    const ul = root.querySelector("ul")!;
    const queries = spyQueries(quark);
    const rowIds = Array.from({ length: DIRECT_SCAN_MAX + 1 }, (_, i) => `r${i}`);
    const rows = rowIds.map((id) => el(`<li id="${id}"></li>`));
    ul.append(...rows);
    // what iterate()'s `after` hook does for changed rows
    rows.forEach((row) =>
      quark.queueRunRules({ element: row, attribute: "NEW_SELF" })
    );
    await flush();
    expect(ids().slice(2)).toEqual(rowIds);
    expect(queries()).toBe(1);
  });

  it("lets a fan-out below the insertion parent ride along, without its root", async () => {
    const { tick, ids } = counter();
    const { root, quark } = mount(
      `<div id="outer" data-on><div id="d"><div id="inner"></div></div></div>`,
      `div[data-on] div { data-n: tick(element); }`,
      { tick }
    );
    await flush();
    expect(ids()).toEqual(["d", "inner"]);
    const queries = spyQueries(quark);
    // one batch: `d` fans out over its subtree, a new element lands beside
    root.querySelector("#d")!.setAttribute("data-on", "");
    root.append(el(`<div id="new" data-on><div id="n2"></div></div>`));
    await flush();
    expect(ids().slice(2)).toEqual(["inner", "n2"]);
    // `d` (descendants only) and `new` are queried directly, in document order
    expect(queries()).toBe(2);
  });

  it("covers defs written inside an insertion, so the sheet does not re-run for its own write", async () => {
    const { root, quark } = mount(
      ``,
      `article { $t: attr("data-t"); p { content: $t; } }`
    );
    await flush();
    const run = vi.spyOn(quark, "run");
    root.append(el(`<article data-t="hi"><p></p></article>`));
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("hi");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("scopes insertions for global sheets too", async () => {
    const { tick, ids } = counter();
    const { root } = mount(
      `<p id="a"></p>`,
      `section p { data-n: tick(element); }`,
      { tick },
      { isScoped: false }
    );
    await flush();
    root.append(el(`<p id="b"></p>`));
    await flush();
    expect(ids()).toEqual(["a", "b"]);
  });

  describe("selectors that depend on children or position still flip existing matches", () => {
    const cases: Array<[string, string, string, (root: HTMLElement) => void, string]> = [
      [
        ":has()",
        `<ul id="t"></ul>`,
        `ul:has(li) { data-on: ""; }`,
        (root) => root.querySelector("ul")!.append(document.createElement("li")),
        "#t",
      ],
      [
        ":empty",
        `<ul id="t"></ul>`,
        `ul:not(:empty) { data-on: ""; }`,
        (root) => root.querySelector("ul")!.append(document.createElement("li")),
        "#t",
      ],
      [
        ":nth-child()",
        `<ul><li id="t"></li></ul>`,
        `li:nth-child(2) { data-on: ""; }`,
        (root) => root.querySelector("ul")!.prepend(document.createElement("li")),
        "#t",
      ],
      [
        "a + b",
        `<article><p id="t"></p></article>`,
        `h2 + p { data-on: ""; }`,
        (root) =>
          root.querySelector("article")!.prepend(document.createElement("h2")),
        "#t",
      ],
      [
        "a ~ b",
        `<article><p id="t"><span></span></p></article>`,
        `h2 ~ p span { data-on: ""; }`,
        (root) =>
          root.querySelector("article")!.prepend(document.createElement("h2")),
        "#t span",
      ],
      [
        ":scope:has()",
        `<article><p></p></article>`,
        `:scope:has(li) p { data-on: ""; }`,
        (root) =>
          root.querySelector("article")!.append(document.createElement("li")),
        "p",
      ],
    ];
    it.each(cases)("%s", async (_, html, src, insert, target) => {
      const { root } = mount(html, src);
      await flush();
      const t = root.querySelector(target)!;
      expect(t.hasAttribute("data-on")).toBe(false);
      insert(root);
      await flush();
      expect(t.hasAttribute("data-on")).toBe(true);
    });
  });

  it("does not restart an ungated @delay on an unrelated insertion", async () => {
    vi.useFakeTimers();
    const { root } = mount(
      `<aside id="notice"></aside>`,
      `#notice { @delay 3000 { is-open: ""; } }`
    );
    // nested 0ms timers advance the fake clock by 1ms each: leave slack
    const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
    const notice = root.querySelector("#notice")!;
    await tick(2000);
    // a popover opening: proxy button in and out, plus a lasting insertion
    const proxy = document.createElement("button");
    root.append(proxy);
    proxy.remove();
    root.append(document.createElement("div"));
    await tick(50);
    expect(notice.hasAttribute("is-open")).toBe(false);
    // a restart would fire at ~5050
    await tick(1000);
    expect(notice.hasAttribute("is-open")).toBe(true);
  });
});

describe("planScans", () => {
  const tree = () => {
    const root = el(
      `<main><section id="s"><div id="d"><p id="p"></p></div></section><nav id="n"></nav></main>`
    );
    const $ = (id: string) => root.querySelector(`#${id}`) as HTMLElement;
    return { root, $ };
  };

  it("drops an insertion a full root already covers", () => {
    const { $ } = tree();
    expect(planScans([$("s")], new Map([[$("d"), [$("p")]]]))).toEqual([
      { root: $("s"), accept: null },
    ]);
  });

  it("merges nested insertions and full roots below a scanned parent", () => {
    const { root, $ } = tree();
    const [scan, ...rest] = planScans(
      [$("n"), $("d")],
      new Map([
        [root as HTMLElement, [$("s")]],
        [$("s"), [$("d")]],
      ])
    );
    expect(rest).toEqual([]);
    expect(scan.root).toBe(root);
    expect([...scan.accept!]).toEqual([
      [$("s"), true],
      [$("d"), true],
      [$("n"), false],
    ]);
  });

  it("skips a parent whose nodes are all gone", () => {
    const { $ } = tree();
    expect(planScans([$("n")], new Map([[$("s"), []]]))).toEqual([
      { root: $("n"), accept: null },
    ]);
  });
});
