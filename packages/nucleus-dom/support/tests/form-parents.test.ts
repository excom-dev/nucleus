import { describe, expect, it } from "@excom/heft-rig/node_modules/vitest";
import { createDom, resetDocument } from "../../index";

/** How `parent` and `child` relate: contains, position, parentNode, closest. */
const related = (parent: Element, child: Element) => [
  parent.contains(child),
  parent.compareDocumentPosition(child),
  child.parentNode === parent,
  child.closest(parent.localName) === parent,
];

const NESTED = [true, 20, true, true];

describe("keepFormParents", () => {
  it("keeps a form / select the parent of the controls attached with it", async () => {
    const { document, dispose } = createDom();
    const host = document.createElement("div");
    host.innerHTML = `<form><input name="q"><select name="size"><option>s</option><option selected>m</option></select></form>`;
    document.body.append(host);
    const [form, input, select, option] = ["form", "input", "select", "option"].map((tag) => document.querySelector(tag)!);
    expect([related(form, input), related(form, select), related(select, option)]).toEqual([NESTED, NESTED, NESTED]);
    const { elements } = form as HTMLFormElement;
    const { options, value, selectedIndex } = select as HTMLSelectElement;
    expect([elements.length, options.length, value, selectedIndex]).toEqual([2, 2, "m", 1]);
    (select as HTMLSelectElement).value = "s";
    expect([(select as HTMLSelectElement).selectedIndex, (option as HTMLOptionElement).selected]).toEqual([0, true]);
    await dispose();
  });

  it("keeps forms and selects whole through resetDocument: parsed, in custom elements, rendered by them", async () => {
    const { window, document, dispose } = createDom();
    window.customElements.define("x-panel", class extends window.HTMLElement {});
    window.customElements.define(
      "x-render",
      class extends window.HTMLElement {
        connectedCallback() {
          this.append(document.importNode(document.querySelector("template")!.content, true));
        }
      },
    );
    await resetDocument(window, {
      url: "/next",
      html: `<form id="plain"><input><select><option>1</option></select></form>
        <x-panel><form id="panel"><input><select><option>2</option></select></form></x-panel>
        <template><form id="rendered"><fieldset><input></fieldset><select><option>3</option></select></form></template>
        <x-render></x-render>`,
    });
    const forms = [...document.body.querySelectorAll("form")];
    expect(forms.map(({ id }) => id)).toEqual(["plain", "panel", "rendered"]);
    for (const form of forms) {
      const select = form.querySelector("select")!;
      expect([related(form, select), related(select, select.querySelector("option")!)]).toEqual([NESTED, NESTED]);
      expect(form.contains(form.querySelector("input"))).toBe(true);
    }
    await dispose();
  });
});
