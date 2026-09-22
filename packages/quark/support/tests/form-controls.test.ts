/**
 * Form-control sync: on native form controls the attribute Quark writes is
 * authoritative, and the live (dirty-flag guarded) property follows it.
 * happy-dom implements the dirty value / checkedness flags, so every
 * "user edited" case below really diverges the property from the attribute
 * before a rule writes.
 */
import { Quark } from "../../index";
import {
  FORM_CONTROL_ATTRIBUTES,
  TEXT_CONTROL_TAGS,
  isFormControlAttribute,
} from "../../src/form-controls";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { createSheet, flush, mount, unregisterAll } from "./helpers";

/** Type into a control the way a user would: live value only, no attribute. */
const userTypes = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const userToggles = (input: HTMLInputElement, checked: boolean) => {
  input.checked = checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("form-control sync", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
  });

  describe("table", () => {
    it("covers exactly input value / checked, option selected, textarea text", () => {
      expect(FORM_CONTROL_ATTRIBUTES).toEqual({
        input: ["value", "checked"],
        option: ["selected"],
      });
      expect(TEXT_CONTROL_TAGS).toEqual(["textarea"]);
      expect(isFormControlAttribute(document.createElement("input"), "value")).toBe(true);
      expect(isFormControlAttribute(document.createElement("input"), "checked")).toBe(true);
      expect(isFormControlAttribute(document.createElement("option"), "selected")).toBe(true);
      expect(isFormControlAttribute(document.createElement("select"), "value")).toBe(false);
      expect(isFormControlAttribute(document.createElement("textarea"), "value")).toBe(false);
      expect(isFormControlAttribute(document.createElement("input"), "placeholder")).toBe(false);
      expect(isFormControlAttribute(document.createElement("super-input"), "value")).toBe(false);
    });
  });

  describe("input value", () => {
    it("writes the attribute and the live value on a pristine input", async () => {
      const { root } = mount(`<input>`, `input { value: "hello"; }`);
      await flush();
      const input = root.querySelector("input")!;
      expect(input.getAttribute("value")).toBe("hello");
      expect(input.defaultValue).toBe("hello");
      expect(input.value).toBe("hello");
    });

    it("writes numbers as text", async () => {
      const { root } = mount(`<input type="number">`, `input { value: 4 * 10.5; }`);
      await flush();
      const input = root.querySelector("input")!;
      expect(input.getAttribute("value")).toBe("42");
      expect(input.value).toBe("42");
    });

    it("overrides a value the user typed when the rule writes a new one", async () => {
      const { root } = mount(
        `<section data-unit="c"><input value="0"></section>`,
        `section[data-unit="f"] input { value: "32"; }`,
      );
      await flush();
      const input = root.querySelector("input")!;
      userTypes(input, "100");
      expect(input.value).toBe("100");
      expect(input.getAttribute("value")).toBe("0");

      root.querySelector("section")!.setAttribute("data-unit", "f");
      await flush();
      expect(input.getAttribute("value")).toBe("32");
      expect(input.value).toBe("32");
    });

    it("restores a user-edited input even when the attribute already holds the rule's value", async () => {
      /*
       * the temperature-converter case: the user typed into a field whose
       * attribute never changed; a re-run to the same attribute value must
       * still win over the live value
       */
      const { root } = mount(
        `<section data-source="a"><input name="b" value="0"></section>`,
        `section[data-source="a"] input { value: "0"; }`,
      );
      await flush();
      const input = root.querySelector("input")!;
      expect(input.value).toBe("0");

      userTypes(input, "100");
      root.querySelector("section")!.setAttribute("data-source", "b");
      await flush();
      expect(input.value).toBe("100"); // rule not matching: nothing written

      root.querySelector("section")!.setAttribute("data-source", "a");
      await flush();
      expect(input.getAttribute("value")).toBe("0");
      expect(input.value).toBe("0");
    });

    it("does not touch a control while the rule does not re-run", async () => {
      const { root } = mount(`<input>`, `input { value: "seed"; }`);
      await flush();
      const input = root.querySelector("input")!;
      userTypes(input, "mine");
      await flush();
      expect(input.value).toBe("mine");
      expect(input.getAttribute("value")).toBe("seed");
    });

    it("`none` removes the attribute and clears the live value", async () => {
      const { root } = mount(
        `<section><input value="keep"></section>`,
        `section[data-clear] input { value: none; }`,
      );
      await flush();
      const input = root.querySelector("input")!;
      userTypes(input, "typed");
      root.querySelector("section")!.setAttribute("data-clear", "");
      await flush();
      expect(input.hasAttribute("value")).toBe(false);
      expect(input.value).toBe("");
    });

    it("`preserve` leaves both the attribute and the live value alone", async () => {
      const { root } = mount(
        `<section><input value="keep"></section>`,
        `section[data-go] input { value: preserve; }`,
      );
      await flush();
      const input = root.querySelector("input")!;
      userTypes(input, "typed");
      root.querySelector("section")!.setAttribute("data-go", "");
      await flush();
      expect(input.getAttribute("value")).toBe("keep");
      expect(input.value).toBe("typed");
    });

    it("re-syncs on a reactive re-run driven by a $binding", async () => {
      const { root } = mount(
        `<section data-n="1"><input></section>`,
        `section { $n: attr("data-n"); input { value: $n * 2; } }`,
      );
      await flush();
      const input = root.querySelector("input")!;
      expect(input.value).toBe("2");
      userTypes(input, "999");
      root.querySelector("section")!.setAttribute("data-n", "5");
      await flush();
      expect(input.getAttribute("value")).toBe("10");
      expect(input.value).toBe("10");
    });

    it("skips file inputs (read-only value) but still writes the attribute", async () => {
      const { root } = mount(`<input type="file">`, `input { value: "x"; }`);
      await flush();
      const input = root.querySelector("input")!;
      expect(input.getAttribute("value")).toBe("x");
      expect(input.value).toBe("");
    });

    it("keeps `defaultValue` equal to the written attribute", async () => {
      const { root } = mount(`<input>`, `input { value: "d"; }`);
      await flush();
      const input = root.querySelector("input")!;
      userTypes(input, "typed");
      expect(input.defaultValue).toBe("d");
      expect(input.getAttribute("value")).toBe("d");
    });

    it("does not read the live value back: typing never re-runs a rule", async () => {
      const { root } = mount(
        `<input value="a">`,
        `input { data-mirror: attr("value"); }`,
      );
      await flush();
      const input = root.querySelector("input")!;
      expect(input.getAttribute("data-mirror")).toBe("a");
      userTypes(input, "b");
      await flush();
      expect(input.getAttribute("data-mirror")).toBe("a");
      expect(input.getAttribute("value")).toBe("a");
      expect(input.value).toBe("b");
    });
  });

  describe("input checked", () => {
    it("checks a checkbox through the attribute", async () => {
      const { root } = mount(
        `<input type="checkbox">`,
        `input { checked: true; }`,
      );
      await flush();
      const box = root.querySelector("input")!;
      expect(box.hasAttribute("checked")).toBe(true);
      expect(box.checked).toBe(true);
    });

    it("re-checks a box the user unchecked when the rule writes again", async () => {
      const { root } = mount(
        `<section data-on><input type="checkbox"></section>`,
        `section[data-on] input { checked: ""; }`,
      );
      await flush();
      const box = root.querySelector("input")!;
      expect(box.checked).toBe(true);
      userToggles(box, false);
      expect(box.checked).toBe(false);
      expect(box.hasAttribute("checked")).toBe(true);

      const section = root.querySelector("section")!;
      section.removeAttribute("data-on");
      await flush();
      section.setAttribute("data-on", "");
      await flush();
      expect(box.checked).toBe(true);
    });

    it("`false` / `none` remove the attribute and uncheck", async () => {
      const { root } = mount(
        `<section><input type="checkbox" checked><input type="checkbox" checked></section>`,
        `section[data-off] input:first-child { checked: false; }
         section[data-off] input:last-child { checked: none; }`,
      );
      await flush();
      const [a, b] = Array.from(root.querySelectorAll("input"));
      expect(a.checked).toBe(true);
      root.querySelector("section")!.setAttribute("data-off", "");
      await flush();
      expect(a.hasAttribute("checked")).toBe(false);
      expect(a.checked).toBe(false);
      expect(b.hasAttribute("checked")).toBe(false);
      expect(b.checked).toBe(false);
    });

    it("selects a radio through the attribute", async () => {
      // (a browser also unchecks the group mates live; happy-dom does not
      // model radio groups, so only the written radio is asserted here)
      const { root } = mount(
        `<form><input type="radio" name="r" value="1" checked><input type="radio" name="r" value="2"></form>`,
        `input[value="2"] { checked: ""; }`,
      );
      await flush();
      const [one, two] = Array.from(root.querySelectorAll("input"));
      expect(two.hasAttribute("checked")).toBe(true);
      expect(two.checked).toBe(true);
      // the attribute on the first radio is not Quark's to remove
      expect(one.hasAttribute("checked")).toBe(true);
    });

    it("tracks a data-driven checked state across re-runs", async () => {
      const { root } = mount(
        `<section data-done="true"><input type="checkbox"></section>`,
        `section { $done: attr("data-done") == "true"; input { checked: $done; } }`,
      );
      await flush();
      const box = root.querySelector("input")!;
      expect(box.checked).toBe(true);
      userToggles(box, false);
      root.querySelector("section")!.setAttribute("data-done", "false");
      await flush();
      expect(box.hasAttribute("checked")).toBe(false);
      expect(box.checked).toBe(false);
      root.querySelector("section")!.setAttribute("data-done", "true");
      await flush();
      expect(box.checked).toBe(true);
    });
  });

  describe("option selected", () => {
    it("selects an option through the attribute so the select's value follows", async () => {
      const { root } = mount(
        `<select><option value="a">A</option><option value="b">B</option></select>`,
        `option[value="b"] { selected: ""; }`,
      );
      await flush();
      const select = root.querySelector("select")!;
      expect(select.value).toBe("b");
      expect(root.querySelector('option[value="b"]')!.hasAttribute("selected")).toBe(true);
    });

    it("re-selects after the user picked another option", async () => {
      const { root } = mount(
        `<section data-pick="b"><select><option value="a">A</option><option value="b">B</option></select></section>`,
        `section[data-pick="b"] option[value="b"] { selected: ""; }
         section[data-pick="a"] option[value="a"] { selected: ""; }`,
      );
      await flush();
      const select = root.querySelector("select")!;
      const [a, b] = Array.from(root.querySelectorAll("option"));
      expect(select.value).toBe("b");
      a.selected = true;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      expect(select.value).toBe("a");

      const section = root.querySelector("section")!;
      section.setAttribute("data-pick", "a");
      await flush();
      section.setAttribute("data-pick", "b");
      await flush();
      expect(b.selected).toBe(true);
      expect(select.value).toBe("b");
    });

    it("`none` deselects", async () => {
      const { root } = mount(
        `<section><select><option value="a">A</option><option value="b" selected>B</option></select></section>`,
        `section[data-reset] option { selected: none; }`,
      );
      await flush();
      const [, b] = Array.from(root.querySelectorAll("option"));
      expect(b.selected).toBe(true);
      root.querySelector("section")!.setAttribute("data-reset", "");
      await flush();
      expect(b.hasAttribute("selected")).toBe(false);
      expect(b.selected).toBe(false);
    });
  });

  describe("textarea content", () => {
    it("sets the default text and the live value", async () => {
      const { root } = mount(`<textarea></textarea>`, `textarea { content: "draft"; }`);
      await flush();
      const area = root.querySelector("textarea")!;
      expect(area.textContent).toBe("draft");
      expect(area.defaultValue).toBe("draft");
      expect(area.value).toBe("draft");
    });

    it("overrides text the user typed when the rule writes again", async () => {
      const { root } = mount(
        `<section data-v="one"><textarea></textarea></section>`,
        `section { $v: attr("data-v"); textarea { content: $v; } }`,
      );
      await flush();
      const area = root.querySelector("textarea")!;
      userTypes(area, "typed");
      root.querySelector("section")!.setAttribute("data-v", "two");
      await flush();
      expect(area.textContent).toBe("two");
      expect(area.value).toBe("two");
    });

    it("restores the live value even when the text already matches (skipped paint)", async () => {
      const { root } = mount(
        `<section data-go><textarea>same</textarea></section>`,
        `section[data-go] textarea { content: "same"; }`,
      );
      await flush();
      const area = root.querySelector("textarea")!;
      userTypes(area, "edited");
      const section = root.querySelector("section")!;
      section.removeAttribute("data-go");
      await flush();
      section.setAttribute("data-go", "");
      await flush();
      expect(area.textContent).toBe("same");
      expect(area.value).toBe("same");
    });

    it("`none` clears both", async () => {
      const { root } = mount(
        `<section><textarea>seed</textarea></section>`,
        `section[data-clear] textarea { content: none; }`,
      );
      await flush();
      const area = root.querySelector("textarea")!;
      userTypes(area, "typed");
      root.querySelector("section")!.setAttribute("data-clear", "");
      await flush();
      expect(area.textContent).toBe("");
      expect(area.value).toBe("");
    });

    it("leaves a non-control's text paint alone (no .value expando)", async () => {
      const { root } = mount(`<p></p>`, `p { content: "text"; }`);
      await flush();
      const p = root.querySelector("p")!;
      expect(p.textContent).toBe("text");
      expect("value" in p).toBe(false);
    });
  });

  describe("custom elements and other natives", () => {
    it("writes only the attribute on a custom element with a `value` attribute", async () => {
      const { root } = mount(`<my-field></my-field>`, `my-field { value: "v"; }`);
      await flush();
      const el = root.querySelector("my-field")!;
      expect(el.getAttribute("value")).toBe("v");
      expect("value" in el).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(el, "value")).toBe(false);
    });

    it("writes only the attribute on <select> (use `selected` on its options)", async () => {
      const { root } = mount(
        `<select><option value="a">A</option><option value="b">B</option></select>`,
        `select { value: "b"; }`,
      );
      await flush();
      const select = root.querySelector("select")!;
      expect(select.getAttribute("value")).toBe("b");
      expect(select.value).toBe("a");
    });

    it("treats other input attributes as plain attributes", async () => {
      const { root } = mount(`<input>`, `input { placeholder: "hint"; min: 3; }`);
      await flush();
      const input = root.querySelector("input")!;
      expect(input.getAttribute("placeholder")).toBe("hint");
      expect(input.getAttribute("min")).toBe("3");
      expect(input.value).toBe("");
    });
  });

  describe("registration timing", () => {
    it("wins over a value typed before the sheet registered", async () => {
      const { root, register } = createSheet(`<input value="0">`, `input { value: "7"; }`);
      const input = root.querySelector("input")!;
      userTypes(input, "typed-before");
      register();
      await flush();
      expect(input.getAttribute("value")).toBe("7");
      expect(input.value).toBe("7");
    });

    it("does not revert on unregister (no rule reversion)", async () => {
      const { root, quark } = mount(`<input>`, `input { value: "kept"; }`);
      await flush();
      quark.unregister();
      const input = root.querySelector("input")!;
      expect(input.value).toBe("kept");
      expect(input.getAttribute("value")).toBe("kept");
    });
  });
});

// keep the import used even if a future refactor drops the direct assertions
void Quark;
