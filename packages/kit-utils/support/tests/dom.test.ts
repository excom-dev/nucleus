import * as dom from "../../dom";
import { createElement } from "../../dom";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";

describe("dom", () => {
  it("Converter: converts attributes correctly", () => {
    expect(dom.Converter.type("boolean").attr.convert("")).to.be.true;
    expect(dom.Converter.type("boolean").attr.convert(null)).to.be.false;
    expect(dom.Converter.type("number").attr.convert("1")).to.equal(1);
    expect(dom.Converter.type("number").attr.convert("1.1")).to.equal(1.1);
    expect(dom.Converter.type("number").attr.convert("")).to.equal(null);
    expect(dom.Converter.type("string").attr.convert("")).to.equal("");
    expect(dom.Converter.type("string").attr.convert(null)).to.equal(null);
    expect(dom.Converter.type("string").attr.convert("hello")).to.equal(
      "hello",
    );
    expect(dom.Converter.type("tokens").attr.convert("hello")).to.deep.equal([
      "hello",
    ]);
    expect(
      dom.Converter.type("tokens").attr.convert("hello world"),
    ).to.deep.equal(["hello", "world"]);
    expect(dom.Converter.type("tokens").attr.convert(null)).to.equal(null);
    expect(dom.Converter.type("tokens").attr.convert("")).to.deep.equal([]);
  });

  it("Converter: converts properties correctly", () => {
    expect(dom.Converter.type("boolean").prop.convert(true)).to.equal("");
    expect(dom.Converter.type("boolean").prop.convert(false)).to.be.null;
    expect(dom.Converter.type("tokens").prop.convert(["hello"])).to.equal(
      "hello",
    );
    expect(
      dom.Converter.type("tokens").prop.convert(["hello", "world"]),
    ).to.equal("hello world");
    expect(dom.Converter.type("number").prop.convert(1)).to.equal("1");
    expect(dom.Converter.type("number").prop.convert(1.1)).to.equal("1.1");
    expect(dom.Converter.type("string").prop.convert("hello")).to.equal(
      "hello",
    );
    expect(dom.Converter.type("string").prop.convert(null)).to.equal(null);
    expect(dom.Converter.type("string").prop.convert("")).to.equal("");
    expect(dom.Converter.type("tokens").prop.convert(null)).to.equal(null);
    expect(dom.Converter.type("tokens").prop.convert([])).to.equal("");
  });

  it("Converter: sets attributes correctly", () => {
    const el = document.createElement("div");
    dom.setAttr(
      el,
      "auto-play",
      dom.Converter.type("boolean").prop.convert(true),
    );
    expect(el.getAttribute("auto-play")).to.equal("");
    dom.setAttr(
      el,
      "auto-play",
      dom.Converter.type("boolean").prop.convert(false),
    );
    expect(el.getAttribute("auto-play")).to.be.null;
    dom.setAttr(el, "auto-play", dom.Converter.type("number").prop.convert(1));
    expect(el.getAttribute("auto-play")).to.equal("1");
    dom.setAttr(
      el,
      "auto-play",
      dom.Converter.type("number").prop.convert(1.1),
    );
    expect(el.getAttribute("auto-play")).to.equal("1.1");
    dom.setAttr(
      el,
      "auto-play",
      dom.Converter.type("string").prop.convert("hello"),
    );
    expect(el.getAttribute("auto-play")).to.equal("hello");
    dom.setAttr(
      el,
      "auto-play",
      dom.Converter.type("tokens").prop.convert(["hello"]),
    );
    expect(el.getAttribute("auto-play")).to.equal("hello");
    dom.setAttr(
      el,
      "auto-play",
      dom.Converter.type("tokens").prop.convert(["hello", "world"]),
    );
    expect(el.getAttribute("auto-play")).to.equal("hello world");
  });

  it("Converter: gets attributes correctly", () => {
    const el = document.createElement("div");
    el.setAttribute("auto-play", "true");
    expect(
      dom.Converter.type("boolean").attr.convert(dom.getAttr(el, "auto-play")),
    ).to.be.true;
    el.setAttribute("auto-play", "1");
    expect(
      dom.Converter.type("number").attr.convert(dom.getAttr(el, "auto-play")),
    ).to.equal(1);
    el.setAttribute("auto-play", "hello");
    expect(
      dom.Converter.type("string").attr.convert(dom.getAttr(el, "auto-play")),
    ).to.equal("hello");
    el.setAttribute("auto-play", "hello world");
    expect(
      dom.Converter.type("tokens").attr.convert(dom.getAttr(el, "auto-play")),
    ).to.deep.equal(["hello", "world"]);
  });

  it("Converter: gets attribute names correctly", () => {
    expect(dom.Converter.getAttrName("myProp")).to.equal("my-prop");
    expect(dom.Converter.getAttrName("myPropAbc")).to.equal("my-prop-abc");
    expect(dom.Converter.getAttrName("myBOOL")).to.equal("my-b-o-o-l");
    expect(dom.Converter.getAttrName("myTokens")).to.equal("my-tokens");
    expect(dom.Converter.getAttrName("mytokens")).to.equal("mytokens");
  });

  it("Converter: gets property names correctly", () => {
    expect(dom.Converter.getPropName("my-bool")).to.equal("myBool");
    expect(dom.Converter.getPropName("my-b-o-o-l")).to.equal("myBOOL");
    expect(dom.Converter.getPropName("my-prop-abc")).to.equal("myPropAbc");
    expect(dom.Converter.getPropName("my-tokens")).to.equal("myTokens");
  });

  it("objToAttrs: converts object to object of attribute key-value pairs", () => {
    const expectationMatrix = {
      names: [
        {
          input: "autoPlay",
          opts: { preserveKey: true, convertNonPrimitives: true },
          output: "autoplay",
        },
        {
          input: "autoPlay",
          opts: { preserveKey: false, convertNonPrimitives: true },
          output: "auto-play",
        },
        {
          input: "autoPlay",
          opts: { prefix: "data-", convertNonPrimitives: true },
          output: "data-auto-play",
        },
        {
          input: "autoPlay",
          opts: {
            prefix: "data-",
            preserveKey: true,
            convertNonPrimitives: true,
          },
          output: "data-autoplay",
        },
        {
          input: "autoPlay",
          opts: {
            prefix: "data-",
            preserveKey: false,
            convertNonPrimitives: true,
          },
          output: "data-auto-play",
        },
        {
          input: "autoPlay",
          opts: {
            prefix: "object",
            preserveKey: false,
            convertNonPrimitives: true,
          },
          output: "objectauto-play",
        },
        {
          input: "play",
          opts: {
            prefix: "auto",
            preserveKey: false,
            convertNonPrimitives: true,
          },
          output: "autoplay",
        },
      ],
      values: [
        // nullish
        [null, null],
        [undefined, null],
        // boolean
        [true, ""],
        [false, null],
        // number
        [1, "1"],
        [1.1, "1.1"],
        [-7, "-7"],
        [Infinity, "Infinity"],
        [-Infinity, "-Infinity"],
        [NaN, "NaN"],
        [0, "0"],
        [-0, "0"],
        // string
        ["hello", "hello"],
        ["", ""],
        ["hello world", "hello world"],
        // tokens
        [["hello"], "hello"],
        [["hello", "world"], "hello world"],
        [[], ""],
        // non-primitive array
        [[new Object()], "1"],
        [[new Object(), new Object()], "2"],
        // object
        [{ foo: "abc" }, "1"],
        [{ foo: "abc", bar: "baz" }, "2"],
        [{}, "0"],
        // other non-primitives
        [1n, ""],
        [2n, ""],
        [BigInt(1), ""],
        [() => {}, ""],
        [Symbol("hello"), ""],
        [new Date(), ""],
        [new RegExp("hello"), ""],
        [new Map(), ""],
        [new Set(), ""],
        [new ArrayBuffer(1), ""],
        [new Uint8Array(1), ""],
        [new Uint16Array(1), ""],
        [new Uint32Array(1), ""],
      ],
    } as const;
    expectationMatrix.names.forEach(({ input, opts, output }) => {
      expectationMatrix.values.forEach(([inputVal, outputVal]) => {
        expect(
          dom.objToAttrs({ [input]: inputVal }, opts),
          `(${input}: ${inputVal?.constructor.name || "unknown"}<${String(inputVal)}>)`,
        ).to.deep.equal({
          [output]: outputVal,
        });
      });
    });
  });

  it("selectOne/selectAll: uses root if provided", () => {
    document.body.innerHTML = `
      <section>
        <div><span>hello</span><span>world</span></div>
      </section>
    `;
    expect(dom.selectOne("span", { root: "section" })?.textContent).to.equal(
      "hello",
    );
    expect(dom.selectAll("span", { root: "section" })?.length).to.be.equal(2);
  });

  it("selectOne/selectAll: uses scope if provided", () => {
    document.body.innerHTML = `
      <main>
        <section id="section-0">
          <div>
            <a id="a-0">foo</a>
          </div>
          <div>
            <a id="a-1">bar</a>
          </div>
        </section>
        <section id="section-1">
          <div>
            <a id="a-2">baz</a>
          </div>
          <div>
            <a id="a-3">qux</a>
          </div>
        </section>
      </main>
    `;
    const a2 = document.querySelector("#a-2")!;
    expect(
      dom.selectOne("section:has(:scope)", { root: "main", scope: a2 })?.id,
    ).to.equal("section-1");
    // no root → document
    expect(dom.selectOne("section:has(:scope)", { scope: a2 })?.id).to.equal(
      "section-1",
    );
    // temp attr is gone after the query
    expect(
      !![...a2.attributes].find((a) => a.name.startsWith("n-util-select-id")),
    ).to.be.false;

    // selectAll
    expect(
      dom.selectAll("section:has(:scope)", { root: "main", scope: a2 })?.length,
    ).to.be.equal(1);
    // no root → document
    expect(
      dom.selectAll("section:has(:scope)", { scope: a2 })?.length,
    ).to.be.equal(1);
    // temp attr is gone after the query
    expect(
      !![...a2.attributes].find((a) => a.name.startsWith("n-util-select-id")),
    ).to.be.false;

    // compound selectors
    expect(
      dom
        .selectAll("section:has(:scope), section:has(+section :scope) a#a-0", {
          scope: a2,
        })
        ?.map((e) => e.id),
    ).to.deep.equal(["a-0", "section-1"]);

    // root === scope: leave `:scope` alone
    const section = document.querySelector("#section-1")!;
    expect(
      dom.selectOne(":scope #a-2", { root: "#section-1", scope: section })?.id,
    ).to.equal("a-2");
  });

  it("selectOne/selectAll: only tags the scope when the selector uses :scope", () => {
    document.body.innerHTML = `
      <main>
        <section id="section-0"><a id="a-0">foo</a></section>
        <section id="section-1"><a id="a-1">bar</a></section>
      </main>
    `;
    const a1 = document.querySelector("#a-1")!;
    const setAttribute = vi.spyOn(a1, "setAttribute");
    const removeAttribute = vi.spyOn(a1, "removeAttribute");

    // no `:scope` in the selector → no attribute churn at all
    expect(dom.selectOne("a", { root: "main", scope: a1 })?.id).to.equal("a-0");
    expect(dom.selectAll("a", { root: "main", scope: a1 })?.length).to.equal(2);
    expect(setAttribute).not.toHaveBeenCalled();
    expect(removeAttribute).not.toHaveBeenCalled();

    // `:scope` still resolves relative to the scope element
    expect(
      dom.selectOne("section:has(:scope)", { root: "main", scope: a1 })?.id,
    ).to.equal("section-1");
    expect(setAttribute).toHaveBeenCalledTimes(1);
    expect(removeAttribute).toHaveBeenCalledTimes(1);
    expect(setAttribute.mock.calls[0][0]).to.match(/^n-util-select-id-/);
    expect(removeAttribute.mock.calls[0][0]).to.equal(
      setAttribute.mock.calls[0][0],
    );
    expect(
      !![...a1.attributes].find((a) => a.name.startsWith("n-util-select-id")),
    ).to.be.false;

    setAttribute.mockRestore();
    removeAttribute.mockRestore();
  });

  it("selectOne: enableRootRefs resolves window/document/html/body/head", () => {
    expect(dom.selectOne("window", { enableRootRefs: true })).to.equal(window);
    expect(dom.selectOne("document", { enableRootRefs: true })).to.equal(
      document,
    );
    expect(dom.selectOne("html", { enableRootRefs: true })).to.equal(
      document.documentElement,
    );
    expect(dom.selectOne("body", { enableRootRefs: true })).to.equal(
      document.body,
    );
    expect(dom.selectOne("head", { enableRootRefs: true })).to.equal(
      document.head,
    );
    expect(dom.selectOne("  window  ", { enableRootRefs: true })).to.equal(
      window,
    );
  });

  it("selectOne: enableRootRefs false/omitted does not resolve window/document", () => {
    /* `window` / `document` are not CSS-selectable; without
     * `enableRootRefs` they must not resolve. (`html` / `body` / `head`
     * still match via `querySelector`.) */
    expect(dom.selectOne("window")).to.equal(null);
    expect(dom.selectOne("document")).to.equal(null);
    expect(dom.selectOne("window", { enableRootRefs: false })).to.equal(null);
    expect(dom.selectOne("document", { enableRootRefs: false })).to.equal(
      null,
    );
  });

  it("selectOne: enableRootRefs still resolves normal selectors", () => {
    document.body.innerHTML = `<div id="root-ref-target"></div>`;
    expect(
      dom.selectOne("#root-ref-target", { enableRootRefs: true })?.id,
    ).to.equal("root-ref-target");
  });

  it("selectAll: enableRootRefs resolves the same root refs", () => {
    expect(dom.selectAll("window", { enableRootRefs: true })).to.equal(window);
    expect(dom.selectAll("#missing", { enableRootRefs: true })).to.deep.equal(
      [],
    );
  });
});

describe("dom: element helpers", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("createElement: sets props, attributes and children", () => {
    const span = document.createElement("span");
    const el = dom.createElement(
      "div",
      { id: "made", className: "box", attributes: { "data-role": "card" } },
      [span, "tail" as unknown as HTMLElement],
    );
    expect(el.tagName).to.equal("DIV");
    expect(el.id).to.equal("made");
    expect(el.className).to.equal("box");
    expect(el.getAttribute("data-role")).to.equal("card");
    expect(el.childNodes.length).to.equal(2);
    expect(el.firstElementChild).to.equal(span);
    expect(el.lastChild?.nodeType).to.equal(Node.TEXT_NODE);
    expect(el.textContent).to.equal("tail");
  });

  it("createElement: tolerates missing props, empty attributes and no children", () => {
    const bare = dom.createElement("p");
    expect(bare.tagName).to.equal("P");
    expect(bare.childNodes.length).to.equal(0);
    const nullAttrs = dom.createElement("p", { attributes: null });
    expect(nullAttrs.attributes.length).to.equal(0);
  });

  it("getChildren: splits a leading <template> from the other children", () => {
    const el = fixture<HTMLElement>(
      `<div><template><i></i></template><a></a><b></b></div>`,
    );
    const { templateChild, otherChildren } = dom.getChildren(el);
    expect(templateChild).to.be.instanceOf(HTMLTemplateElement);
    expect(otherChildren.map((c) => c.tagName)).to.deep.equal(["A", "B"]);
  });

  it("getChildren: only a first-child <template> counts as the template", () => {
    const el = fixture<HTMLElement>(`<div><a></a><template></template></div>`);
    const { templateChild, otherChildren } = dom.getChildren(el);
    expect(templateChild).to.equal(null);
    expect(otherChildren.map((c) => c.tagName)).to.deep.equal([
      "A",
      "TEMPLATE",
    ]);
    const empty = dom.getChildren(document.createElement("div"));
    expect(empty.templateChild).to.equal(null);
    expect(empty.otherChildren).to.deep.equal([]);
  });

  it("buildContent: unwraps a single child and clones by default", () => {
    const tpl = document.createElement("template");
    tpl.innerHTML = `<p class="only">one</p>`;
    const built = dom.buildContent(tpl.content) as Element;
    expect(built.className).to.equal("only");
    expect(built).to.not.equal(tpl.content.firstElementChild);
    // the template keeps its own child
    expect(tpl.content.children.length).to.equal(1);
  });

  it("buildContent: wraps several children in a div", () => {
    const tpl = document.createElement("template");
    tpl.innerHTML = `<p>a</p><p>b</p>`;
    const built = dom.buildContent(tpl.content) as Element;
    expect(built.tagName).to.equal("DIV");
    expect(built.children.length).to.equal(2);
    expect(tpl.content.children.length).to.equal(2);
    const emptyTpl = document.createElement("template");
    const builtEmpty = dom.buildContent(emptyTpl.content) as Element;
    expect(builtEmpty.tagName).to.equal("DIV");
    expect(builtEmpty.children.length).to.equal(0);
  });

  it("buildContent: skipCloning returns the fragment's own nodes", () => {
    const single = document.createElement("template");
    single.innerHTML = `<p>one</p>`;
    const own = single.content.firstElementChild;
    expect(dom.buildContent(single.content, { skipCloning: true })).to.equal(
      own,
    );
    const many = document.createElement("template");
    many.innerHTML = `<p>a</p><p>b</p>`;
    const wrapped = dom.buildContent(many.content, {
      skipCloning: true,
    }) as Element;
    expect(wrapped.tagName).to.equal("DIV");
    // the wrapper adopted the fragment's children (moved, not copied)
    expect(wrapped.children.length).to.equal(2);
    expect(many.content.children.length).to.equal(0);
  });
});

describe("dom: replaceNonTemplateChildren", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const tags = (el: Element) =>
    [...el.children].map((c) => c.tagName.toLowerCase() + (c.id ? "#" + c.id : ""));

  it("removes every non-template child when given nothing", () => {
    const el = fixture<HTMLElement>(
      `<div><template></template><a></a><b></b></div>`,
    );
    expect(dom.replaceNonTemplateChildren(el)).to.equal(true);
    expect(tags(el)).to.deep.equal(["template"]);
    // nothing left to remove: reports no change
    expect(dom.replaceNonTemplateChildren(el, [])).to.equal(false);
  });

  it("appends when there are no old children and replaces mismatches", () => {
    const el = fixture<HTMLElement>(`<div><template></template></div>`);
    const a = document.createElement("a");
    const b = document.createElement("b");
    expect(dom.replaceNonTemplateChildren(el, [a, b])).to.equal(true);
    expect(tags(el)).to.deep.equal(["template", "a", "b"]);
    // same nodes again: no change
    expect(dom.replaceNonTemplateChildren(el, [a, b])).to.equal(false);
    // a fresh node replaces the old one at its index
    const i = document.createElement("i");
    expect(dom.replaceNonTemplateChildren(el, [a, i])).to.equal(true);
    expect(tags(el)).to.deep.equal(["template", "a", "i"]);
    expect(b.isConnected).to.equal(false);
  });

  it("drops trailing old children beyond the new list", () => {
    const el = fixture<HTMLElement>(
      `<div><a id="a"></a><b id="b"></b><i id="i"></i></div>`,
    );
    const a = el.querySelector("#a")!;
    expect(dom.replaceNonTemplateChildren(el, [a])).to.equal(true);
    expect(tags(el)).to.deep.equal(["a#a"]);
  });

  it("swaps in a new child that is already a sibling", () => {
    const el = fixture<HTMLElement>(
      `<div><template></template><a id="a"></a><b id="b"></b><i id="i"></i></div>`,
    );
    const a = el.querySelector("#a")!;
    const i = el.querySelector("#i")!;
    expect(dom.replaceNonTemplateChildren(el, [i, a])).to.equal(true);
    expect(tags(el)).to.deep.equal(["template", "i#i", "a#a"]);
    expect(el.querySelector("#b")).to.equal(null);
    // no stray placeholder survives
    expect(el.querySelectorAll("div").length).to.equal(0);
  });

  it("moves a non-element sibling node without the placeholder swap", () => {
    const el = fixture<HTMLElement>(`<div><a id="a"></a>text</div>`);
    const text = el.lastChild!;
    expect(text.nodeType).to.equal(Node.TEXT_NODE);
    expect(dom.replaceNonTemplateChildren(el, [text])).to.equal(true);
    expect(el.childNodes.length).to.equal(1);
    expect(el.firstChild).to.equal(text);
  });
});

describe("dom: selection roots", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns null when the root selector matches nothing", () => {
    document.body.innerHTML = `<span></span>`;
    expect(dom.selectOne("span", { root: "#missing-root" })).to.equal(null);
    expect(dom.selectAll("span", { root: "#missing-root" })).to.equal(null);
  });

  it("resolves the root as the closest ancestor of the scope", () => {
    document.body.innerHTML = `
      <section id="outer"><section id="inner"><a id="target"></a></section><b id="not-inside"></b></section>
    `;
    const target = document.querySelector("#target") as HTMLElement;
    expect(
      dom.selectOne("a", { root: "section", scope: target })?.id,
    ).to.equal("target");
    expect(dom.selectAll("b", { root: "#inner", scope: target })).to.deep.equal(
      [],
    );
    // no ancestor matches the root selector
    expect(dom.selectOne("a", { root: "article", scope: target })).to.equal(
      null,
    );
  });

  it("queries a detached tree from the scope's own root node", () => {
    const detached = document.createElement("div");
    detached.innerHTML = `<p id="p"><b id="b"></b></p>`;
    const p = detached.querySelector("#p") as HTMLElement;
    expect(dom.selectOne(":scope > b", { scope: p })?.id).to.equal("b");
    expect(dom.selectAll("b", { scope: p })?.length).to.equal(1);
    expect(p.attributes.length).to.equal(1);
  });
});

describe("dom: Converter details", () => {
  it("maps constructors and type names to converters", () => {
    expect(dom.Converter.type(String)).to.equal(dom.Converter.string);
    expect(dom.Converter.type(Boolean)).to.equal(dom.Converter.boolean);
    expect(dom.Converter.type(Number)).to.equal(dom.Converter.number);
    expect(dom.Converter.type(dom.TokenList)).to.equal(dom.Converter.tokens);
    expect(dom.Converter.type("string")).to.equal(dom.Converter.string);
    expect(dom.Converter.type("boolean")).to.equal(dom.Converter.boolean);
    expect(dom.Converter.type("number")).to.equal(dom.Converter.number);
    expect(dom.Converter.type("tokens")).to.equal(dom.Converter.tokens);
  });

  it("returns undefined for unknown types unless non-primitives are allowed", () => {
    expect(dom.Converter.type("object")).to.equal(undefined);
    expect(dom.Converter.type(Object)).to.equal(undefined);
    expect(dom.Converter.type(Array, {})).to.equal(undefined);
    expect(
      dom.Converter.type("object", { convertNonPrimitives: true }),
    ).to.equal(dom.Converter.nonPrimitive);
    expect(
      dom.Converter.type(Object, { convertNonPrimitives: true }),
    ).to.equal(dom.Converter.nonPrimitive);
    expect(dom.Converter.type(null, { convertNonPrimitives: true })).to.equal(
      undefined,
    );
    expect(
      dom.Converter.type(undefined, { convertNonPrimitives: true }),
    ).to.equal(undefined);
  });

  it("boolean: truthiness and defaults", () => {
    const { attr, prop } = dom.Converter.boolean;
    expect(attr.isTruthy("")).to.equal(true);
    expect(attr.isTruthy("false")).to.equal(true);
    expect(attr.isTruthy(null)).to.equal(false);
    expect(attr.defaultValue).to.equal(null);
    expect(prop.isTruthy(true)).to.equal(true);
    expect(prop.isTruthy(0)).to.equal(false);
    expect(prop.defaultValue).to.equal(false);
    // a string prop is written as a boolean attribute even when empty
    expect(prop.convert("")).to.equal("");
    expect(prop.convert("yes")).to.equal("");
    expect(prop.convert(0)).to.equal(null);
    expect(prop.convert(null)).to.equal(null);
  });

  it("number: truthiness, defaults and invalid input", () => {
    const { attr, prop } = dom.Converter.number;
    expect(attr.convert("abc")).to.equal(null);
    expect(attr.convert(null)).to.equal(null);
    expect(attr.convert("-2")).to.equal(-2);
    expect(attr.isTruthy("0")).to.equal(true);
    expect(attr.isTruthy("")).to.equal(false);
    expect(attr.isTruthy(null)).to.equal(false);
    expect(attr.defaultValue).to.equal(null);
    expect(prop.convert(null)).to.equal(null);
    expect(prop.convert(undefined)).to.equal(null);
    expect(prop.convert("")).to.equal(null);
    expect(prop.convert(0)).to.equal("0");
    expect(prop.isTruthy(0)).to.equal(true);
    expect(prop.isTruthy(NaN)).to.equal(false);
    expect(prop.isTruthy("1")).to.equal(false);
    expect(prop.defaultValue).to.equal(null);
  });

  it("string: truthiness and defaults", () => {
    const { attr, prop } = dom.Converter.string;
    expect(attr.isTruthy("")).to.equal(true);
    expect(attr.isTruthy(null)).to.equal(false);
    expect(attr.defaultValue).to.equal(null);
    expect(prop.convert(12)).to.equal("12");
    expect(prop.convert(undefined)).to.equal(null);
    expect(prop.isTruthy("")).to.equal(true);
    expect(prop.isTruthy(undefined)).to.equal(false);
    expect(prop.defaultValue).to.equal(null);
  });

  it("tokens: trims, drops blanks and rejects non-arrays", () => {
    const { attr, prop } = dom.Converter.tokens;
    expect(attr.convert("  a   b ")).to.deep.equal(["a", "b"]);
    expect(attr.isTruthy("")).to.equal(true);
    expect(attr.isTruthy(null)).to.equal(false);
    expect(attr.defaultValue).to.equal(null);
    expect(prop.convert(["a", null, "", undefined, "b"])).to.equal("a b");
    expect(prop.convert("a b")).to.equal(null);
    expect(prop.isTruthy([])).to.equal(true);
    expect(prop.isTruthy("a")).to.equal(false);
    expect(prop.defaultValue).to.equal(null);
  });

  it("nonPrimitive: cannot read attributes, counts arrays and objects", () => {
    const { attr, prop } = dom.Converter.nonPrimitive;
    expect(() => attr.convert("x")).to.throw(
      "Cannot convert non-primitive to attribute",
    );
    expect(attr.isTruthy("")).to.equal(true);
    expect(attr.isTruthy(null)).to.equal(false);
    expect(attr.defaultValue).to.equal(null);
    expect(prop.convert([1, 2, 3])).to.equal("3");
    expect(prop.convert({ a: 1 })).to.equal("1");
    expect(prop.convert(new Date())).to.equal("");
    expect(prop.convert(0)).to.equal(null);
    expect(prop.convert(null)).to.equal(null);
    expect(prop.isTruthy({})).to.equal(true);
    expect(prop.isTruthy(undefined)).to.equal(false);
    expect(prop.defaultValue).to.equal(null);
  });

  it("nonPrimitive: falls back to presence when the value cannot be inspected", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("no keys for you");
        },
      },
    );
    expect(dom.Converter.nonPrimitive.prop.convert(hostile)).to.equal("");
  });
});

describe("dom: attribute helpers", () => {
  it("setAttr: skips writes when the element already holds the value", () => {
    const el = document.createElement("div");
    el.setAttribute("data-x", "1");
    const set = vi.spyOn(el, "setAttribute");
    const remove = vi.spyOn(el, "removeAttribute");
    dom.setAttr(el, "data-x", "1");
    expect(set).not.toHaveBeenCalled();
    dom.setAttr(el, "data-x", undefined);
    expect(remove.mock.calls[0][0]).to.equal("data-x");
    expect(el.hasAttribute("data-x")).to.equal(false);
  });

  it("setAttr/getAttr: work on a NamedNodeMap", () => {
    const el = document.createElement("div");
    const map = el.attributes;
    expect(dom.getAttr(map, "data-x")).to.equal(null);
    dom.setAttr(map, "data-x", "1");
    expect(el.getAttribute("data-x")).to.equal("1");
    expect(dom.getAttr(map, "data-x")).to.equal("1");
    // unchanged value: no new attr node
    const before = map.getNamedItem("data-x");
    dom.setAttr(map, "data-x", "1");
    expect(map.getNamedItem("data-x")).to.equal(before);
    dom.setAttr(map, "data-x", "2");
    expect(el.getAttribute("data-x")).to.equal("2");
    expect(dom.getAttr(el, "data-x")).to.equal("2");
    dom.setAttr(map, "data-x", null);
    expect(el.hasAttribute("data-x")).to.equal(false);
    expect(dom.getAttr(map, "data-x")).to.equal(null);
  });

  it("attributesToEntries/attributesToObject: filter by namespace and format", () => {
    const el = document.createElement("div");
    el.setAttribute("data-a", "1");
    el.setAttribute("data-b", "2");
    el.setAttribute("aria-label", "x");
    expect(dom.attributesToEntries(el.attributes)).to.deep.equal([
      ["data-a", "1"],
      ["data-b", "2"],
      ["aria-label", "x"],
    ]);
    expect(dom.attributesToObject(el.attributes, "data-")).to.deep.equal({
      "data-a": "1",
      "data-b": "2",
    });
    expect(
      dom.attributesToObject(el.attributes, "data-", (a) => [
        a.name.replace("data-", ""),
        a.value + "!",
      ]),
    ).to.deep.equal({ a: "1!", b: "2!" });
    expect(dom.attributesToEntries(el.attributes, "aria-", (a) => [
      a.name,
      a.value.toUpperCase(),
    ])).to.deep.equal([["aria-label", "X"]]);
    expect(
      dom.attributesToObject(document.createElement("i").attributes),
    ).to.deep.equal({});
  });

  it("objToAttrs: defaults to no prefix and drops non-primitives unless asked", () => {
    expect(dom.objToAttrs({ fooBar: 1, isOn: true })).to.deep.equal({
      "foo-bar": "1",
      "is-on": "",
    });
    expect(dom.objToAttrs({ dataObj: { a: 1 } })).to.deep.equal({
      "data-obj": null,
    });
    expect(
      dom.objToAttrs({ dataObj: { a: 1 } }, { convertNonPrimitives: true }),
    ).to.deep.equal({ "data-obj": "1" });
    expect(
      dom.objToAttrs({ fooBar: "x" }, { prefix: 5 as unknown as string }),
    ).to.deep.equal({ "foo-bar": "x" });
    expect(
      dom.objToAttrs({ tokenList: ["a", undefined, "b"] }),
    ).to.deep.equal({ "token-list": "a b" });
    expect(dom.objToAttrs({ tokenList: ["a", 1] })).to.deep.equal({
      "token-list": null,
    });
  });
});

describe("dom: predicates and casing", () => {
  it("isNullish / isPrimitive / isPrimitiveConstructor", () => {
    expect(dom.isNullish(null)).to.equal(true);
    expect(dom.isNullish(undefined)).to.equal(true);
    expect(dom.isNullish(0)).to.equal(false);
    expect(dom.isNullish("")).to.equal(false);
    expect(dom.isPrimitive("string")).to.equal(true);
    expect(dom.isPrimitive("tokens")).to.equal(true);
    expect(dom.isPrimitive("object")).to.equal(false);
    expect(dom.isPrimitive(String)).to.equal(false);
    expect(dom.isPrimitiveConstructor(String)).to.equal(true);
    expect(dom.isPrimitiveConstructor(Number)).to.equal(true);
    expect(dom.isPrimitiveConstructor(Boolean)).to.equal(true);
    expect(dom.isPrimitiveConstructor(dom.TokenList)).to.equal(true);
    expect(dom.isPrimitiveConstructor(Array)).to.equal(false);
    expect(dom.isPrimitiveConstructor(Object)).to.equal(false);
    expect(dom.isPrimitiveConstructor("string")).to.equal(false);
  });

  it("dashToCamel / camelToDash round-trip", () => {
    expect(dom.dashToCamel("my-prop-name")).to.equal("myPropName");
    expect(dom.dashToCamel("plain")).to.equal("plain");
    expect(dom.camelToDash("myPropName")).to.equal("my-prop-name");
    expect(dom.camelToDash("plain")).to.equal("plain");
    expect(dom.dashToCamel(dom.camelToDash("someLongName"))).to.equal(
      "someLongName",
    );
  });

  it("TokenList is an Array marker type", () => {
    expect(Object.getPrototypeOf(dom.TokenList)).to.equal(Array);
    const list = dom.TokenList.from(["a", "b"]);
    expect(Array.isArray(list)).to.equal(true);
    expect([...list]).to.deep.equal(["a", "b"]);
    expect(dom.TokenList).to.not.equal(Array);
  });

  it("PropSerializer: default is identity, weak wraps in WeakRef", () => {
    const obj = { a: 1 };
    expect(dom.PropSerializer.dfault.serialize(obj)).to.equal(obj);
    expect(dom.PropSerializer.dfault.deserialize(obj)).to.equal(obj);
    const ref = dom.PropSerializer.weak.serialize(obj);
    expect(ref).to.be.instanceOf(WeakRef);
    expect(dom.PropSerializer.weak.deserialize(ref)).to.equal(obj);
    expect(dom.PropSerializer.weak.serialize(null)).to.equal(null);
    expect(dom.PropSerializer.weak.serialize(undefined)).to.equal(undefined);
    expect(dom.PropSerializer.weak.deserialize("plain")).to.equal("plain");
    expect(dom.PropSerializer.weak.deserialize(null)).to.equal(null);
  });
});
