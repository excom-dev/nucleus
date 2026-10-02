/**
 * Prerender + hydration (see `@excom/kit-utils` hydration.ts). A server
 * render (`__NUCLEUS_SSR__`) leaves row keys (`q-key`), source stamps
 * (`n-tpl`) and inert-script marks; a client whose hydration window is
 * open runs the same sheets over that markup and keeps it: no node, attribute
 * or text is rewritten. Server markup here comes from a real server render.
 */
import { Quark } from "../../index";
import { hashObject } from "@excom/hash-object";
import {
  bootHydration,
  holdHydration,
  htmlIdentity,
  HYDRATION_ISLAND_ID,
  INERT_ATTR,
  isHydrating,
  resetHydration,
  type ServerRender,
  SSR_ATTR,
  STAMP_ATTR,
  TEMPLATE_ID_ATTR,
} from "@excom/kit-utils";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/nucleus-test";
import { reqCommit } from "../../src/paint";
import { isQuarkBusy } from "../../src/settle";
import {
  createSheet,
  flush,
  installViewTransitionStub,
  unregisterAll,
} from "./helpers";

const g = globalThis as { __NUCLEUS_SSR__?: ServerRender };
const originalLoader = Quark.moduleLoader;

/** Open the window as a prerendered page does: `<html n-ssr>`, its island in the document. */
const bootIsland = () => {
  document.documentElement.setAttribute(SSR_ATTR, "");
  fixture(
    `<script type="application/json" id="${HYDRATION_ISLAND_ID}">{"v":1,"provisions":{},"responses":[]}</script>`
  );
  bootHydration();
};

/** An open window that outlasts the test (cases that are not about its timing). */
const hydrating = () => {
  bootIsland();
  holdHydration(new Promise(() => {}));
};

/** Render as the prerenderer does; the markup it would serialize (no `q-scope`). */
const prerender = async (
  body: string,
  src: string,
  setup?: (root: HTMLElement) => void
) => {
  g.__NUCLEUS_SSR__ = { responses: [] };
  try {
    const { root, register } = createSheet(body, src);
    setup?.(root);
    register();
    await flush();
    // drops the hosts' scope markers too
    unregisterAll();
    return root.outerHTML;
  } finally {
    delete g.__NUCLEUS_SSR__;
    document.body.innerHTML = "";
  }
};

/** Server markup in the document, its sheet ready to register. */
const fromMarkup = (
  markup: string,
  src: string,
  setup?: (root: HTMLElement) => void
) => {
  const root = fixture<HTMLElement>(markup);
  setup?.(root);
  const quark = new Quark({ src, options: { isScoped: true } });
  const register = () =>
    quark.register({ sheetElement: root.querySelector("#sheet")! });
  return { root, quark, register };
};

/** kit-utils `_select` tags a scope element for a moment to resolve `:scope`. */
const SELECT_TAG = /^n-util-select-id-/;

/**
 * Mutations below `root` from now on, aside from Quark's host marker
 * (`q-scope`) and `_select`'s momentary tag (checked to be gone again).
 */
const watch = (root: Element) => {
  const records: MutationRecord[] = [];
  const keep = (list: MutationRecord[]) =>
    records.push(
      ...list.filter(
        (r) =>
          r.attributeName !== "q-scope" &&
          !SELECT_TAG.test(r.attributeName ?? "")
      )
    );
  const observer = new MutationObserver(keep);
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  return () => {
    keep(observer.takeRecords());
    const tagged = [root, ...root.querySelectorAll("*")].flatMap((el) =>
      el.getAttributeNames().filter((name) => SELECT_TAG.test(name))
    );
    expect(tagged).toEqual([]);
    return records;
  };
};

const isSame = (a: Node[], b: Node[]) =>
  a.length === b.length && a.every((node, i) => node === b[i]);

const texts = (root: ParentNode, selector: string) =>
  [...root.querySelectorAll(selector)].map((el) => el.textContent);

/** Window and engine state at each macrotask, until the window closes. */
const sampleTicks = async (limit = 50) => {
  const ticks: { busy: boolean; open: boolean }[] = [];
  while (isHydrating() && ticks.length < limit) {
    await wait(0);
    ticks.push({ busy: isQuarkBusy(), open: isHydrating() });
  }
  return ticks;
};

beforeEach(() => {
  resetHydration();
});

afterEach(() => {
  unregisterAll();
  resetHydration();
  delete g.__NUCLEUS_SSR__;
  Quark.moduleLoader = originalLoader;
  document.documentElement.removeAttribute(SSR_ATTR);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("iterate() rows", () => {
  // row rules first: they run on server rows before iterate() adopts them
  // `data-index`: a number, equal to the server's "0" / "1" / "2" once written
  const SHEET = `
    [bind-name] { content: item.name; data-index: index; }
    [bind-tag] { content: item; }
    [bind-tags] { content: iterate(item.tags); }
    [bind-list] { content: iterate(prop("rows"), ":scope > template", "id"); }
    [bind-word] { content: "#{index}: #{item}"; }
    [bind-words] { content: iterate(prop("words")); }
  `;
  const BODY = `<ul bind-list><template><li><b bind-name></b><ol bind-tags><template><li bind-tag></li></template></ol></li></template></ul><ul bind-words><template><li bind-word></li></template></ul>`;
  const ROWS = [
    { id: 1, name: "One", tags: ["a", "b", "a"] },
    { id: 2, name: "Two", tags: [] },
    { id: 10, name: "Ten", tags: ["c"] },
  ];
  const WORDS = ["x", "y", "x"];
  /** Data as a prerendered page restores it: through JSON. */
  const provide = (root: HTMLElement) => {
    const [list, words] = root.querySelectorAll("ul");
    Object.assign(list, { rows: JSON.parse(JSON.stringify(ROWS)) });
    Object.assign(words, { words: [...WORDS] });
  };

  it("a server render keys every row as text", async () => {
    const root = fixture(await prerender(BODY, SHEET, provide));
    const keys = (selector: string) =>
      [...root.querySelectorAll(selector)].map((r) => r.getAttribute("q-key"));
    expect(keys("[bind-list] > li")).toEqual(["1", "2", "10"]);
    expect(keys("[bind-tags] > li")).toEqual(
      ["a", "b", "a", "c"].map((tag) => hashObject(tag))
    );
    expect(keys("[bind-words] > li")).toEqual(
      WORDS.map((word) => hashObject(word))
    );
    expect(texts(root, "[bind-word]")).toEqual(["0: x", "1: y", "2: x"]);
  });

  it("hydrating, keeps keyed, keyless and nested rows as they are", async () => {
    const error = vi.spyOn(console, "error");
    const markup = await prerender(BODY, SHEET, provide);
    const server = document.createElement("div");
    server.innerHTML = markup;
    hydrating();
    const { root, register } = fromMarkup(markup, SHEET, provide);
    const nodes = [...root.querySelectorAll("ul *")];
    const records = watch(root);
    register();
    await flush();
    expect(records()).toEqual([]);
    expect(isSame([...root.querySelectorAll("ul *")], nodes)).toBe(true);
    const lists = (el: Element) =>
      [...el.querySelectorAll("ul")].map((list) => list.outerHTML);
    expect(lists(root)).toEqual(lists(server));
    expect(texts(root, "[bind-tag]")).toEqual(["a", "b", "a", "c"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("adopted rows carry their loop data: a later change reuses them", async () => {
    const markup = await prerender(BODY, SHEET, provide);
    hydrating();
    const { root, register } = fromMarkup(markup, SHEET, provide);
    const [one, , ten] = root.querySelectorAll("[bind-list] > li");
    const [x] = root.querySelectorAll("[bind-words] > li");
    register();
    await flush();
    const [list, words] = root.querySelectorAll("ul");
    Object.assign(list, {
      rows: [
        { id: 10, name: "Ten!", tags: ["c"] },
        { id: 1, name: "One", tags: ["a", "b", "a"] },
      ],
    });
    Object.assign(words, { words: ["x"] });
    await flush();
    const rows = [...root.querySelectorAll("[bind-list] > li")];
    expect(isSame(rows, [ten, one])).toBe(true);
    expect(texts(root, "[bind-name]")).toEqual(["Ten!", "One"]);
    expect(isSame([...root.querySelectorAll("[bind-words] > li")], [x])).toBe(
      true
    );
  });

  it("hydrating, a server row's rules wait for iterate() to adopt it", async () => {
    // no iterate() here: server rows keep their paint, client rows read nothing
    hydrating();
    const { root, register } = createSheet(
      `<ul q-loop><template><li></li></template><li q-key="1"><b bind-name>One</b></li></ul>
       <ol q-loop><li><b bind-name>Client</b></li></ol>`,
      `[bind-name] { content: item.name; }`
    );
    register();
    await flush();
    expect(texts(root, "[bind-name]")).toEqual(["One", ""]);
  });

  it("outside the window, a row with a q-key is an ordinary child, re-rendered", async () => {
    // a copied server row on a client-only page, as after the window
    const markup = await prerender(BODY, SHEET, provide);
    const { root, register } = fromMarkup(markup, SHEET, provide);
    const [one] = root.querySelectorAll("[bind-list] > li");
    register();
    await flush();
    expect(root.querySelector("[bind-list] > li")).not.toBe(one);
    expect(texts(root, "[bind-name]")).toEqual(["One", "Two", "Ten"]);
  });

  it("hydrating, a sheet inside an adopted row reads its item at once", async () => {
    // the iterating sheet waits on @use: the rows' own sheets run first
    const LIST = `@use "/rows" as *;
      [bind-list] { content: iterate(rows(), ":scope > template", "id"); }`;
    const ROW = `[bind-name] { content: item.name; }`;
    const BODY = `<ul bind-list><template><li><div data-sheet></div><b bind-name></b></li></template></ul>`;
    const registerRows = (root: Element) =>
      root.querySelectorAll("[bind-list] > li > [data-sheet]").forEach((at) =>
        new Quark({ src: ROW, options: { isScoped: true } }).register({
          sheetElement: at as HTMLElement,
        })
      );
    Quark.moduleLoader = async () => ({
      rows: () => [
        { id: 1, name: "One" },
        { id: 2, name: "Two" },
      ],
    });
    g.__NUCLEUS_SSR__ = { responses: [] };
    const server = createSheet(BODY, LIST);
    server.register();
    await flush();
    // rows' sheets mount once their rows are in
    registerRows(server.root);
    await flush();
    unregisterAll();
    const markup = server.root.outerHTML;
    delete g.__NUCLEUS_SSR__;
    document.body.innerHTML = "";
    expect(markup).toContain(`<b bind-name="">One</b>`);
    let answer!: (module: Record<string, unknown>) => void;
    Quark.moduleLoader = () => new Promise((resolve) => (answer = resolve));
    hydrating();
    const { root, register } = fromMarkup(markup, LIST);
    register();
    registerRows(root);
    await flush();
    expect(texts(root, "[bind-name]")).toEqual(["One", "Two"]);
    answer({ rows: () => [{ id: 1, name: "Uno" }] });
    await flush();
    expect(isHydrating()).toBe(true);
    expect(texts(root, "[bind-name]")).toEqual(["Uno"]);
  });

  it("hydrating, another sheet over the list reads adopted rows' items at once", async () => {
    const LIST = `@use "/rows" as *;
      [bind-list] { content: iterate(rows(), ":scope > template", "id"); }`;
    const READER = `[bind-name] { content: item.name; }`;
    const BODY = `<div data-reader></div><ul bind-list><template><li><b bind-name></b></li></template></ul>`;
    const registerReader = (root: Element) =>
      new Quark({ src: READER, options: { isScoped: true } }).register({
        sheetElement: root.querySelector("[data-reader]") as HTMLElement,
      });
    Quark.moduleLoader = async () => ({
      rows: () => [
        { id: 1, name: "One" },
        { id: 2, name: "Two" },
      ],
    });
    const markup = await prerender(BODY, LIST, registerReader);
    expect(texts(fixture(markup), "[bind-name]")).toEqual(["One", "Two"]);
    document.body.innerHTML = "";
    let answer!: (module: Record<string, unknown>) => void;
    Quark.moduleLoader = () => new Promise((resolve) => (answer = resolve));
    hydrating();
    const { root, register } = fromMarkup(markup, LIST);
    register();
    registerReader(root);
    await flush();
    answer({ rows: () => [{ id: 1, name: "Uno" }] });
    await flush();
    expect(isHydrating()).toBe(true);
    expect(texts(root, "[bind-name]")).toEqual(["Uno"]);
  });

  it("a client-only render writes no row keys", async () => {
    const { root, register } = createSheet(BODY, SHEET);
    provide(root);
    register();
    await flush();
    expect(texts(root, "[bind-name]")).toEqual(["One", "Two", "Ten"]);
    expect(root.querySelector("[q-key]")).toBeNull();
  });
});

describe("template() and dangerous-html() paints", () => {
  const SHEET = `
    [bind-card] { content: template(); }
    [bind-html] { content: dangerous-html("<b>bold</b><script>void 0</script>"); }
  `;
  const BODY = `<div bind-card><template><p>card</p></template></div><div bind-html></div>`;
  const HTML = "<b>bold</b><script>void 0</script>";

  it("a server render stamps both sources and marks inserted scripts inert", async () => {
    const root = fixture(await prerender(BODY, SHEET));
    const card = root.querySelector("[bind-card]")!;
    const id = card.querySelector("template")!.getAttribute(TEMPLATE_ID_ATTR);
    expect(id).toBeTruthy();
    expect(card.getAttribute(STAMP_ATTR)).toBe(`#${id}`);
    const html = root.querySelector("[bind-html]")!;
    expect(html.getAttribute(STAMP_ATTR)).toBe(htmlIdentity(HTML));
    expect(html.querySelector("script")!.hasAttribute(INERT_ATTR)).toBe(true);
  });

  it("a client-only render stamps and marks nothing", async () => {
    const { root, register } = createSheet(BODY, SHEET);
    register();
    await flush();
    expect(root.querySelector("p")?.textContent).toBe("card");
    expect(root.querySelector("script")).not.toBeNull();
    const marks = [STAMP_ATTR, TEMPLATE_ID_ATTR, INERT_ATTR];
    expect(root.querySelector(marks.map((m) => `[${m}]`).join())).toBeNull();
  });

  it("hydrating, adopts a host stamped with the same source", async () => {
    const markup = await prerender(BODY, SHEET);
    hydrating();
    const { root, register } = fromMarkup(markup, SHEET);
    const nodes = [...root.querySelectorAll("[bind-card] > p, [bind-html] *")];
    const records = watch(root);
    register();
    await flush();
    expect(records()).toEqual([]);
    expect(
      isSame([...root.querySelectorAll("[bind-card] > p, [bind-html] *")], nodes)
    ).toBe(true);
    expect(root.querySelectorAll(`[${STAMP_ATTR}]`)).toHaveLength(2);
  });

  it("replaces a host stamped with another source, and drops the stamp", async () => {
    const markup = (await prerender(BODY, SHEET)).replace(
      /n-tpl="([^"]*)"/g,
      'n-tpl="$1-stale"'
    );
    hydrating();
    const { root, register } = fromMarkup(markup, SHEET);
    const p = root.querySelector("[bind-card] > p");
    const b = root.querySelector("[bind-html] > b");
    register();
    await flush();
    expect(root.querySelector("[bind-card] > p")).not.toBe(p);
    expect(root.querySelector("[bind-html] > b")).not.toBe(b);
    expect(root.querySelector(`[${STAMP_ATTR}]`)).toBeNull();
    expect(texts(root, "[bind-card] > p, [bind-html] > b")).toEqual([
      "card",
      "bold",
    ]);
  });

  it("replaces once the window is closed, even when the stamp matches", async () => {
    const markup = await prerender(BODY, SHEET);
    const { root, register } = fromMarkup(markup, SHEET);
    const p = root.querySelector("[bind-card] > p");
    const b = root.querySelector("[bind-html] > b");
    register();
    await flush();
    expect(root.querySelector("[bind-card] > p")).not.toBe(p);
    expect(root.querySelector("[bind-html] > b")).not.toBe(b);
    expect(root.querySelector(`[${STAMP_ATTR}]`)).toBeNull();
  });

  it("a server text paint or wipe over a stamped host drops the stamp", async () => {
    g.__NUCLEUS_SSR__ = { responses: [] };
    const { root, register } = createSheet(
      `<div bind-x></div><div bind-y></div>`,
      `[bind-x]:not([data-text]), [bind-y]:not([data-none]) { content: dangerous-html("<b>x</b>"); }
       [bind-x][data-text] { content: "plain"; }
       [bind-y][data-none] { content: none; }`
    );
    register();
    await flush();
    const [x, y] = root.querySelectorAll("[bind-x], [bind-y]");
    expect(x.getAttribute(STAMP_ATTR)).toBe(htmlIdentity("<b>x</b>"));
    expect(y.getAttribute(STAMP_ATTR)).toBe(htmlIdentity("<b>x</b>"));
    x.setAttribute("data-text", "");
    y.setAttribute("data-none", "");
    await flush();
    expect([x.textContent, y.textContent]).toEqual(["plain", ""]);
    // a later hydration must not take this content for the html's
    expect(root.querySelector(`[${STAMP_ATTR}]`)).toBeNull();
  });

  it("hydrating, an html paint of a number or a boolean has its own identity", async () => {
    const SHEET = `[bind-n] { content: dangerous-html(prop("n")); }
      [bind-b] { content: dangerous-html(prop("b")); }`;
    const provide = (n: number, b: boolean) => (root: HTMLElement) => {
      Object.assign(root.querySelector("[bind-n]")!, { n });
      Object.assign(root.querySelector("[bind-b]")!, { b });
    };
    const markup = await prerender(
      `<p bind-n></p><p bind-b></p>`,
      SHEET,
      provide(5, true)
    );
    expect(markup).toContain(`${STAMP_ATTR}="${htmlIdentity("5")}"`);
    hydrating();
    const { root, register } = fromMarkup(markup, SHEET, provide(5, false));
    const five = root.querySelector("[bind-n]")!.firstChild;
    register();
    await flush();
    expect(root.querySelector("[bind-n]")!.firstChild).toBe(five);
    expect(root.querySelector("[bind-b]")!.textContent).toBe("false");
  });

  it("hydrating, html that differs only in whitespace or entities replaces", async () => {
    const markup = await prerender(
      `<p bind-h></p><p bind-e></p>`,
      `[bind-h] { content: dangerous-html("<b>x</b>"); }
       [bind-e] { content: dangerous-html("<b>a&amp;b</b>"); }`
    );
    hydrating();
    const { root, register } = fromMarkup(
      markup,
      `[bind-h] { content: dangerous-html(" <b>x</b>"); }
       [bind-e] { content: dangerous-html("<b>a&b</b>"); }`
    );
    const [x, ab] = root.querySelectorAll("b");
    register();
    await flush();
    const [x2, ab2] = root.querySelectorAll("b");
    expect(x2).not.toBe(x);
    expect(ab2).not.toBe(ab);
    expect(root.querySelector(`[${STAMP_ATTR}]`)).toBeNull();
  });

  it("a server render marks scripts in the html's templates and in a template host", async () => {
    const root = fixture(
      await prerender(
        `<div bind-h></div><template bind-t></template>`,
        `[bind-h] { content: dangerous-html("<b>x</b><template><script>void 1</script></template>"); }
         [bind-t] { content: dangerous-html("<i>y</i><script>void 2</script>"); }`
      )
    );
    const scriptIn = (selector: string) =>
      root
        .querySelector<HTMLTemplateElement>(selector)!
        .content.querySelector("script")!;
    // cloned later, these run once the page is parsed: the serializer
    // neutralizes them as it does inserted scripts
    expect(scriptIn("[bind-h] template").hasAttribute(INERT_ATTR)).toBe(true);
    expect(scriptIn("template[bind-t]").hasAttribute(INERT_ATTR)).toBe(true);
    // a template host is never adopted: no stamp
    expect(root.querySelector("template[bind-t]")!.hasAttribute(STAMP_ATTR)).toBe(
      false
    );
  });
});

describe("the window and Quark's own follow-up work", () => {
  // nested paints run in the pass requeued after iterate() adopts the rows
  const SHEET = `
    [bind-list] { content: iterate(prop("rows"), ":scope > template", "id"); }
    [bind-body] { content: dangerous-html(item.html); }
    [bind-card] { content: template(); }
  `;
  const BODY = `<ul bind-list><template><li><div bind-body></div><div bind-card><template><i>card</i></template></div></li></template></ul>`;
  const provide = (root: HTMLElement) =>
    Object.assign(root.querySelector("ul")!, {
      rows: [
        { id: 1, html: "<b>one</b>" },
        { id: 2, html: "<b>two</b>" },
      ],
    });

  it("adopts nested paints of adopted rows, open only by Quark's own work", async () => {
    const markup = await prerender(BODY, SHEET, provide);
    expect(markup.match(/n-tpl="/g)).toHaveLength(4);
    bootIsland();
    const { root, register } = fromMarkup(markup, SHEET, provide);
    const nodes = [...root.querySelectorAll("ul *")];
    const records = watch(root);
    register();
    await flush();
    expect(records()).toEqual([]);
    expect(isSame([...root.querySelectorAll("ul *")], nodes)).toBe(true);
    expect(root.querySelectorAll(`[${STAMP_ATTR}]`)).toHaveLength(4);
  });

  it("closes two quiet ticks after Quark is idle, a pending @delay aside", async () => {
    const markup = await prerender(BODY, SHEET, provide);
    bootIsland();
    const { root, quark, register } = fromMarkup(
      markup,
      `${SHEET} [bind-list] { @delay 60000 { data-late: ""; } }`,
      provide
    );
    register();
    const ticks = await sampleTicks();
    const lastBusy = ticks.map((tick) => tick.busy).lastIndexOf(true);
    const closedAt = ticks.findIndex((tick) => !tick.open);
    // held while the adopted rows' passes and commits ran, not after
    expect(lastBusy).toBeGreaterThan(0);
    expect(ticks.slice(0, lastBusy + 1).every((tick) => tick.open)).toBe(true);
    expect(closedAt).toBeGreaterThan(lastBusy);
    expect(closedAt - lastBusy).toBeLessThanOrEqual(3);
    // the delay neither held the window nor was dropped: still scheduled
    expect(root.querySelector("[data-late]")).toBeNull();
    expect(quark.delayTimers.size).toBe(1);
  });

  it("releases a pass's or a commit's hold even when it throws", async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      bootIsland();
      const { root, quark, register } = createSheet(
        `<p bind-x></p>`,
        `[bind-x] { data-x: "1"; }`
      );
      register();
      vi.spyOn(quark, "runRules").mockImplementation(() => {
        throw new Error("pass");
      });
      quark.queueRunRules({ element: root, attribute: "NEW_SELF" });
      reqCommit(() => {
        throw new Error("commit");
      });
      const errors: string[] = [];
      while (isHydrating() && Date.now() - start < 1000) {
        await vi
          .advanceTimersToNextTimerAsync()
          .catch((error) => errors.push(String(error)));
      }
      expect(errors.sort()).toEqual(["Error: commit", "Error: pass"]);
      // closed by its probes, not by the 10 s deadline
      expect(isHydrating()).toBe(false);
      expect(Date.now() - start).toBeLessThan(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a view transition whose update never comes commits by its fallback", async () => {
    const markup = await prerender(
      `<h1 bind-title>Old</h1><div bind-card><template><p>card</p></template></div>`,
      `[bind-card] { content: template(); }`
    );
    const stub = installViewTransitionStub({ autoUpdate: false });
    vi.useFakeTimers();
    try {
      bootIsland();
      const { root, register } = fromMarkup(
        markup,
        `@view-transition (first-render) { [bind-title] { content: "New"; } }
         [bind-card] { content: template(); }`
      );
      const p = root.querySelector("[bind-card] > p");
      register();
      await vi.advanceTimersByTimeAsync(999);
      expect(stub.calls).toHaveLength(1);
      expect(root.querySelector("h1")!.textContent).toBe("Old");
      expect(isHydrating()).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(root.querySelector("h1")!.textContent).toBe("New");
      // committed inside the window: the card was adopted
      expect(root.querySelector("[bind-card] > p")).toBe(p);
      await vi.advanceTimersByTimeAsync(10);
      expect(isHydrating()).toBe(false);
    } finally {
      vi.useRealTimers();
      stub.calls.forEach((call) => call.skipTransition());
      stub.restore();
    }
  });

  it("stays open until a view transition commits its cut", async () => {
    const markup = await prerender(
      `<h1 bind-title>Old</h1><div bind-card><template><p>card</p></template></div>`,
      `[bind-card] { content: template(); }`
    );
    const stub = installViewTransitionStub({ autoUpdate: false });
    try {
      bootIsland();
      const { root, register } = fromMarkup(
        markup,
        `@view-transition (first-render) { [bind-title] { content: "New"; } }
         [bind-card] { content: template(); }`
      );
      const p = root.querySelector("[bind-card] > p");
      register();
      // the title starts a transition; the card waits in its cut
      await wait(30);
      expect(stub.calls).toHaveLength(1);
      expect(isHydrating()).toBe(true);
      await stub.calls[0].runUpdate();
      await flush();
      expect(root.querySelector("h1")!.textContent).toBe("New");
      expect(root.querySelector("[bind-card] > p")).toBe(p);
      await sampleTicks();
      expect(isHydrating()).toBe(false);
    } finally {
      // a cut left pending would hold later tests' paints
      await Promise.all(stub.calls.map((call) => call.runUpdate()));
      stub.restore();
    }
  });

  // after one quiet tick an unheld window closes on the next: work an
  // outside change starts then must hold it
  it("holds it for a pass the observer queues after a quiet tick", async () => {
    bootIsland();
    const { root, register } = createSheet(
      `<p bind-x></p>`,
      `[bind-x][data-on] { data-seen: seen(); }`,
      { seen: () => (isHydrating() ? "open" : "closed") }
    );
    register();
    await wait(0);
    expect(isHydrating()).toBe(true);
    const p = root.querySelector("p")!;
    p.setAttribute("data-on", "");
    await flush();
    expect(p.getAttribute("data-seen")).toBe("open");
  });

  it("holds it for a commit an outside write schedules after a quiet tick", async () => {
    const BODY = `<div bind-card><template><p>card</p></template></div>`;
    const SHEET = `[bind-card] { content: if($show: template(); else: preserve); }`;
    const markup = await prerender(BODY, SHEET, (root) =>
      root.quark.setProperty("show", true)
    );
    bootIsland();
    const { root, register } = fromMarkup(markup, SHEET);
    const p = root.querySelector("[bind-card] > p");
    register();
    await wait(0);
    expect(isHydrating()).toBe(true);
    // re-runs the reader at once: its paint commits a tick later
    root.quark.setProperty("show", true);
    await flush();
    expect(root.querySelector("[bind-card] > p")).toBe(p);
  });
});

describe("what a hydrating run kept, once the window closes", () => {
  it("runs it again with cold semantics: an unbound binding is undefined", async () => {
    // server and cold mount: `$user` unbound, so "Guest"
    const SHEET = `:scope { $label: $user or "Guest"; }
      [bind-a][data-k] { content: $label; }`;
    const markup = await prerender(`<p bind-a data-k="1"></p>`, SHEET);
    expect(markup).toContain(">Guest</p>");
    bootIsland();
    const { root, register } = fromMarkup(markup, SHEET);
    register();
    await sampleTicks();
    expect(isHydrating()).toBe(false);
    await flush();
    // a later re-run reads the def the close re-ran, not an unbound name
    const p = root.querySelector("p")!;
    p.setAttribute("data-k", "2");
    await flush();
    expect(p.textContent).toBe("Guest");
  });

  it("drops it for elements gone or sheets unregistered by then", async () => {
    bootIsland();
    let release!: () => void;
    holdHydration(new Promise<void>((resolve) => (release = resolve)));
    const a = createSheet(
      `<p bind-x>kept</p><p bind-x>kept</p>`,
      `[bind-x] { content: $missing; }`
    );
    const b = createSheet(`<p bind-y>kept</p>`, `[bind-y] { content: $missing; }`);
    a.register();
    b.register();
    await flush();
    expect(texts(document, "[bind-x], [bind-y]")).toEqual(["kept", "kept", "kept"]);
    expect([a.quark.pendingReads.size, b.quark.pendingReads.size]).toEqual([
      2, 1,
    ]);
    const [gone, stays] = a.root.querySelectorAll("p");
    gone.remove();
    b.quark.unregister();
    expect(b.quark.pendingReads.size).toBe(0);
    const reruns = vi.spyOn(a.quark, "runElement");
    release();
    await sampleTicks();
    await flush();
    expect(reruns.mock.calls.map(([element]) => element)).toEqual([stays]);
    expect(a.quark.pendingReads.size).toBe(0);
    // cold semantics: `$missing` is undefined, a wipe
    expect(stays.textContent).toBe("");
  });

  it("keeps nothing outside a window: nothing would come back to it", () => {
    // a close re-run that read pending again would otherwise loop forever
    const { root, quark, register } = createSheet(
      `<p bind-x></p>`,
      `[bind-x] { content: $later; }`
    );
    register();
    const [property] = quark.rules[0].attributes;
    quark.trackPendingRead(root.querySelector("p")!, property, true);
    expect(quark.pendingReads.size).toBe(0);
  });

  it("forgets it once the declaration resolves inside the window", async () => {
    bootIsland();
    holdHydration(new Promise(() => {}));
    const { root, quark, register } = createSheet(
      `<p bind-x>kept</p>`,
      `[bind-x] { content: $later; }`
    );
    register();
    await flush();
    expect(quark.pendingReads.size).toBe(1);
    root.quark.setProperty("later", "now");
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("now");
    expect(quark.pendingReads.size).toBe(0);
  });
});

describe("attributes a server painted", () => {
  it("hydrating, an equal dataset key is owned: dropped later, it is removed", async () => {
    const SHEET = `[bind-d] { dataset: prop("d"); }`;
    const provide = (d: Record<string, string>) => (root: HTMLElement) =>
      Object.assign(root.querySelector("p")!, { d });
    const markup = await prerender(
      `<p bind-d></p>`,
      SHEET,
      provide({ a: "1", b: "2" })
    );
    expect(markup).toContain(`data-b="2"`);
    hydrating();
    const { root, register } = fromMarkup(
      markup,
      SHEET,
      provide({ a: "1", b: "2" })
    );
    register();
    await flush();
    const p = root.querySelector("p")!;
    Object.assign(p, { d: { a: "3" } });
    await flush();
    expect(p.getAttribute("data-a")).toBe("3");
    expect(p.hasAttribute("data-b")).toBe(false);
  });
});

describe("bindings a slow @use sheet writes", () => {
  // sheet A (outer) waits on @use and writes; sheet B (inner) reads
  const SHEET_A = `@use "/names" as *;
    :scope { $name: name(); $items: items(); $show: true; }`;
  const SHEET_B = `
    [bind-title] { content: "Hi #{$name}"; title: "Hi #{$name}"; }
    [bind-name] { content: $name; }
    [bind-item] { content: item; }
    [bind-list] { content: iterate($items); }
    [bind-card] { content: if($show: template(); else: none); }
  `;
  const PAGE = `<section><div id="sheet-a"></div><article><div id="sheet-b"></div><h1 bind-title></h1><p bind-name></p><ul bind-list><template><li bind-item></li></template></ul><div bind-card><template><i>card</i></template></div></article></section>`;
  const MODULE = { name: () => "Joe", items: () => ["x", "y"] };

  const register = (root: Element) => {
    const sheets = [
      [SHEET_A, "#sheet-a"],
      [SHEET_B, "#sheet-b"],
    ].map(([src, at]) => {
      const quark = new Quark({ src, options: { isScoped: true } });
      return () => quark.register({ sheetElement: root.querySelector(at)! });
    });
    // document order: A waits on its module, B runs at once
    sheets.forEach((run) => run());
  };

  const prerenderPage = async () => {
    Quark.moduleLoader = async () => MODULE;
    g.__NUCLEUS_SSR__ = { responses: [] };
    try {
      const root = fixture(PAGE);
      register(root);
      await flush();
      unregisterAll();
      return root.outerHTML;
    } finally {
      delete g.__NUCLEUS_SSR__;
      document.body.innerHTML = "";
    }
  };

  /** The module loader answers when the test says so. */
  const slowModule = () => {
    let answer!: (module: Record<string, unknown>) => void;
    Quark.moduleLoader = () => new Promise((resolve) => (answer = resolve));
    return (module: Record<string, unknown>) => answer(module);
  };

  const snapshot = (root: Element) => ({
    title: root.querySelector("h1")!.getAttribute("title"),
    texts: texts(root, "h1, [bind-name], [bind-item], [bind-card] > i"),
  });

  const SERVER_STATE = {
    title: "Hi Joe",
    texts: ["Hi Joe", "Joe", "x", "y", "card"],
  };

  it("hydrating, keeps the server's paint while the module loads, inside the window", async () => {
    const markup = await prerenderPage();
    expect(snapshot(fixture(markup))).toEqual(SERVER_STATE);
    document.body.innerHTML = "";
    const answer = slowModule();
    bootIsland();
    const root = fixture(markup);
    const article = root.querySelector("article")!;
    const nodes = [...article.querySelectorAll("*")];
    const records = watch(article);
    register(root);
    // past the window's two quiet macrotasks: the module load holds it
    await wait(30);
    expect(isHydrating()).toBe(true);
    expect(records()).toEqual([]);
    let openAtFirstRun = false;
    answer({
      ...MODULE,
      name: () => {
        openAtFirstRun = isHydrating();
        return "Joe";
      },
    });
    await flush();
    expect(openAtFirstRun).toBe(true);
    expect(records()).toEqual([]);
    expect(isSame([...article.querySelectorAll("*")], nodes)).toBe(true);
    expect(snapshot(root)).toEqual(SERVER_STATE);
  });

  it("hydrating, repaints from the module's values once it loads", async () => {
    const markup = await prerenderPage();
    const answer = slowModule();
    bootIsland();
    const root = fixture(markup);
    const [, y] = root.querySelectorAll("[bind-item]");
    const card = root.querySelector("[bind-card] > i");
    register(root);
    await wait(30);
    expect(snapshot(root)).toEqual(SERVER_STATE);
    answer({ name: () => "Ann", items: () => ["y", "z"] });
    await flush();
    expect(snapshot(root)).toEqual({
      title: "Hi Ann",
      texts: ["Hi Ann", "Ann", "y", "z", "card"],
    });
    expect(root.querySelector("[bind-item]")).toBe(y);
    expect(root.querySelector("[bind-card] > i")).toBe(card);
  });

  it("without an island, renders as today: wiped while the module loads", async () => {
    const markup = await prerenderPage();
    const answer = slowModule();
    const root = fixture(markup);
    const [x] = root.querySelectorAll("[bind-item]");
    register(root);
    await wait(30);
    expect(isHydrating()).toBe(false);
    expect(snapshot(root)).toEqual({ title: "Hi ", texts: ["Hi ", ""] });
    answer(MODULE);
    await flush();
    expect(snapshot(root)).toEqual(SERVER_STATE);
    expect(root.querySelector("[bind-item]")).not.toBe(x);
  });
});
