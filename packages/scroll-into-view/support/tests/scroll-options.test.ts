import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
// `vi` must come from "vitest" itself so `vi.mock` is hoisted with it
import { vi } from "vitest";
import { scrollElementIntoView } from "@excom/kit-scroller";
import "../../index";

// Intercept the scroller so the options `<scroll-into-view>` derives from its
// attributes can be asserted directly (layout is meaningless in the test DOM).
vi.mock("@excom/kit-scroller", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@excom/kit-scroller")>();
  return { ...original, scrollElementIntoView: vi.fn(() => ({})) };
});

const scrollMock = vi.mocked(scrollElementIntoView);

// actionHandler waits for a frame and then a macrotask before scrolling
const settle = () => wait(50);

describe("scroll-into-view (option parsing)", () => {
  beforeEach(() => {
    scrollMock.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("passes the default alignment, offsets and behavior", async () => {
    const el = fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view></scroll-into-view>`,
    );
    await settle();
    expect(scrollMock).toHaveBeenCalledTimes(1);
    expect(scrollMock).toHaveBeenCalledWith(el, {
      block: "start",
      inline: "nearest",
      offsetInline: 0,
      offsetBlock: 0,
      behavior: "auto",
      onlyIfNeeded: false,
    });
  });

  it("maps scroll-align, scroll-offset, scroll-behavior and if-needed", async () => {
    const el = fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view scroll-align="center end" scroll-offset="10 -20" scroll-behavior="smooth" if-needed></scroll-into-view>`,
    );
    await settle();
    expect(scrollMock).toHaveBeenCalledWith(el, {
      block: "end",
      inline: "center",
      offsetInline: 10,
      offsetBlock: -20,
      behavior: "smooth",
      onlyIfNeeded: true,
    });
  });

  it("skips an axis whose alignment token is `none`", async () => {
    const el = fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view scroll-align="none none"></scroll-into-view>`,
    );
    await settle();
    expect(scrollMock).toHaveBeenCalledWith(el, {
      block: undefined,
      inline: undefined,
      offsetInline: 0,
      offsetBlock: 0,
      behavior: "auto",
      onlyIfNeeded: false,
    });
  });

  it("falls back to nearest / start for missing alignment tokens", async () => {
    const el = fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view scroll-align="end"></scroll-into-view>`,
    );
    expect(el.scrollAlign).toEqual(["end"]);
    await settle();
    expect(scrollMock).toHaveBeenLastCalledWith(
      el,
      expect.objectContaining({ inline: "end", block: "start" }),
    );

    scrollMock.mockClear();
    el.scrollAlign = [];
    el.actionHandler();
    await settle();
    expect(scrollMock).toHaveBeenLastCalledWith(
      el,
      expect.objectContaining({ inline: "nearest", block: "start" }),
    );
  });

  it("drops non-numeric offsets", async () => {
    const el = fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view scroll-offset="abc xyz"></scroll-into-view>`,
    );
    await settle();
    expect(scrollMock).toHaveBeenCalledWith(
      el,
      expect.objectContaining({
        offsetInline: undefined,
        offsetBlock: undefined,
      }),
    );
  });

  it("resolves target-ref relative to itself", async () => {
    const wrapper = fixture<HTMLDivElement>(
      `<div>
        <p id="scroll-target-a">a</p>
        <scroll-into-view target-ref="#scroll-target-a"></scroll-into-view>
      </div>`,
    );
    await settle();
    expect(scrollMock).toHaveBeenCalledWith(
      wrapper.querySelector("#scroll-target-a"),
      expect.any(Object),
    );
  });

  it("hands a missing target-ref to the scroller as null", async () => {
    fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view target-ref="#does-not-exist"></scroll-into-view>`,
    );
    await settle();
    expect(scrollMock).toHaveBeenCalledWith(null, expect.any(Object));
  });
});

describe("scroll-into-view (triggers)", () => {
  beforeEach(() => {
    scrollMock.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not scroll on connect when listen-for is set, only on the event", async () => {
    const el = fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view listen-for="click">Go</scroll-into-view>`,
    );
    await settle();
    expect(scrollMock).not.toHaveBeenCalled();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(scrollMock).toHaveBeenCalledTimes(1);
    expect(scrollMock).toHaveBeenCalledWith(el, expect.any(Object));
  });

  it("does not scroll on connect when listen-for-lifecycle is set", async () => {
    fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view listen-for-lifecycle="disconnected"></scroll-into-view>`,
    );
    await settle();
    expect(scrollMock).not.toHaveBeenCalled();
  });
});
