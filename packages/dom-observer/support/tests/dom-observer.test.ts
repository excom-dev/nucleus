import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";

describe("dom-observer", () => {
  /*
   * Listen at document before any fixture, so the sync
   * `dom-observer-change` on connect is captured.
   */
  let events: CustomEvent[];
  const listener = (e: Event) => events.push(e as CustomEvent);

  beforeEach(() => {
    events = [];
    document.addEventListener("dom-observer-change", listener);
  });

  afterEach(() => {
    document.removeEventListener("dom-observer-change", listener);
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("emits dom-observer-change once the target is resolved", async () => {
    const target = document.createElement("div");
    target.id = "watched";
    document.body.appendChild(target);

    const el = fixture<HTMLDomObserverElement>(
      `<dom-observer target-ref="#watched"></dom-observer>`,
    );

    await wait(0);
    expect(events.length).toBe(1);
    expect(events[0].detail.mutations).toEqual([]);
    expect(el.targetElement).toBe(target);
  });

  it("emits dom-observer-change on attribute mutations of the target", async () => {
    const target = document.createElement("div");
    target.id = "watched";
    document.body.appendChild(target);

    fixture<HTMLDomObserverElement>(
      `<dom-observer target-ref="#watched"></dom-observer>`,
    );
    await wait(0);
    events.length = 0;

    target.setAttribute("data-state", "active");
    await wait(0);

    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1];
    expect(last.detail.mutations[0].type).toBe("attributes");
    expect(last.detail.mutations[0].attributeName).toBe("data-state");
  });

  it("emits dom-observer-change on childList mutations of the target", async () => {
    const target = document.createElement("ul");
    target.id = "watched";
    document.body.appendChild(target);

    fixture<HTMLDomObserverElement>(
      `<dom-observer target-ref="#watched"></dom-observer>`,
    );
    await wait(0);
    events.length = 0;

    target.appendChild(document.createElement("li"));
    await wait(0);

    const types = events.flatMap((e) =>
      (e.detail.mutations as MutationRecord[]).map((m) => m.type),
    );
    expect(types).toContain("childList");
  });

  it("waits for the target to appear before observing", async () => {
    const el = fixture<HTMLDomObserverElement>(
      `<dom-observer target-ref="#late"></dom-observer>`,
    );
    await wait(0);
    expect(events.length).toBe(0);
    expect(el.targetElement).toBeFalsy();

    const target = document.createElement("section");
    target.id = "late";
    document.body.appendChild(target);
    await wait(0);

    expect(el.targetElement).toBe(target);
    expect(events.length).toBe(1);
    expect(events[0].detail.mutations).toEqual([]);
  });

  it("observes a <template>'s .content fragment", async () => {
    const tpl = document.createElement("template");
    tpl.id = "rows";
    tpl.innerHTML = "<li>seed</li>";
    document.body.appendChild(tpl);

    fixture<HTMLDomObserverElement>(
      `<dom-observer target-ref="#rows"></dom-observer>`,
    );
    await wait(0);
    events.length = 0;

    // Mutating `template.content` must surface; `.content` is a
    // DocumentFragment outside the `<template>` descendant tree.
    const li = document.createElement("li");
    li.textContent = "added";
    tpl.content.appendChild(li);
    await wait(0);

    const types = events.flatMap((e) =>
      (e.detail.mutations as MutationRecord[]).map((m) => m.type),
    );
    expect(types).toContain("childList");
  });

  it("emits dom-observer-change on characterData mutations of the target", async () => {
    const target = document.createElement("p");
    target.id = "watched";
    target.textContent = "before";
    document.body.appendChild(target);

    fixture<HTMLDomObserverElement>(
      `<dom-observer target-ref="#watched"></dom-observer>`,
    );
    await wait(0);
    events.length = 0;

    (target.firstChild as Text).data = "after";
    await wait(0);

    const types = events.flatMap((e) =>
      (e.detail.mutations as MutationRecord[]).map((m) => m.type),
    );
    expect(types).toContain("characterData");
  });

  it("finds a late target nested inside an inserted subtree", async () => {
    const el = fixture<HTMLDomObserverElement>(
      `<dom-observer target-ref="#late-nested"></dom-observer>`,
    );
    await wait(0);
    expect(el.targetElement).toBeFalsy();

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `<section><p id="late-nested"></p></section>`;
    document.body.appendChild(wrapper);
    await wait(0);

    expect(el.targetElement).toBe(wrapper.querySelector("#late-nested"));
    expect(events.length).toBe(1);
  });

  it("re-targets while still waiting for the first target", async () => {
    const target = document.createElement("div");
    target.id = "watched";
    document.body.appendChild(target);

    const el = fixture<HTMLDomObserverElement>(
      `<dom-observer target-ref="#never-appears"></dom-observer>`,
    );
    await wait(0);
    expect(el.targetFindingObserver).toBeTruthy();
    expect(events.length).toBe(0);

    el.targetRef = "#watched";
    await wait(0);
    expect(el.targetElement).toBe(target);
    expect(el.targetFindingObserver).toBeNull();
    expect(events.length).toBe(1);

    // the abandoned finder no longer switches targets
    const late = document.createElement("div");
    late.id = "never-appears";
    document.body.appendChild(late);
    await wait(0);
    expect(el.targetElement).toBe(target);
  });

  it("re-observes when target-ref moves to another resolved element", async () => {
    const first = document.createElement("div");
    first.id = "first";
    const second = document.createElement("div");
    second.id = "second";
    document.body.append(first, second);

    const el = fixture<HTMLDomObserverElement>(
      `<dom-observer target-ref="#first"></dom-observer>`,
    );
    await wait(0);
    expect(el.targetElement).toBe(first);
    events.length = 0;

    el.targetRef = "#second";
    await wait(0);
    expect(el.targetElement).toBe(second);
    // seeds listeners from the new target
    expect(events.length).toBe(1);
    expect(events[0].detail.target).toBe(second);
    events.length = 0;

    first.setAttribute("data-state", "ignored");
    await wait(0);
    expect(events.length).toBe(0);

    second.setAttribute("data-state", "seen");
    await wait(0);
    expect(events.length).toBe(1);
    expect(events[0].detail.target).toBe(second);
    expect(events[0].detail.mutations[0].attributeName).toBe("data-state");
  });

  it("stops observing when the target is cleared", async () => {
    const target = document.createElement("div");
    target.id = "watched";
    document.body.appendChild(target);

    const el = fixture<HTMLDomObserverElement>(
      `<dom-observer target-ref="#watched"></dom-observer>`,
    );
    await wait(0);
    expect(el.targetChangeObserver).toBeTruthy();
    events.length = 0;

    el.targetElement = null;
    await wait(0);
    expect(el.targetChangeObserver).toBeNull();

    target.setAttribute("data-state", "cleared");
    await wait(0);
    expect(events.length).toBe(0);
  });

  it("keeps observing across a synchronous move", async () => {
    const target = document.createElement("div");
    target.id = "watched";
    document.body.appendChild(target);

    const el = fixture<HTMLDomObserverElement>(
      `<dom-observer target-ref="#watched"></dom-observer>`,
    );
    await wait(0);
    events.length = 0;

    const other = document.createElement("div");
    document.body.appendChild(other);
    other.appendChild(el);
    await wait(0);
    expect(el.targetElement).toBe(target);
    expect(events.length).toBe(0);

    target.setAttribute("data-state", "moved");
    await wait(0);
    expect(events.length).toBe(1);
  });

  it("re-resolves the target after a real disconnect and reconnect", async () => {
    const target = document.createElement("div");
    target.id = "watched";
    document.body.appendChild(target);

    const el = fixture<HTMLDomObserverElement>(
      `<dom-observer target-ref="#watched"></dom-observer>`,
    );
    await wait(0);
    el.remove();
    await wait(0);
    expect(el.targetElement).toBeNull();
    events.length = 0;

    document.body.appendChild(el);
    await wait(0);
    expect(el.targetElement).toBe(target);
    expect(events.length).toBe(1);
    expect(events[0].detail.mutations).toEqual([]);

    target.setAttribute("data-state", "reconnected");
    await wait(0);
    expect(events.length).toBe(2);
  });

  it("reconnects without a target-ref as a no-op", async () => {
    const el = fixture<HTMLDomObserverElement>(`<dom-observer></dom-observer>`);
    await wait(0);
    el.remove();
    await wait(0);
    expect(() => document.body.appendChild(el)).not.toThrow();
    await wait(0);
    expect(el.targetElement).toBeFalsy();
    expect(el.targetFindingObserver).toBeFalsy();
    expect(events.length).toBe(0);
  });

  it("disconnects observers when disconnected", async () => {
    const target = document.createElement("div");
    target.id = "watched";
    document.body.appendChild(target);

    const el = fixture<HTMLDomObserverElement>(
      `<dom-observer target-ref="#watched"></dom-observer>`,
    );
    await wait(0);
    events.length = 0;

    el.remove();
    await wait(0);

    target.setAttribute("data-state", "after-disconnect");
    await wait(0);
    expect(events.length).toBe(0);
    expect(el.targetElement).toBeNull();
  });
});
