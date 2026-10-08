import { matchesKey } from "../../key-filter";
import * as index from "../../index";
import {
  describe,
  expect,
  it,
} from "@excom/nucleus-test";

const key = (k: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key: k, ...init });

describe("matchesKey", () => {
  it("is exported from the package entry", () => {
    expect(index.matchesKey).toBe(matchesKey);
  });

  it("matches alternatives and modifier chords in any order, case-insensitively", () => {
    const filter = "Escape shift+K enter+CTRL";
    expect(matchesKey(filter, key("Escape"))).toBe(true);
    expect(matchesKey(filter, key("K", { shiftKey: true }))).toBe(true);
    expect(matchesKey(filter, key("Enter", { ctrlKey: true }))).toBe(true);
    expect(matchesKey(filter, key("k"))).toBe(false);
    expect(matchesKey(filter, key("Enter"))).toBe(false);
  });

  it("matches a modifier-only token on that modifier's own keydown", () => {
    const filter = "ctrl cmd shift";
    expect(matchesKey(filter, key("Control", { ctrlKey: true }))).toBe(true);
    expect(matchesKey(filter, key("Meta", { metaKey: true }))).toBe(true);
    expect(matchesKey(filter, key("Shift", { shiftKey: true }))).toBe(true);
    expect(matchesKey(filter, key("x", { ctrlKey: true }))).toBe(false);
    expect(matchesKey("alt", key("Alt", { altKey: true }))).toBe(true);
  });

  it("accepts `control` and `meta` as modifier names, alone and in chords", () => {
    expect(matchesKey("control+a", key("a", { ctrlKey: true }))).toBe(true);
    expect(matchesKey("control+a", key("a"))).toBe(false);
    expect(matchesKey("meta+a", key("a", { metaKey: true }))).toBe(true);
    expect(matchesKey("meta+a", key("a", { ctrlKey: true }))).toBe(false);
    expect(matchesKey("control", key("Control", { ctrlKey: true }))).toBe(true);
    expect(matchesKey("meta", key("Meta", { metaKey: true }))).toBe(true);
    expect(matchesKey("meta", key("Control", { ctrlKey: true }))).toBe(false);
  });

  it.each(["space", "Space", "SPACEBAR", "spacebar"])(
    "names the space bar %s",
    (name) => {
      expect(matchesKey(name, key(" "))).toBe(true);
      expect(matchesKey(`Shift+${name}`, key(" ", { shiftKey: true }))).toBe(
        true
      );
      expect(matchesKey(`Shift+${name}`, key(" "))).toBe(false);
      expect(matchesKey(name, key("s"))).toBe(false);
    }
  );

  it("names the plus key `plus`, while a bare `+` never matches", () => {
    expect(matchesKey("plus", key("+"))).toBe(true);
    expect(matchesKey("Shift+Plus", key("+", { shiftKey: true }))).toBe(true);
    expect(matchesKey("+", key("+"))).toBe(false);
  });

  it("accepts a token list", () => {
    expect(matchesKey(["tab", "shift+space"], key("Tab"))).toBe(true);
    expect(matchesKey(["tab", "shift+space"], key(" "))).toBe(false);
  });

  it("matches no key without a token or without an event key", () => {
    expect(matchesKey(" ", key(" "))).toBe(false);
    expect(matchesKey("", key("a"))).toBe(false);
    expect(matchesKey([], key("a"))).toBe(false);
    expect(matchesKey("a", new KeyboardEvent("keydown"))).toBe(false);
    expect(matchesKey("a", new Event("keydown"))).toBe(false);
  });
});
