import { afterEach, beforeEach, describe, expect, it } from "@excom/heft-rig/node_modules/vitest";
import { createDom, installShims } from "../../index";

type Setup = () => { document: Document; dispose: () => Promise<void> };

const SETUPS: Record<string, Setup> = {
  "createDom()": () => createDom(),
  "installShims(globalThis)": () => {
    installShims(globalThis);
    return { document, dispose: async () => document.body.replaceChildren() };
  },
};

describe.each(Object.keys(SETUPS))("querySelector(All) on %s", (setup) => {
  let dom: ReturnType<Setup>;
  const mount = <T extends Element>(html: string): T => {
    const wrapper = dom.document.createElement("div");
    wrapper.innerHTML = html;
    dom.document.body.append(wrapper);
    return wrapper.firstElementChild as T;
  };

  beforeEach(() => {
    dom = SETUPS[setup]();
  });
  afterEach(() => dom.dispose());

  it("matches against the document but never returns the context element", () => {
    const root = mount(
      `<section class="a"><p class="a">inner</p><div><p class="a">deep</p></div></section>`,
    );
    dom.document.body.insertAdjacentHTML("afterbegin", `<p class="a">outside</p>`);
    expect(root.querySelector(".a")!.textContent).toBe("inner");
    expect(root.querySelectorAll(".a")).toHaveLength(2);
    expect(root.querySelector("section")).toBeNull();
    expect(root.querySelector("nothing")).toBeNull();
    // Ancestor compounds outside the element take part.
    expect(root.querySelector("body > div > section > div > p")!.textContent).toBe("deep");
    expect(root.querySelector("div p")!.textContent).toBe("inner");
    expect(root.querySelector("body > p")).toBeNull();
  });

  it("resolves :scope against the context element and removes its marker", () => {
    const root = mount(`<ul><li>1<ul><li>nested</li></ul></li><li>2</li></ul>`);
    expect(root.querySelectorAll(":scope > li")).toHaveLength(2);
    expect(root.querySelector(":scope > li")!.textContent).toBe("1nested");
    expect(root.attributes).toHaveLength(0);
  });

  it("matches within a shadow tree, never across its boundary", () => {
    const host = mount(`<div></div>`);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<article><ul><li>1<ul><li>nested</li></ul></li><li>2</li></ul></article>`;
    const list = shadow.querySelector("ul")!;
    expect(list.querySelectorAll(":scope > li")).toHaveLength(2);
    expect(list.querySelector("article li")!.textContent).toBe("1nested");
    expect(list.querySelector("body li")).toBeNull();
    expect(list.attributes).toHaveLength(0);
  });

  it("finds form controls that happy-dom's contains() misses", () => {
    const form = mount<HTMLFormElement>(
      `<form><fieldset><input name="a"></fieldset><input name="b"></form>`,
    );
    expect(form.querySelectorAll("input")).toHaveLength(2);
    expect(form.querySelector("fieldset input")!.getAttribute("name")).toBe("a");
  });

  it("keeps happy-dom's subtree query for offline trees", () => {
    const div = dom.document.createElement("div");
    div.innerHTML = `<template id="t"><b>x</b></template><b class="b">y</b>`;
    expect(div.isConnected).toBe(false);
    expect(div.querySelector("template")!.id).toBe("t");
    expect(div.querySelectorAll("b")).toHaveLength(1);
    expect(div.querySelector(":scope > .b")!.textContent).toBe("y");
    expect(div.attributes).toHaveLength(0);
  });
});
