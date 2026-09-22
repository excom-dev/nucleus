import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";

describe("super-input", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("[auto-label] creates new id if necessary", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input auto-label>
        <input />
        <label></label>
      </super-input>`,
    );
    const input = el.querySelector("input") as HTMLInputElement;
    const label = el.querySelector("label") as HTMLLabelElement;
    expect(input.id).toMatch(/super-input-/);
    expect(input.id).toBe(label.htmlFor);
  });

  it("1. [auto-label] takes existing id if provided", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input auto-label>
        <input id="my-input" />
        <label for="will-be-replaced"></label>
      </super-input>`,
    );
    expect(el).dom.to.equalTag(
      `<super-input auto-label>
        <input id="my-input" />
        <label for="my-input"></label>
      </super-input>`,
    );
  });

  it("2. [auto-label] takes existing id if provided", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input auto-label>
        <input />
        <label for="my-input"></label>
      </super-input>`,
    );
    expect(el).dom.to.equalTag(
      `<super-input auto-label>
        <input id="my-input" />
        <label for="my-input"></label>
      </super-input>`,
    );
  });

  it("reflects input value when enabled", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input reflect-value><input /></super-input>`,
    );
    const input = el.querySelector("input") as HTMLInputElement;
    input.value = "hello";
    input.dispatchEvent(new Event("input"));
    await wait(0);
    expect(el).dom.to.equalTag(
      `<super-input reflect-value current-value="hello"></super-input>`,
    );
  });

  it("does not reflect value when reflectValue is false", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input><input /></super-input>`,
    );
    const input = el.querySelector("input") as HTMLInputElement;
    input.value = "hello";
    input.dispatchEvent(new Event("input"));
    await wait(0);
    expect(el).dom.to.equalTag(`<super-input></super-input>`);
  });

  it("formats input value configured in [text-format] and reflects that formatted value", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input text-format="xx-xx-xxxx" reflect-value><input value="1234567890" /></super-input>`,
    );
    const input = el.querySelector("input")!;
    expect(input.value).toBe("12-34-5678");
    expect(el.currentValue).toBe("12-34-5678");
    el.textFormat = "xxxx-xxxx-xxxx";
    expect(input.value).toBe("1234-5678");
    expect(el.currentValue).toBe("1234-5678");
    input.value = "1234567890";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input.value).toBe("1234-5678-90");
    expect(el.currentValue).toBe("1234-5678-90");
    el.textFormat = null;
    expect(input.value).toBe("1234567890");
    expect(el.currentValue).toBe("1234567890");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input.value).toBe("1234567890");
    expect(el.currentValue).toBe("1234567890");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input.value).toBe("");
    expect(el.currentValue).toBe(null);
  });

  it("adds and removes event listeners when needed", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input><input /></super-input>`,
    );
    const input = el._inputElement;
    el.reflectValue = true;
    expect(input).toMatchListeners({ input: 1 });
    el.textFormat = "x-x"
    expect(input).toMatchListeners({ input: 1 });
    el.invalidMessage = "Invalid";
    expect(input).toMatchListeners({ input: 1, invalid: 1, keydown: 1 });
    el.reflectValue = false;
    expect(input).toMatchListeners({ input: 1, invalid: 1, keydown: 1 });
    el.textFormat = null;
    expect(input).toMatchListeners({ invalid: 1, keydown: 1 });
    el.invalidMessage = "test"
    expect(input).toMatchListeners({ invalid: 1, keydown: 1 })
    el.invalidMessage = null;
    expect(input).toMatchListeners({});
  });

  it("does not push an external current-value write into the input", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input><input value="1" /></super-input>`,
    );
    const input = el.querySelector("input") as HTMLInputElement;
    input.value = "typed";
    el.setAttribute("current-value", "42");
    await wait(0);
    expect(input.value).toBe("typed");
  });
});

describe("super-input (edge cases)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("[invalid-message] installs the custom validity on `invalid` and clears it on `keydown`", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input invalid-message="Needs a value"><input required /></super-input>`,
    );
    const input = el.querySelector("input")!;
    expect(input).toMatchListeners({ invalid: 1, keydown: 1 });

    input.dispatchEvent(new Event("invalid"));
    expect(input.validationMessage).toBe("Needs a value");
    expect(input.validity.customError).toBe(true);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(input.validity.customError).toBe(false);
    expect(input.validationMessage).not.toBe("Needs a value");
  });

  it("[invalid-message] does nothing on `invalid` once the message is unset", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input invalid-message="Needs a value"><input required /></super-input>`,
    );
    const input = el.querySelector("input")!;
    el.invalidMessage = null;
    expect(input).toMatchListeners({});
    // the listener is gone; invoking the handler directly is a no-op
    el.handleInvalid();
    expect(input.validity.customError).toBe(false);
    input.dispatchEvent(new Event("invalid"));
    expect(input.validity.customError).toBe(false);
  });

  it("[reflect-value] reflects `null` when the input is empty", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input reflect-value><input value="abc" /></super-input>`,
    );
    const input = el.querySelector("input")!;
    expect(el.currentValue).toBe("abc");
    input.value = "";
    input.dispatchEvent(new Event("input"));
    expect(el.currentValue).toBe(null);
    expect(el.hasAttribute("current-value")).toBe(false);
  });

  it("[reflect-value] clears current-value when reflection is switched off", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input reflect-value><input value="abc" /></super-input>`,
    );
    expect(el.getAttribute("current-value")).toBe("abc");
    el.reflectValue = false;
    expect(el.currentValue).toBe(null);
    const input = el.querySelector("input")!;
    input.value = "typed";
    input.dispatchEvent(new Event("input"));
    expect(el.currentValue).toBe(null);
  });

  it("[text-format] formats a programmatic value when the format changes and keeps the caret-relative selection", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input text-format="(xxx) xxx-xxxx"><input /></super-input>`,
    );
    const input = el.querySelector("input")!;
    // an empty input is left alone by doFormat
    el.textFormat = "xxx-xxx";
    expect(input.value).toBe("");
    input.value = "5551234";
    input.dispatchEvent(new Event("input"));
    expect(input.value).toBe("555-123");
    // no reflect-value: the attribute is never written
    expect(el.hasAttribute("current-value")).toBe(false);
  });

  it("tolerates a missing <input>", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input reflect-value text-format="xx-xx" invalid-message="nope" auto-label>
        <label>Orphan</label>
      </super-input>`,
    );
    expect(el._inputElement).toBe(null);
    expect(el.currentValue).toBe(null);
    expect(el.querySelector("label")!.htmlFor).toBe("");
    // prop toggles must not throw without an input
    el.reflectValue = false;
    el.textFormat = null;
    el.invalidMessage = null;
    expect(el.currentValue).toBe(null);
    el.reflectValue = true;
    el.textFormat = "xxx";
    el.invalidMessage = "still nope";
    expect(el.currentValue).toBe(null);
    expect(el.hasAttribute("current-value")).toBe(false);
  });

  it("[auto-label] leaves the label alone when auto-label is unset", async () => {
    const el = fixture<HTMLSuperInputElement>(
      `<super-input><input /><label for="keep-me"></label></super-input>`,
    );
    expect(el.querySelector("input")!.id).toBe("");
    expect(el.querySelector("label")!.htmlFor).toBe("keep-me");
  });
});
