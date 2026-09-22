import { AbortableElement } from "../../index";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const TAG = "abortable-element-test";
if (!customElements.get(TAG)) {
  AbortableElement.define(TAG);
}

describe("AbortableElement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("has a fresh AbortController by default", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    expect(el.abortController).toBeInstanceOf(AbortController);
    expect(el.abortController.signal.aborted).toBe(false);
  });

  it("aborts and returns a fresh controller", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const initial = el.abortController;
    expect(initial).toBeInstanceOf(AbortController);
    el.doAbort("test");
    expect(initial.signal.aborted).toBe(true);
    expect(el.abortController).toBeInstanceOf(AbortController);
    expect(el.abortController).not.toBe(initial);
    expect(el.abortController.signal.aborted).toBe(false);
  });

  it("passes abort reason to the signal", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const controller = el.abortController;
    el.doAbort("custom-reason");
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe("custom-reason");
  });

  it("can abort multiple times, each producing a new controller", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const first = el.abortController;
    el.doAbort();
    const second = el.abortController;
    el.doAbort();
    const third = el.abortController;
    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(third.signal.aborted).toBe(false);
  });
});
