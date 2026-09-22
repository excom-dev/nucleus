import { formToJson, parseFormInputValue } from "../../form";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const formHtml = `
  <form action="/api/submit" method="put">
      <!-- Simple primitives -->
      <input type="text" name="name" value="John Doe">
      <input type="email" name="email" value="j@doe.com">
      <input type="number" name="age" value="50">
      <input type="range" name="volume" min="0" max="100" value="20">
      <input type="tel" name="phone" value="123-456-7890">
      <input type="url" name="website" value="https://example.com">
      <input type="color" name="favoriteColor" value="#ff0000">
      <input type="password" name="password" value="secret">
      <!-- Checkbox -->
      <input type="checkbox" name="isAdmin" checked>
      <input type="checkbox" name="isModerator">
      <!-- Checkbox array -->
      <input type="checkbox" name="hobbies" value="reading" checked>
      <input type="checkbox" name="hobbies" value="cooking">
      <input type="checkbox" name="hobbies" value="gaming" checked>
      <!-- Radio -->
      <input type="radio" name="activity" value="running">
      <input type="radio" name="activity" value="swimming" checked>
      <!-- Datetimes -->
      <input type="date" name="birthday" value="1999-10-01">
      <input type="time" name="wakeupTime" value="08:00">
      <input type="datetime-local" name="meetingTime" value="2023-10-01T10:00">
      <input type="month" name="birthMonth" value="1999-10">
      <input type="week" name="birthWeek" value="1999-W40">
      <!-- Select -->
      <select name="country">
          <option value="USA">United States</option>
          <option value="CAN" selected>Canada</option>
          <option value="MEX">Mexico</option>
      </select>
      <!-- Select multiple -->
      <select name="languages" multiple>
          <option value="english" selected>English</option>
          <option value="french">French</option>
          <option value="spanish" selected>Spanish</option>
          <option value="german">German</option>
          <option value="chinese">Chinese</option>
      </select>
      <!-- Arrays -->
      <input type="text" name="tags[]" value="smart">
      <input type="text" name="tags[]" value="athletic">
      <input type="text" name="tags[]" value="kind">
      <!-- Nested -->
      <input type="text" name="address.city" value="Anytown">
      <input type="text" name="address.state" value="CA">
      <input type="number" name="address.zip" value="12345">
      <input type="number" name="address.coordinates[]" value="37.7749">
      <input type="number" name="address.coordinates[]" value="-122.4194">
      <!-- Disabled -->
      <input type="text" name="disabledValue" value="test" disabled>
      <button type="submit">Submit</button>
  </form>
`;

const formJson = {
  name: "John Doe",
  email: "j@doe.com",
  age: 50,
  volume: 20,
  phone: "123-456-7890",
  website: "https://example.com",
  favoriteColor: "#ff0000",
  password: "secret",
  isAdmin: true,
  isModerator: false,
  activity: "swimming",
  hobbies: ["reading", "gaming"],
  birthday: "1999-10-01",
  wakeupTime: "08:00",
  meetingTime: "2023-10-01T10:00",
  birthMonth: "1999-10",
  birthWeek: "1999-W40",
  country: "CAN",
  languages: ["english", "spanish"],
  tags: ["smart", "athletic", "kind"],
  address: {
    city: "Anytown",
    state: "CA",
    zip: 12345,
    coordinates: [37.7749, -122.4194],
  },
};

describe("formToJson", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("converts form to json correctly", async () => {
    // nested paths + typed values
    document.body.innerHTML = formHtml;
    const form = document.querySelector("form");
    const json = formToJson(form);
    expect(json).toEqual(formJson);
  });

  it("converts forms created via fixture() (connected wrapper)", () => {
    const form = fixture<HTMLFormElement>(formHtml);
    expect(formToJson(form)).toEqual(formJson);
  });

  it("returns an empty object for a form with no named controls", () => {
    const form = fixture<HTMLFormElement>(
      `<form><input type="text" value="unnamed"><button>Go</button></form>`,
    );
    expect(formToJson(form)).toEqual({});
  });

  it("serializes textareas and empty text values", () => {
    const form = fixture<HTMLFormElement>(`<form>
      <textarea name="bio">Hello
world</textarea>
      <input type="text" name="empty" value="">
    </form>`);
    expect(formToJson(form)).toEqual({ bio: "Hello\nworld", empty: "" });
  });

  it("types number and range controls, including empty numbers", () => {
    const form = fixture<HTMLFormElement>(`<form>
      <input type="number" name="n" value="3.5">
      <input type="range" name="r" min="0" max="10" value="7">
      <input type="number" name="blank" value="">
    </form>`);
    expect(formToJson(form)).toEqual({ n: 3.5, r: 7, blank: 0 });
  });

  it("maps value-less checkboxes to booleans", () => {
    const form = fixture<HTMLFormElement>(`<form>
      <input type="checkbox" name="on" checked>
      <input type="checkbox" name="off">
    </form>`);
    expect(formToJson(form)).toEqual({ on: true, off: false });
  });

  it("omits a valued checkbox group with nothing checked", () => {
    const form = fixture<HTMLFormElement>(`<form>
      <input type="checkbox" name="hobbies" value="reading">
      <input type="checkbox" name="hobbies" value="cooking">
      <input type="text" name="name" value="x">
    </form>`);
    expect(formToJson(form)).toEqual({ name: "x" });
  });

  it("collects a single checked valued checkbox into an array", () => {
    const form = fixture<HTMLFormElement>(`<form>
      <input type="checkbox" name="hobbies" value="reading" checked>
      <input type="checkbox" name="hobbies" value="cooking">
    </form>`);
    expect(formToJson(form)).toEqual({ hobbies: ["reading"] });
  });

  it("omits a radio group with nothing checked", () => {
    const form = fixture<HTMLFormElement>(`<form>
      <input type="radio" name="activity" value="running">
      <input type="radio" name="activity" value="swimming">
    </form>`);
    expect(formToJson(form)).toEqual({});
  });

  it("serializes a single select by its selected option", () => {
    const form = fixture<HTMLFormElement>(`<form>
      <select name="single">
        <option value="a">A</option>
        <option value="b" selected>B</option>
      </select>
    </form>`);
    expect(formToJson(form)).toEqual({ single: "b" });
  });

  it("lets the last of several same-named text inputs win", () => {
    const form = fixture<HTMLFormElement>(`<form>
      <input type="text" name="dup" value="first">
      <input type="text" name="dup" value="second">
    </form>`);
    expect(formToJson(form)).toEqual({ dup: "second" });
  });

  it("keeps [] arrays in document order with repeated values", () => {
    const form = fixture<HTMLFormElement>(`<form>
      <input type="text" name="tags[]" value="a">
      <input type="text" name="tags[]" value="a">
      <input type="number" name="tags[]" value="3">
    </form>`);
    expect(formToJson(form)).toEqual({ tags: ["a", "a", 3] });
  });

  it("builds nested objects and arrays from dotted and [] names", () => {
    const form = fixture<HTMLFormElement>(`<form>
      <input type="text" name="a.b.c" value="deep">
      <input type="number" name="a.list[]" value="1">
      <input type="number" name="a.list[]" value="2">
      <input type="checkbox" name="a.flag" checked>
    </form>`);
    expect(formToJson(form)).toEqual({
      a: { b: { c: "deep" }, list: [1, 2], flag: true },
    });
  });

  it("looks controls up by name, not by id", () => {
    // `form.elements.namedItem()` would match the id first
    const form = fixture<HTMLFormElement>(`<form>
      <input type="text" id="age" name="label" value="not a number">
      <input type="number" name="age" value="42">
    </form>`);
    expect(formToJson(form)).toEqual({ label: "not a number", age: 42 });
  });

  it("types controls associated through the form attribute", () => {
    const wrap = fixture<HTMLElement>(`<section>
      <form id="f"><input type="text" name="inside" value="in"></form>
      <input type="number" name="outside" value="8" form="f">
      <input type="checkbox" name="flag" form="f" checked>
    </section>`);
    const form = wrap.querySelector("form") as HTMLFormElement;
    expect(formToJson(form)).toEqual({ inside: "in", outside: 8, flag: true });
  });

  it("ignores disabled controls and unnamed controls", () => {
    const form = fixture<HTMLFormElement>(`<form>
      <input type="text" name="keep" value="1">
      <input type="text" name="skip" value="2" disabled>
      <input type="text" value="3">
    </form>`);
    expect(formToJson(form)).toEqual({ keep: "1" });
  });

  it("serializes thousands of fields with one pass over the controls", () => {
    const rows = 100;
    const cols = 26;
    const inputs: string[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ref = String.fromCharCode(65 + c) + r;
        inputs.push(
          `<input type="text" name="detail.${ref}" value="${r === 0 ? "=A1" : ref}">`,
        );
      }
    }
    const form = fixture<HTMLFormElement>(`<form>${inputs.join("")}</form>`);
    const querySelector = vi.spyOn(form, "querySelector");
    const querySelectorAll = vi.spyOn(form, "querySelectorAll");
    const json = formToJson(form) as { detail: Record<string, string> };
    expect(Object.keys(json.detail)).toHaveLength(rows * cols);
    expect(json.detail.A0).toBe("=A1");
    expect(json.detail.Z99).toBe("Z99");
    // no per-field selector queries: one query for unchecked checkboxes
    expect(querySelector).not.toHaveBeenCalled();
    expect(querySelectorAll).toHaveBeenCalledTimes(1);
  });

  it("skips entries whose name is empty", () => {
    const form = fixture<HTMLFormElement>(`<form>
      <input type="checkbox" name="">
      <input type="text" name="keep" value="k">
    </form>`);
    expect(formToJson(form)).toEqual({ keep: "k" });
  });

  it("parseFormInputValue: passes the value through without a control", () => {
    const form = fixture<HTMLFormElement>(`<form></form>`);
    expect(parseFormInputValue(form, undefined, "k", "raw")).toBe("raw");
  });

  it("parseFormInputValue: radio with nothing checked yields null", () => {
    const form = fixture<HTMLFormElement>(`<form>
      <input type="radio" name="pick" value="a">
      <input type="radio" name="pick" value="b">
    </form>`);
    const radio = form.querySelector("input") as HTMLInputElement;
    expect(parseFormInputValue(form, radio, "pick", "a")).toBe(null);
    radio.checked = true;
    expect(parseFormInputValue(form, radio, "pick", "a")).toBe("a");
  });

  it("parseFormInputValue: checkbox on/off strings map to the checked state", () => {
    const form = fixture<HTMLFormElement>(`<form>
      <input type="checkbox" name="flag" checked>
    </form>`);
    const box = form.querySelector("input") as HTMLInputElement;
    expect(parseFormInputValue(form, box, "flag", "on")).toBe(true);
    box.checked = false;
    expect(parseFormInputValue(form, box, "flag", "off")).toBe(false);
  });
});
