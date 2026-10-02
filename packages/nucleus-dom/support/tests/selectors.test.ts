import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "@excom/heft-rig/node_modules/vitest";
import { createDom, installShims, supportSelectors } from "../../index";

// recorded in headless Chrome 154: cases<n>.json run against index<n>.html
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures/selectors");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
type Answers = {
  all: [selector: string, answer: unknown][];
  scoped: [root: string, selector: string, answer: unknown][];
  matches: [element: string, selector: string, answer: unknown][];
  closest: [element: string, selector: string, answer: unknown][];
};
const SETS = ["", "2"].map((n) => ({
  name: `index${n}.html`,
  html: read(`index${n}.html`),
  cases: JSON.parse(read(`cases${n}.json`)),
  chrome: JSON.parse(read(`chrome${n}.json`)) as Answers,
}));

// recorded the same way: each case runs on a fresh container appended to <body>
const CHROME_DYNAMIC = (JSON.parse(read("chrome-dynamic.json")) as { answers: [name: string, answer: unknown][] }).answers;
const DYNAMIC = (JSON.parse(read("dynamic.json")) as { name: string; html: string; code: string }[]).map(
  ({ name, html, code }, i): [name: string, html: string, code: string, answer: unknown] => [name, html, code, CHROME_DYNAMIC[i][1]],
);

/**
 * Where the shim still answers differently from Chrome, and why:
 * [fixture, call, Chrome's answer, the shim's]. The parity tests expect
 * exactly these to differ, so an improvement or a regression shows.
 */
const DIFFERENCES: [fixture: string, call: string, chrome: unknown, shim: unknown, why: string][] = [];

type Setup = () => { document: Document; dispose: () => Promise<void> };

const SETUPS: Record<string, Setup> = {
  "createDom()": () => createDom(),
  "installShims(globalThis)": () => {
    installShims(globalThis);
    return { document, dispose: async () => document.body.replaceChildren() };
  },
};

const ids = (list: ArrayLike<Element>) => [...list].map((el) => el.id || `<${el.localName}>`);
const attempt = (run: () => unknown) => {
  try {
    return run();
  } catch (error) {
    return `THROW ${(error as Error).name}`;
  }
};

/** The fixture's whole document in `doc`; its script's element defined here. */
const load = (doc: Document, html: string) => {
  const view = doc.defaultView!;
  if (!view.customElements.get("defined-thing")) view.customElements.define("defined-thing", class extends view.HTMLElement {});
  const source = new DOMParser().parseFromString(html, "text/html").documentElement;
  for (const { name, value } of [...source.attributes]) doc.documentElement.setAttribute(name, value);
  doc.documentElement.innerHTML = source.innerHTML;
};

describe.each(Object.keys(SETUPS))("selectors as Chrome answers them, on %s", (setup) => {
  describe.each(SETS)("$name", ({ name, html, cases, chrome }) => {
    let dom: ReturnType<Setup>;
    const $ = (selector: string) => dom.document.querySelector(selector)!;
    const calls: [call: string, answer: unknown, run: () => unknown][] = [
      ...chrome.all.map(([selector, answer]) => [
        `document.querySelectorAll(${JSON.stringify(selector)})`,
        answer,
        () => ids(dom.document.querySelectorAll(selector)),
      ]),
      ...chrome.scoped.map(([root, selector, answer]) => [
        `${root}.querySelectorAll(${JSON.stringify(selector)})`,
        answer,
        () => ids($(root).querySelectorAll(selector)),
      ]),
      ...chrome.matches.map(([element, selector, answer]) => [
        `${element}.matches(${JSON.stringify(selector)})`,
        answer,
        () => $(element).matches(selector),
      ]),
      ...chrome.closest.map(([element, selector, answer]) => [
        `${element}.closest(${JSON.stringify(selector)})`,
        answer,
        () => $(element).closest(selector)?.id ?? null,
      ]),
    ] as [string, unknown, () => unknown][];
    const known = (call: string) => DIFFERENCES.find(([fixture, other]) => fixture === name && other === call);

    beforeAll(() => {
      dom = SETUPS[setup]();
      load(dom.document, html);
    });
    afterAll(async () => {
      for (const { name: attribute } of [...dom.document.documentElement.attributes]) {
        dom.document.documentElement.removeAttribute(attribute);
      }
      dom.document.documentElement.innerHTML = "<head></head><body></body>";
      await dom.dispose();
    });

    it("records every case, and lists only real differences", () => {
      expect({
        all: chrome.all.map(([selector]) => selector),
        scoped: chrome.scoped.map(([root, selector]) => [root, selector]),
        matches: chrome.matches.map(([element, selector]) => [element, selector]),
        closest: chrome.closest.map(([element, selector]) => [element, selector]),
      }).toEqual(cases);
      for (const [fixture, call, answer, shim] of DIFFERENCES.filter(([fixture]) => fixture === name)) {
        expect([fixture, call, calls.find(([other]) => other === call)?.[1]]).toEqual([fixture, call, answer]);
        expect(shim).not.toEqual(answer);
      }
    });

    it.each(calls)("%s", (call, answer, run) => {
      const difference = known(call);
      expect(attempt(run)).toEqual(difference ? difference[3] : answer);
    });
  });
});

describe.each(Object.keys(SETUPS))("selectors as Chrome answers them over time, on %s", (setup) => {
  let dom: ReturnType<Setup>;
  const known = (call: string) => DIFFERENCES.find(([fixture, other]) => fixture === "dynamic.json" && other === call);

  beforeAll(() => {
    dom = SETUPS[setup]();
  });
  afterAll(() => dom.dispose());

  it("records every case, and lists only real differences", () => {
    expect(CHROME_DYNAMIC.map(([name]) => name)).toEqual(DYNAMIC.map(([name]) => name));
    for (const [, call, answer, shim] of DIFFERENCES.filter(([fixture]) => fixture === "dynamic.json")) {
      expect(DYNAMIC.find(([name]) => name === call)?.[3]).toEqual(answer);
      expect(shim).not.toEqual(answer);
    }
  });

  // as recorded, `new Function("root", code)`, with the setup's window for Chrome's globals
  it.each(DYNAMIC)("%s", (name, html, code, answer) => {
    const view = dom.document.defaultView!;
    const root = dom.document.createElement("div");
    root.innerHTML = html;
    dom.document.body.append(root);
    const run = new Function("root", "document", "DOMException", "NodeList", "SyntaxError", code);
    const difference = known(name);
    try {
      expect(attempt(() => run(root, dom.document, view.DOMException, view.NodeList, view.SyntaxError))).toEqual(
        difference ? difference[3] : answer,
      );
    } finally {
      root.remove();
    }
  });
});

const SHELL = `<main>
  <header id="top"></header>
  <nav id="side" title="a, b"></nav>
  <gesture-handler id="gesture"><content-drawer id="drawer" is-open></content-drawer></gesture-handler>
  <footer id="end"></footer>
</main>`;

describe.each(Object.keys(SETUPS))("selectors on %s", (setup) => {
  let dom: ReturnType<Setup>;
  // not getElementById: happy-dom's keeps an element `define()` replaced
  const $ = (id: string) => dom.document.querySelector<HTMLElement>(`#${id}`)!;

  beforeEach(() => {
    dom = SETUPS[setup]();
    dom.document.body.innerHTML = SHELL;
  });
  afterEach(() => dom.dispose());

  it("matches an element with a later sibling, through a complex argument", () => {
    const shell = ":not(link, quark-sheet):has(~ gesture-handler > content-drawer[is-open])";
    expect(["top", "side", "gesture", "end"].filter((id) => $(id).matches(":has(~ footer)"))).toEqual(["top", "side", "gesture"]);
    expect(ids(dom.document.querySelectorAll(shell))).toEqual(["top", "side"]);
    $("drawer").removeAttribute("is-open");
    expect(dom.document.querySelectorAll(shell)).toHaveLength(0);
    expect($("top").matches("header:has(~ nav, ~ aside)")).toBe(true);
    expect($("top").matches("header:has(~ nav ~ gesture-handler, > i)")).toBe(true);
    expect($("top").matches("header:has(~ nav + footer)")).toBe(false);
  });

  it("negates, chains and splits selector lists", () => {
    const main = dom.document.querySelector("main")!;
    expect(ids(main.querySelectorAll(":not(:has(~ footer))"))).toEqual(["drawer", "end"]);
    expect(ids(main.querySelectorAll("footer, header:has(~ nav)"))).toEqual(["top", "end"]);
    expect(ids(main.querySelectorAll("footer, nav:has(~ footer), header:has(~ footer), main"))).toEqual(["top", "side", "end"]);
    expect($("top").matches(":is(header):has(~ nav):has(~ footer)")).toBe(true);
    expect($("top").matches("header:has(~ nav):has(~ aside)")).toBe(false);
    expect(ids(dom.document.querySelectorAll("main > :has(~ footer)"))).toEqual(["top", "side", "gesture"]);
    expect(ids(dom.document.querySelectorAll("main :not(:has(~ *))"))).toEqual(["drawer", "end"]);
    // happy-dom reads the first leading combinator for the whole list
    expect(ids(dom.document.querySelectorAll("body:has(> header, footer)"))).toEqual(["<body>"]);
    expect(ids(dom.document.querySelectorAll(":has(~ footer) > content-drawer, :is(:has(~ footer))"))).toEqual([
      "top",
      "side",
      "gesture",
      "drawer",
    ]);
  });

  it("orders and keeps every match of sibling combinators", () => {
    dom.document.body.innerHTML = `<ul><li id="a"><ul><li id="b"></li><li id="c"></li></ul></li><li id="d"></li><li id="e"></li></ul>`;
    expect(ids(dom.document.querySelectorAll("#a ~ li"))).toEqual(["d", "e"]);
    expect(ids(dom.document.querySelectorAll("li + li"))).toEqual(["c", "d", "e"]);
    expect(dom.document.querySelector("li ~ li")!.id).toBe("c");
  });

  it("reads escapes and strings as part of a selector", () => {
    dom.document.body.innerHTML = `<b id="a:b" title="(x, y"></b><i id="1" lang="en-GB" data-x="a:b, c"></i>`;
    expect(ids(dom.document.querySelectorAll("#a\\:b:has(~ i)"))).toEqual(["a:b"]);
    expect(ids(dom.document.querySelectorAll('[title="(x, y"]:has(~ i), i'))).toEqual(["a:b", "1"]);
    expect(ids(dom.document.querySelectorAll(":is(#a\\:b , i)"))).toEqual(["a:b", "1"]);
    expect(ids(dom.document.querySelectorAll(':not([title="(x, y"], [data-x="a:b, c"]):is(i, b)'))).toEqual([]);
    expect(ids(dom.document.querySelectorAll(':is([lang|="en"], [title^="(" i])'))).toEqual(["a:b", "1"]);
  });

  it("matches attribute values case-insensitively with the i flag", () => {
    dom.document.body.innerHTML = `<p id="p" lang="EN-us" title="Hello World" data-x="a:B"></p>`;
    for (const selector of [
      '[lang|="en" i]',
      '[title~="WORLD" i]',
      '[title^="hello" I]',
      "[title$='WORLD'i]",
      '[title*="O w" i]',
      "[data-x=A\\:b i]",
      '[data\\-x="A:B" i]',
      '[title="hello\\20world" i]',
    ]) {
      expect([selector, $("p").matches(selector)]).toEqual([selector, true]);
    }
    for (const selector of ['[lang|="e" i]', '[title~="" i]', '[title^="" i]', '[title~="hello world" i]', '[title="\\0" i]', '[missing="x" i]']) {
      expect([selector, $("p").matches(selector)]).toEqual([selector, false]);
    }
  });

  it("matches form states as browsers do", () => {
    dom.document.body.innerHTML = `<form>
      <fieldset id="outer" disabled><legend><input id="first-legend"></legend><legend><input id="second-legend"></legend>
        <fieldset id="inner"><button id="deep"></button></fieldset></fieldset>
      <select id="pick" required><optgroup id="group" disabled><option id="grouped">a</option></optgroup><optgroup id="open"><option id="b" selected>b</option></optgroup></select>
      <input id="text" checked><input id="box" type="checkbox"><input id="hidden" type="hidden" required><textarea id="area"></textarea>
    </form>`;
    const foreign = dom.document.createElementNS("http://www.w3.org/2000/svg", "input");
    foreign.setAttribute("disabled", "");
    dom.document.querySelector("form")!.append(foreign);
    expect(ids(dom.document.querySelectorAll(":disabled"))).toEqual(["outer", "second-legend", "inner", "deep", "group", "grouped"]);
    expect(ids(dom.document.querySelectorAll(":enabled"))).toEqual(["first-legend", "pick", "open", "b", "text", "box", "hidden", "area"]);
    expect(ids(dom.document.querySelectorAll(":checked"))).toEqual(["b"]);
    expect(ids(dom.document.querySelectorAll(":required"))).toEqual(["pick"]);
    // as in Chrome: every control that is not required, `required` applying or not
    expect(ids(dom.document.querySelectorAll(":optional"))).toEqual(["first-legend", "second-legend", "text", "box", "hidden", "area"]);
  });

  it("matches focus and modal dialogs as browsers do", () => {
    dom.document.body.innerHTML = `<main id="m"><form id="f"><input id="in"></form><dialog id="dg"></dialog></main>`;
    const all = (selector: string) => ids(dom.document.querySelectorAll(selector));
    // nothing focused: no :focus, though activeElement is body
    expect([all(":focus"), all(":focus-within")]).toEqual([[], []]);
    $("in").focus();
    expect([all(":focus"), all(":focus-within")]).toEqual([["in"], ["<html>", "<body>", "m", "f", "in"]]);
    $("in").blur();
    expect(all(":focus")).toEqual([]);
    $("in").focus();
    $("f").remove();
    expect([all(":focus"), all(":focus-within")]).toEqual([[], []]);
    const dialog = $("dg") as HTMLDialogElement;
    dialog.showModal();
    expect([all("dialog:modal"), all("dialog:open")]).toEqual([["dg"], ["dg"]]);
    dialog.close();
    expect([all("dialog:modal"), all("dialog:open")]).toEqual([[], []]);
    dialog.show();
    dialog.show();
    // open, the other way: an error; modal until close(), whatever `open` does
    expect(() => dialog.showModal()).toThrow(expect.objectContaining({ name: "InvalidStateError" }));
    dialog.close();
    dialog.showModal();
    dialog.showModal();
    expect(() => dialog.show()).toThrow(expect.objectContaining({ name: "InvalidStateError" }));
    dialog.removeAttribute("open");
    expect([all("dialog:modal"), all("dialog:open")]).toEqual([["dg"], []]);
    dialog.close();
    dialog.remove();
    expect(() => dialog.showModal()).toThrow(expect.objectContaining({ name: "InvalidStateError" }));
  });

  it("matches :host, escaped names and rare forms as browsers do", () => {
    dom.document.body.innerHTML = `<div id="host" class="x"></div><p id="p">t</p><svg><rect id="rect"></rect></svg><i id="q" title="a'b&quot;c"></i><p id="d" dir="auto"><b>שלום</b></p>`;
    const shadow = $("host").attachShadow({ mode: "open" });
    shadow.innerHTML = `<p><b id="in"></b></p>`;
    const inner = shadow.querySelector("#in")!;
    // :host matches the host from inside its tree only, and nothing beyond it
    expect([inner.matches(":host(.x) b"), inner.matches(":host(.y) b"), inner.matches(":host(div) > p > b"), inner.matches("div :host b")]).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect([
      ids(dom.document.querySelectorAll("\\70 ")),
      ids(dom.document.querySelectorAll("svg > \\72 ect")),
      ids(dom.document.querySelectorAll(`[title="a'b\\"c"]`)),
    ]).toEqual([["p", "d"], ["rect"], ["q"]]);
    // a legacy pseudo-element matches nothing; dir="auto" reads a child's text
    expect([$("p").matches("p:before"), $("d").matches(":dir(rtl)")]).toEqual([false, true]);
  });

  it("matches direction, language and form defaults as browsers do", () => {
    dom.document.body.innerHTML = `<div dir="rtl"><p id="r">x</p><bdi id="bi">עברית</bdi><p id="au" dir="auto">abc</p><p id="nm" dir="auto">12</p></div><div dir="up"><p id="lt">y</p></div>
      <p id="de" lang="de-Latn-CH">z</p><p id="dx" lang="de-x-ch">w</p>
      <form id="g"><button id="go">go</button><input id="later" type="submit"><select><option id="pre" selected>a</option><option>b</option></select><input id="r1" type="radio" name="loose"><progress id="pg"></progress><progress id="pv" value="1"></progress><input id="rg" type="range"><input id="mn" type="number" min="1" value="5"><input id="mx" type="number" max="3" value="4"></form>
      <input id="free" type="radio"><input id="r2" type="radio" name="alone"><button id="lone">x</button>
      <div contenteditable><p id="ce">e</p><p id="cf" contenteditable="false">f</p></div>`;
    const all = (selector: string) => ids(dom.document.querySelectorAll(selector));
    expect([all(":dir(rtl)"), all("p:dir(ltr)")]).toEqual([["<div>", "r", "bi"], ["au", "nm", "lt", "de", "dx", "ce", "cf"]]);
    // RFC 4647 extended filtering: subtags may be skipped, never a singleton
    expect([all(":lang(de-CH)"), all(':lang("*-ch")'), all(":lang(de)"), all(":lang(en)")]).toEqual([["de"], ["de"], ["de", "dx"], []]);
    expect([all(":default"), all(":indeterminate")]).toEqual([["go", "pre"], ["r1", "pg", "free", "r2"]]);
    expect([all(":in-range"), all(":out-of-range")]).toEqual([["rg", "mn"], ["mx"]]);
    expect([$("ce").matches(":read-write"), $("cf").matches(":read-only"), all("#g > :nth-child(even)")]).toEqual([
      true,
      true,
      ["later", "r1", "pv", "mn"],
    ]);
  });

  // [what changes, markup, selector, change, #x matches before, after]
  it.each<[string, string, string, (doc: Document) => void, boolean, boolean]>([
    [":first-child, after an insert before it", `<ul><li id="x"></li></ul>`, "li:first-child", (doc) => $("x").before(doc.createElement("li")), true, false],
    [":last-child, after a removal after it", `<ul><li id="x"></li><li id="y"></li></ul>`, "li:last-child", () => $("y").remove(), false, true],
    [":only-child, after a sibling moves in", `<ul><li id="x"></li></ul><ol><li id="y"></li></ol>`, "li:only-child", () => $("x").after($("y")), true, false],
    [":nth-child(), after a sibling moves out", `<ul><li id="y"></li><li id="x"></li></ul><ol></ol>`, "li:nth-child(2)", (doc) => doc.querySelector("ol")!.append($("y")), true, false],
    [":empty, after text is added", `<p id="x"></p>`, "p:empty", () => $("x").append("text"), true, false],
    [":empty, after its text is removed", `<p id="x">text</p>`, "p:empty", () => $("x").firstChild!.remove(), false, true],
    [":empty, after its text empties", `<p id="x">text</p>`, "p:empty", () => (($("x").firstChild as Text).data = ""), false, true],
    ["+, after an insert between", `<i></i><b id="x"></b>`, "i + b", (doc) => $("x").before(doc.createElement("u")), true, false],
    ["~, after the earlier sibling is removed", `<i id="y"></i><u></u><b id="x"></b>`, "i ~ b", () => $("y").remove(), true, false],
    [":has(), after a child is added", `<div id="x"></div>`, "div:has(> b)", (doc) => $("x").append(doc.createElement("b")), false, true],
    [":has(), after a descendant changes", `<div id="x"><p><b></b></p></div>`, "div:has(b.on)", (doc) => doc.querySelector("b")!.classList.add("on"), false, true],
    [":has(+), after the next sibling moves away", `<div id="x"></div><b id="y"></b><section></section>`, "div:has(+ b)", (doc) => doc.querySelector("section")!.append($("y")), true, false],
    [":checked, after the property is set", `<input id="x" type="checkbox">`, ":checked", () => (($("x") as HTMLInputElement).checked = true), false, true],
    [":defined, after the definition", `<x-later id="x"></x-later>`, "x-later:defined", (doc) => doc.defaultView!.customElements.define("x-later", class extends doc.defaultView!.HTMLElement {}), false, true],
    [".on p, after the class two levels up goes", `<section id="y" class="on"><div><p id="x"></p></div></section>`, ".on p", () => $("y").classList.remove("on"), true, false],
    [
      ":not() two levels up, after the attribute goes",
      `<content-drawer id="y" is-open><div><dismiss-watcher id="x"></dismiss-watcher></div></content-drawer>`,
      "content-drawer:not([is-open]) dismiss-watcher",
      () => $("y").removeAttribute("is-open"),
      false,
      true,
    ],
    ["an ancestor compound, after a move to another subtree", `<div class="a"><i><b id="x"></b></i></div><div class="c"><i id="y"></i></div>`, ".c b", () => $("y").append($("x")), false, true],
    // left to happy-dom: a lone compound, and a document's query of these
    ["a class, after it changes", `<p id="x"></p>`, "p.on", () => $("x").classList.add("on"), false, true],
    ["an ancestor compound, after a move", `<section><p id="x"></p></section><div id="y"></div>`, "section p", () => $("y").append($("x")), true, false],
    ["a parent compound, after the parent changes", `<div id="y"><p id="x"></p></div>`, ".on > p", () => $("y").classList.add("on"), false, true],
  ])("answers afresh: %s", (_, markup, selector, change, before, after) => {
    dom.document.body.innerHTML = markup;
    const answers = () => {
      const x = $("x");
      return [
        x.matches(selector),
        x.closest(selector) === x,
        [...dom.document.querySelectorAll(selector)].includes(x),
        [...dom.document.body.querySelectorAll(selector)].includes(x),
      ];
    };
    expect(answers()).toEqual([before, before, before, before]);
    change(dom.document);
    expect(answers()).toEqual([after, after, after, after]);
  });

  it("finds the first match, the closest ancestor and nothing when none matches", () => {
    expect(dom.document.querySelector(":has(~ #side)")!.id).toBe("top");
    expect(dom.document.querySelector("aside:has(~ footer)")).toBeNull();
    expect($("drawer").closest(":has(~ footer)")!.id).toBe("gesture");
    expect($("drawer").closest("section:has(~ footer)")).toBeNull();
    expect($("drawer").closest("main")!.localName).toBe("main");
  });

  it("queries fragments and shadow roots, and never matches a parentless element", () => {
    const fragment = dom.document.createDocumentFragment();
    fragment.append(dom.document.createElement("b"), dom.document.createElement("i"));
    expect(ids(fragment.querySelectorAll("b:has(~ i)"))).toEqual(["<b>"]);
    expect(fragment.querySelector(":scope > i")).toBeNull();
    const shadow = $("side").attachShadow({ mode: "open" });
    shadow.innerHTML = `<b id="first"></b><i></i>`;
    expect(shadow.querySelector(":has(~ i)")!.id).toBe("first");
    expect(shadow.querySelector("nav :is(b)")).toBeNull();
    expect(dom.document.createElement("p").matches(":has(~ b)")).toBe(false);
  });

  it("matches ancestors of a disconnected element, as browsers do", () => {
    const section = dom.document.createElement("section");
    section.innerHTML = `<div><p id="x"></p></div>`;
    const div = section.firstElementChild!;
    expect(div.isConnected).toBe(false);
    expect([ids(div.querySelectorAll(":is(section p)")), ids(div.querySelectorAll("section p")), div.querySelector("section > div > p")?.id]).toEqual([
      ["x"],
      ["x"],
      "x",
    ]);
  });

  it("answers queries in a NodeList, as browsers do", () => {
    const { NodeList } = dom.document.defaultView!;
    const main = dom.document.querySelector("main")!;
    for (const list of [
      dom.document.querySelectorAll("main > header"),
      dom.document.querySelectorAll("main > header ~ footer"),
      main.querySelectorAll("header"),
      main.querySelectorAll(":scope > header"),
      dom.document.createDocumentFragment().querySelectorAll(":scope b"),
    ]) {
      expect(list).toBeInstanceOf(NodeList);
      expect(list.item(0)).toBe(list[0] ?? null);
    }
    expect(dom.document.querySelectorAll("main > header ~ footer")).not.toBe(dom.document.querySelectorAll("main > header ~ footer"));
  });

  it("resolves :scope against the element queried, matched or closest", () => {
    const main = dom.document.querySelector("main")!;
    expect(ids(main.querySelectorAll(":scope > :not(footer):has(~ footer)"))).toEqual(["top", "side", "gesture"]);
    expect(main.querySelector(":scope > content-drawer:has(~ *)")).toBeNull();
    expect(ids(dom.document.querySelectorAll(":scope > body"))).toEqual(["<body>"]);
    expect($("drawer").closest(":scope > *")).toBeNull();
    expect($("drawer").closest(":has(> :scope)")!.id).toBe("gesture");
    expect([$("top").matches(":scope"), $("top").matches("main > :scope")]).toEqual([true, true]);
    expect(main.attributes).toHaveLength(0);
  });

  it("resolves :scope on a form or select, which happy-dom runs behind a proxy", () => {
    const host = dom.document.createElement("div");
    host.innerHTML = `<form><label><input name="a"></label><div><label><input name="b"></label></div><select><option id="o"></option></select></form>`;
    dom.document.body.append(host);
    const form = host.querySelector("form")!;
    const select = form.querySelector("select")!;
    expect([...form.querySelectorAll(":scope > label input")].map((input) => input.getAttribute("name"))).toEqual(["a"]);
    expect([form.matches(":scope:has(> select)"), form.closest(":scope:is(form)"), select.querySelector(":scope > option")]).toEqual([
      true,
      form,
      $("o"),
    ]);
  });

  it("throws what Chrome rejects as a SyntaxError DOMException", () => {
    const { DOMException } = dom.document.defaultView!;
    const syntaxError = expect.objectContaining({ name: "SyntaxError", code: 12 });
    dom.document.body.innerHTML = `<p id="a"></p><b></b><a></a>`;
    for (const selector of [":nth-child(foo)", ":nth-last-child()", "p:nth-of-type(1 of p)", "p:lang()", ":host(a b)", "p:foo(x)", "main >", "> main"]) {
      expect(() => dom.document.querySelectorAll(selector)).toThrow(syntaxError);
    }
    expect(() => $("a").matches(":has(~ a:has(~ b))")).toThrow(DOMException);
    // forgiving: :is() drops the nested :has()
    expect($("a").closest(":not(:has(~ :is(:has(b))))")).toBe($("a"));
    expect(() => dom.document.querySelector('[id="a" s]')).toThrow(
      `Failed to execute 'querySelector' on 'Document': '[id="a" s]' is not a valid selector.`,
    );
    expect(() => dom.document.createDocumentFragment().querySelectorAll(":has(:has(a))")).toThrow(
      "Failed to execute 'querySelectorAll' on 'DocumentFragment'",
    );
    // no defaultView: still the window's DOMException
    expect(() => dom.document.implementation.createHTMLDocument().querySelector(":has(:has(a))")).toThrow(syntaxError);
  });

  it("reads 40 escapes at once", () => {
    const start = performance.now();
    expect(() => dom.document.querySelectorAll(`[a${"\\31".repeat(40)}!]:has(b)`)).toThrow();
    expect(dom.document.querySelectorAll(`[a${"\\31".repeat(40)}]:has(b)`)).toHaveLength(0);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it("writes nothing to the DOM, so observers see no records", async () => {
    const records: MutationRecord[] = [];
    const observer = new dom.document.defaultView!.MutationObserver((list) => records.push(...list));
    observer.observe(dom.document.documentElement, { attributes: true, subtree: true, childList: true });
    dom.document.querySelectorAll(":has(~ footer)");
    dom.document.querySelector("main")!.querySelectorAll(":scope > header");
    $("top").matches(":has(~ nav)");
    $("drawer").closest(":has(~ footer)");
    await Promise.resolve();
    observer.disconnect();
    expect(records).toEqual([]);
  });

  it("reads each sibling and descendant once per call, however many subjects", () => {
    const query = (markup: string, selector: string) => {
      dom.document.body.innerHTML = markup;
      const getAttribute = vi.spyOn(dom.document.defaultView!.Element.prototype, "getAttribute");
      const found = dom.document.querySelectorAll(selector).length;
      const reads = getAttribute.mock.calls.filter(([name]) => name === "data-k").length;
      vi.restoreAllMocks();
      return { found, reads };
    };
    const flat = (count: number, value: string) =>
      query(`<main>${"<i></i>".repeat(count)}<b data-k="B"></b></main>`, `i:has(~ [data-k="${value}" i])`);
    const deep = (count: number, value: string) =>
      query(`${"<div>".repeat(count)}<b data-k="B"></b>${"</div>".repeat(count)}`, `div:has([data-k="${value}" i])`);
    expect([flat(400, "b").found, flat(400, "c").found, deep(200, "b").found, deep(200, "c").found]).toEqual([400, 0, 200, 0]);
    // one read per element added, where a scan per subject would grow quadratically
    expect(flat(400, "c").reads - flat(20, "c").reads).toBe(380);
    expect(deep(200, "c").reads - deep(20, "c").reads).toBe(180);
  });

  it("reads each sibling and ancestor once per call when matching right to left", () => {
    const query = (markup: string, selector: string) => {
      dom.document.body.innerHTML = markup;
      const getAttribute = vi.spyOn(dom.document.defaultView!.Element.prototype, "getAttribute");
      const found = dom.document.querySelectorAll(selector).length;
      const reads = getAttribute.mock.calls.filter(([name]) => name === "data-k").length;
      vi.restoreAllMocks();
      return { found, reads };
    };
    const siblings = (count: number) => query(`<ul>${"<li></li>".repeat(count)}</ul>`, 'li[data-k="x" i] ~ li');
    const deep = (count: number) => query(`${"<div>".repeat(count)}${"<p></p>".repeat(20)}${"</div>".repeat(count)}`, '[data-k="x" i] p');
    expect([siblings(300).found, deep(20).found]).toEqual([0, 0]);
    // one read per element added, where a search per subject grows quadratically
    expect(siblings(2000).reads - siblings(300).reads).toBe(1700);
    expect(deep(200).reads - deep(20).reads).toBe(180);
  });

  it("leaves other selectors, their answers and their errors to happy-dom", () => {
    // a zero-weight :where() never matches inside happy-dom's :is() / :has()
    expect([$("top").matches(":is(:where(header))"), dom.document.querySelector("main")!.matches(":has(:where(header))")]).toEqual([
      true,
      true,
    ]);
    expect([$("top").matches("main > header"), $("top").matches("footer"), $("top").matches(":hover"), $("top").matches(":state(on)")]).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect($("top").matches('[data-x=":has(~ a)"]')).toBe(false);
    expect(dom.document.querySelectorAll(null as unknown as string)).toHaveLength(0);
    // happy-dom's own error, a JavaScript SyntaxError, for what the shim cannot read
    const { SyntaxError } = dom.document.defaultView!;
    for (const selector of [":is(main", ":is(a])", ':is([title="x])', ":is([xlink|href])", "svg|rect:is(a b)"]) {
      expect(() => dom.document.querySelectorAll(selector)).toThrow(SyntaxError);
    }
    expect([attempt(() => dom.document.querySelector("svg|rect")), attempt(() => $("top").matches("svg|rect")), attempt(() => $("top").closest("svg|rect"))]).toEqual(
      Array(3).fill("THROW SyntaxError"),
    );
  });

  it("keeps answering after many generated selectors", () => {
    for (let i = 0; i < 1100; i++) dom.document.querySelectorAll(`[n-select-id-${i}] ~ footer`);
    expect(ids(dom.document.querySelectorAll("main > :not(:has(~ *))"))).toEqual(["end"]);
  });
});

describe("supportSelectors", () => {
  it("patches each prototype once", async () => {
    const { window, dispose } = createDom();
    const patched = () => [
      window.Element.prototype.matches,
      window.Element.prototype.closest,
      window.Element.prototype.querySelector,
      window.document.querySelectorAll,
      window.document.createDocumentFragment().querySelectorAll,
    ];
    const before = patched();
    supportSelectors(window);
    supportSelectors(globalThis);
    expect(patched()).toEqual(before);
    await dispose();
  });
});
