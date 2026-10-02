import { afterAll, beforeAll, describe, expect, it, vi } from "@excom/heft-rig/node_modules/vitest";
import { createDom, type Dom } from "../../index";
import { originalPrototype } from "./helpers/happy-dom-original";

type Path = Event["composedPath"];

let dom: Dom;
let original: Path;
/** The tree's nodes by name: `labels()` names a path with them. */
let nodes: Record<string, EventTarget>;

const labels = (path: EventTarget[]) =>
  path.map((target) => Object.entries(nodes).find(([, node]) => node === target)?.[0] ?? "?");

beforeAll(async () => {
  original = (await originalPrototype<Event>("event/Event.js")).composedPath;
  dom = createDom({
    html: `<main id="main"><section id="open"></section><section id="closed"></section><p id="light">text<span id="leaf"></span></p>
      <form id="form"><input id="field"></form><template id="tpl"><i id="inert"></i></template></main>`,
  });
  const { document, window } = dom;
  const [open, closed] = [
    document.getElementById("open")!.attachShadow({ mode: "open" }),
    document.getElementById("closed")!.attachShadow({ mode: "closed" }),
  ];
  open.innerHTML = `<b id="in-open"></b><div id="nested-host"></div>`;
  closed.innerHTML = `<b id="in-closed"></b>`;
  const nested = open.getElementById("nested-host")!.attachShadow({ mode: "open" });
  nested.innerHTML = `<u id="in-nested"></u>`;
  const detached = document.createElement("div");
  detached.innerHTML = `<p><em id="in-detached"></em></p>`;
  const fragment = document.createDocumentFragment();
  fragment.append(document.createElement("a"));
  const [parent, child] = [new window.EventTarget(), new window.EventTarget()];
  Object.assign(child, { parentNode: parent });
  const byId = (id: string) => document.getElementById(id)!;
  nodes = {
    window,
    document,
    html: document.documentElement,
    body: document.body,
    main: byId("main"),
    light: byId("light"),
    text: byId("light").firstChild!,
    leaf: byId("leaf"),
    form: byId("form"),
    field: byId("field"),
    "template content": (byId("tpl") as HTMLTemplateElement).content,
    inert: (byId("tpl") as HTMLTemplateElement).content.firstElementChild!,
    "open host": byId("open"),
    "open root": open,
    "in-open": open.getElementById("in-open")!,
    "nested root": nested,
    "in-nested": nested.getElementById("in-nested")!,
    "closed root": closed,
    "in-closed": closed.getElementById("in-closed")!,
    detached,
    "in-detached": detached.querySelector("em")!,
    fragment,
    "in-fragment": fragment.firstChild!,
    "bare target": parent,
    "bare target with a parentNode": child,
  };
});
afterAll(() => dom.dispose());

const EVENTS: [name: string, type: string, init: EventInit][] = [
  ["plain", "x", {}],
  ["bubbling", "x", { bubbles: true }],
  ["composed", "x", { composed: true }],
  ["bubbling and composed", "x", { bubbles: true, composed: true }],
  ["load", "load", { composed: true }],
  ["load, bubbling", "load", { bubbles: true }],
];

describe("keepEventPaths", () => {
  it.each(EVENTS)("builds the path happy-dom builds from every node, for a %s event", (_, type, init) => {
    const mismatches: string[] = [];
    for (const [name, target] of Object.entries(nodes)) {
      const event = new dom.window.Event(type, init);
      const seen: string[][] = [];
      expect(labels(event.composedPath())).toEqual([]);
      target.addEventListener(
        type,
        (own) => {
          seen.push(labels(own.composedPath()), labels(original.call(own)));
        },
        { once: true },
      );
      target.dispatchEvent(event);
      // read during the dispatch, at the target, and after it
      seen.push(labels(event.composedPath()), labels(original.call(event)));
      if (seen[0].join() !== seen[1].join() || seen[2].join() !== seen[3].join()) mismatches.push(name);
      expect(seen[2][0], name).toBe(name);
    }
    expect(mismatches).toEqual([]);
  });

  it("goes by the shadow host for a composed event, and stops at the root for one that is not", () => {
    const path = (name: string, composed: boolean) => {
      const event = new dom.window.Event("x", { composed });
      nodes[name].dispatchEvent(event);
      return labels(event.composedPath());
    };
    expect(path("in-nested", true)).toEqual([
      "in-nested",
      "nested root",
      "?",
      "open root",
      "open host",
      "main",
      "body",
      "html",
      "document",
      "window",
    ]);
    expect(path("in-closed", true)).toEqual(["in-closed", "closed root", "?", "main", "body", "html", "document", "window"]);
    expect(path("in-open", false)).toEqual(["in-open", "open root"]);
    expect(path("in-detached", true)).toEqual(["in-detached", "?", "detached"]);
    expect(path("field", false)).toEqual(["field", "form", "main", "body", "html", "document", "window"]);
  });

  it("ends a load event at the document, any other at the window", () => {
    const last = (type: string) => {
      const event = new dom.window.Event(type);
      nodes.leaf.dispatchEvent(event);
      return labels(event.composedPath()).at(-1);
    };
    expect([last("load"), last("x")]).toEqual(["document", "window"]);
  });

  it("reads no public parentNode / parentElement getter, however deep the dispatch goes", () => {
    const { Node } = dom.window;
    const calls: string[] = [];
    for (const name of ["main", "document", "window"]) {
      nodes[name].addEventListener("walk", () => calls.push(name), { capture: true });
      nodes[name].addEventListener("walk", () => calls.push(name));
    }
    const event = new dom.window.Event("walk", { bubbles: true, composed: true });
    const [parentNode, parentElement] = [
      vi.spyOn(Node.prototype, "parentNode", "get"),
      vi.spyOn(Node.prototype, "parentElement", "get"),
    ];
    nodes["in-nested"].dispatchEvent(event);
    event.composedPath();
    const shimmed = [parentNode.mock.calls.length, parentElement.mock.calls.length];
    original.call(event);
    const originals = [parentNode.mock.calls.length - shimmed[0], parentElement.mock.calls.length];
    vi.restoreAllMocks();
    // capturing down to the target, then bubbling back up
    expect(calls).toEqual(["window", "document", "main", "main", "document", "window"]);
    expect(shimmed).toEqual([0, 0]);
    // what happy-dom's own reads: one more per level than the path is long
    expect(originals[0]).toBeGreaterThan(10);
  });
});
