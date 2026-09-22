import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";
import { lastFake, resetFakes, stubMatchMedia } from "./fake-match-media";

const COARSE = "(pointer: coarse)";
const DARK = "(prefers-color-scheme: dark)";

const mount = (query?: string) =>
  fixture<HTMLDetectMediaElement>(
    query === undefined
      ? `<detect-media></detect-media>`
      : `<detect-media media-query="${query}"></detect-media>`,
  );

describe("detect-media", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    resetFakes();
  });

  it("reflects the initial match and publishes a provision without firing change", () => {
    stubMatchMedia({ [COARSE]: true });
    const change = vi.fn();
    document.body.addEventListener("detect-media-change", change);

    const el = mount(COARSE);

    expect(window.matchMedia).toHaveBeenCalledWith(COARSE);
    expect(el).dom.to.equalTag(
      `<detect-media is-matched media-query="(pointer: coarse)"></detect-media>`,
    );
    expect(el.provision).toEqual({ mediaQuery: COARSE, isMatched: true });
    // Neutron appends its own options arg, compare the type + handler only
    expect(lastFake().addEventListener.mock.calls[0].slice(0, 2)).toEqual([
      "change",
      expect.any(Function),
    ]);
    expect(lastFake().listeners.size).toBe(1);
    expect(change).not.toHaveBeenCalled();
  });

  it("starts unmatched when the query does not match", () => {
    stubMatchMedia({ [COARSE]: false });
    const el = mount(COARSE);
    expect(el).dom.to.equalTag(
      `<detect-media media-query="(pointer: coarse)"></detect-media>`,
    );
    expect(el.provision).toEqual({ mediaQuery: COARSE, isMatched: false });
  });

  it("publishes provision with neutron-provision on mount", () => {
    stubMatchMedia();
    const wrap = document.createElement("div");
    document.body.append(wrap);
    const spy = vi.fn();
    wrap.addEventListener("neutron-provision", spy);

    wrap.innerHTML = `<detect-media media-query="${COARSE}"></detect-media>`;
    const el = wrap.firstElementChild as HTMLDetectMediaElement;

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].target).toBe(el);
  });

  it("follows change: attribute, a new provision object, and detect-media-change", () => {
    stubMatchMedia({ [COARSE]: false });
    const el = mount(COARSE);
    const fake = lastFake();
    const change = vi.fn();
    // bubbles, listen on the parent
    el.parentElement!.addEventListener("detect-media-change", change);
    const before = el.provision;

    fake.flip(true);

    expect(el.hasAttribute("is-matched")).toBe(true);
    expect(el.provision).not.toBe(before);
    expect(el.provision).toEqual({ mediaQuery: COARSE, isMatched: true });
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.calls[0][0].detail).toBe(el.provision);
    expect(change.mock.calls[0][0].detail.isMatched).toBe(true);

    fake.flip(false);

    expect(el.hasAttribute("is-matched")).toBe(false);
    expect(el.provision).toEqual({ mediaQuery: COARSE, isMatched: false });
    expect(change).toHaveBeenCalledTimes(2);
    expect(change.mock.calls[1][0].detail.isMatched).toBe(false);
  });

  it("re-subscribes when media-query changes and drops the old listener", () => {
    stubMatchMedia({ [COARSE]: true, [DARK]: false });
    const el = mount(COARSE);
    const old = lastFake();
    const handler = old.addEventListener.mock.calls[0][1];

    el.setAttribute("media-query", DARK);
    const next = lastFake();

    expect(next).not.toBe(old);
    expect(next.media).toBe(DARK);
    expect(old.removeEventListener.mock.calls[0].slice(0, 2)).toEqual([
      "change",
      handler,
    ]);
    expect(old.listeners.size).toBe(0);
    expect(next.listeners.size).toBe(1);
    expect(el.hasAttribute("is-matched")).toBe(false);
    expect(el.provision).toEqual({ mediaQuery: DARK, isMatched: false });

    // the old list is inert now
    old.flip(true);
    expect(el.hasAttribute("is-matched")).toBe(false);

    next.flip(true);
    expect(el.hasAttribute("is-matched")).toBe(true);
    expect(el.provision).toEqual({ mediaQuery: DARK, isMatched: true });
  });

  it("clears is-matched and provision when media-query is emptied", () => {
    stubMatchMedia({ [COARSE]: true });
    const el = mount(COARSE);
    const fake = lastFake();
    expect(el.hasAttribute("is-matched")).toBe(true);

    el.removeAttribute("media-query");

    expect(el.hasAttribute("is-matched")).toBe(false);
    expect(el.provision).toBe(null);
    expect(el._mql).toBe(null);
    expect(fake.listeners.size).toBe(0);
    expect(window.matchMedia).toHaveBeenCalledTimes(1);
  });

  it("leaves is-matched unset and provision null without a query", () => {
    stubMatchMedia();
    const el = mount();
    expect(el).dom.to.equalTag(`<detect-media></detect-media>`);
    expect(el.provision).toBe(null);
    expect(window.matchMedia).not.toHaveBeenCalled();
  });

  it("removes its listener on disconnect", async () => {
    stubMatchMedia({ [COARSE]: false });
    const el = mount(COARSE);
    const fake = lastFake();
    const handler = fake.addEventListener.mock.calls[0][1];

    el.remove();
    await wait(0);

    expect(fake.removeEventListener.mock.calls[0].slice(0, 2)).toEqual([
      "change",
      handler,
    ]);
    expect(fake.listeners.size).toBe(0);
    expect(el._mql).toBe(null);

    fake.flip(true);
    expect(el.hasAttribute("is-matched")).toBe(false);
  });

  it("keeps listening across a synchronous move", async () => {
    stubMatchMedia({ [COARSE]: false });
    const el = mount(COARSE);
    const parent = el.parentElement!;
    const fake = lastFake();

    el.remove();
    parent.append(el);
    await wait(0);

    expect(window.matchMedia).toHaveBeenCalledTimes(1);
    expect(el._mql).toBe(fake);
    expect(fake.listeners.size).toBe(1);

    fake.flip(true);
    expect(el.hasAttribute("is-matched")).toBe(true);
  });

  it("re-evaluates on a genuine reconnect", async () => {
    stubMatchMedia({ [COARSE]: false });
    const el = mount(COARSE);
    const first = lastFake();
    const change = vi.fn();
    document.body.addEventListener("detect-media-change", change);

    el.remove();
    await wait(0);

    // the query now matches, a fresh list reports it
    stubMatchMedia({ [COARSE]: true });
    document.body.append(el);
    await wait(0);

    const second = lastFake();
    expect(second).not.toBe(first);
    expect(el._mql).toBe(second);
    expect(first.listeners.size).toBe(0);
    expect(second.listeners.size).toBe(1);
    expect(el.hasAttribute("is-matched")).toBe(true);
    expect(el.provision).toEqual({ mediaQuery: COARSE, isMatched: true });
    // a re-evaluation is not a change
    expect(change).not.toHaveBeenCalled();

    second.flip(false);
    expect(el.hasAttribute("is-matched")).toBe(false);
    expect(change).toHaveBeenCalledTimes(1);
  });
});
