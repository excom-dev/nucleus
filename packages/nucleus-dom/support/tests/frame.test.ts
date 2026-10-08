import { describe, expect, it, vi } from "@excom/heft-rig/node_modules/vitest";
import { createDom } from "../../index";
import { forgetVisits } from "../../src/frame";

const SET_URL = Symbol("setURL");

/**
 * A window the way happy-dom builds one: `happyDOM.setURL()` hands the browser
 * frame to the location's symbol-keyed `setURL`. `extra` adds to that frame.
 */
const fakeWindow = (extra: Record<symbol, unknown> = {}) => {
  const clearCookies = vi.fn();
  const frame = { page: { context: { cookieContainer: { clearCookies } } }, ...extra };
  const location = Object.create({ [SET_URL]: vi.fn() }, { href: { value: "https://wren.test/" } });
  const win = {
    location,
    happyDOM: { setURL: () => (location as Record<symbol, (frame: unknown, url: string) => void>)[SET_URL]!(frame, "") },
  };
  return { win: win as never, clearCookies, location };
};

describe("forgetVisits", () => {
  it("clears the cookies and the history entries of a real window's earlier pages", () => {
    const { window, document, dispose } = createDom({ url: "https://wren.test/cart" });
    try {
      document.cookie = "consent=yes; path=/";
      window.history.pushState({}, "", "/cart?step=1");
      window.history.pushState({}, "", "/cart?step=2");
      expect([document.cookie, window.history.length]).toEqual(["consent=yes", 3]);
      forgetVisits(window);
      expect([document.cookie, window.history.length]).toEqual(["", 1]);
    } finally {
      dispose();
    }
  });

  it("clears the history of a frame that holds one, and the cookies of one that does not", () => {
    const clear = vi.fn();
    const withHistory = fakeWindow({ [Symbol("history")]: { clear } });
    forgetVisits(withHistory.win);
    expect([withHistory.clearCookies.mock.calls.length, clear.mock.calls.length]).toEqual([1, 1]);
    const without = fakeWindow();
    forgetVisits(without.win);
    expect(without.clearCookies).toHaveBeenCalledTimes(1);
  });

  it("leaves the location as it was: the probe it puts there is gone", () => {
    const { win, location } = fakeWindow();
    forgetVisits(win);
    expect(Object.getOwnPropertySymbols(location)).toEqual([]);
  });

  it("does nothing when another happy-dom's location has no frame hook to find", () => {
    const happyDOM = vi.fn();
    const win = { location: {}, happyDOM: { setURL: happyDOM } };
    expect(() => forgetVisits(win as never)).not.toThrow();
    expect(happyDOM).not.toHaveBeenCalled();
  });

  it("does nothing when the location never hands the frame over", () => {
    const location = Object.create({ [SET_URL]: () => {} });
    const win = { location, happyDOM: { setURL: vi.fn() } };
    expect(() => forgetVisits(win as never)).not.toThrow();
    expect(win.happyDOM.setURL).toHaveBeenCalled();
  });
});
