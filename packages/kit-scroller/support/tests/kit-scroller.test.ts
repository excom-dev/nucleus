import { getNearestScrollableContainer, scrollElementIntoView } from "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/node_modules/vitest";

describe("getNearestScrollableContainer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns document when no scrollable ancestors exist", () => {
    const child = document.createElement("div");
    document.body.appendChild(child);
    const result = getNearestScrollableContainer(child);
    expect(result).toBe(document);
  });

  it("returns nearest scrollable ancestor on y-axis", () => {
    const container = document.createElement("div");
    container.style.overflowY = "auto";
    Object.defineProperty(container, "scrollHeight", {
      value: 200,
      configurable: true,
    });
    Object.defineProperty(container, "clientHeight", {
      value: 100,
      configurable: true,
    });
    const child = document.createElement("div");
    container.appendChild(child);
    document.body.appendChild(container);
    const result = getNearestScrollableContainer(child);
    expect(result).toBe(container);
  });

  it("returns nearest scrollable ancestor on x-axis", () => {
    const container = document.createElement("div");
    container.style.overflowX = "auto";
    Object.defineProperty(container, "scrollWidth", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(container, "clientWidth", {
      value: 200,
      configurable: true,
    });
    const child = document.createElement("div");
    container.appendChild(child);
    document.body.appendChild(container);
    const result = getNearestScrollableContainer(child, "x");
    expect(result).toBe(container);
  });

  it("skips elements with overflow hidden", () => {
    const hidden = document.createElement("div");
    hidden.style.overflowY = "hidden";
    Object.defineProperty(hidden, "scrollHeight", {
      value: 200,
      configurable: true,
    });
    Object.defineProperty(hidden, "clientHeight", {
      value: 100,
      configurable: true,
    });
    const child = document.createElement("div");
    hidden.appendChild(child);
    document.body.appendChild(hidden);
    const result = getNearestScrollableContainer(child);
    expect(result).toBe(document);
  });

  it("skips non-scrollable overflow auto elements", () => {
    const container = document.createElement("div");
    container.style.overflowY = "auto";
    Object.defineProperty(container, "scrollHeight", {
      value: 100,
      configurable: true,
    });
    Object.defineProperty(container, "clientHeight", {
      value: 100,
      configurable: true,
    });
    const child = document.createElement("div");
    container.appendChild(child);
    document.body.appendChild(container);
    const result = getNearestScrollableContainer(child);
    expect(result).toBe(document);
  });

  it("finds deeply nested scrollable container", () => {
    const outer = document.createElement("div");
    const middle = document.createElement("div");
    middle.style.overflowY = "scroll";
    Object.defineProperty(middle, "scrollHeight", {
      value: 300,
      configurable: true,
    });
    Object.defineProperty(middle, "clientHeight", {
      value: 100,
      configurable: true,
    });
    const inner = document.createElement("div");
    const child = document.createElement("div");
    inner.appendChild(child);
    middle.appendChild(inner);
    outer.appendChild(middle);
    document.body.appendChild(outer);
    expect(getNearestScrollableContainer(child)).toBe(middle);
  });
});

describe("scrollElementIntoView", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("returns empty object when element is null", () => {
    const result = scrollElementIntoView(null as any);
    expect(result).toEqual({});
  });

  it("throws when element is not visible", () => {
    const el = document.createElement("div");
    el.checkVisibility = () => false;
    document.body.appendChild(el);
    expect(() => scrollElementIntoView(el, { block: "start" })).toThrow(
      "checkVisibility",
    );
  });

  it("returns empty when no axis specified", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const result = scrollElementIntoView(el);
    expect(result).toEqual({});
  });

  it("scrolls on y-axis when block is specified", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    scrollElementIntoView(el, { block: "start", onlyIfNeeded: false });
    expect(scrollToSpy).toHaveBeenCalled();
  });
});
