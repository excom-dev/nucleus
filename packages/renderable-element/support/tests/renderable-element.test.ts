import { RenderableElement } from "../../index";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { KitLogger } from "@excom/kit-logger";

const TAG = "renderable-element-test";
if (!customElements.get(TAG)) {
  RenderableElement.define(TAG);
}

describe("RenderableElement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    KitLogger.unsuppress();
  });

  it("defines a custom element tag", () => {
    expect(customElements.get(TAG)).toBeTruthy();
  });

  it("starts with default state", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    expect(el).dom.to.equalTag(`<${TAG}></${TAG}>`);
    expect(el._persistedTree).toBeFalsy();
  });

  it("resolves render promise handlers", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const resolve = vi.fn();
    const reject = vi.fn();
    el.readyPromiseObject = { resolve, reject, promise: Promise.resolve() };
    el.tryCompleteReady("renderChildren");
    expect(resolve).toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
    expect(el.readyPromiseObject).toBeNull();
  });

  it("tryCompleteReady is a no-op when no promise object", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    el.readyPromiseObject = null;
    el.tryCompleteReady("renderChildren");
    expect(el.readyPromiseObject).toBeNull();
  });

  it("tryCompleteReady is a no-op for a non-responsible caller", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const resolve = vi.fn();
    const reject = vi.fn();
    el.readyPromiseObject = { resolve, reject, promise: Promise.resolve() };
    el.tryCompleteReady("doProvision");
    expect(resolve).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
    expect(el.readyPromiseObject).toBeTruthy();
  });

  it("has default preFetch of lazy", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    expect(el.preFetch).toBe("lazy");
  });

  it("accepts eager preFetch", () => {
    KitLogger.suppress();
    const el = fixture<any>(`<${TAG} pre-fetch="eager"></${TAG}>`);
    expect(el.preFetch).toBe("eager");
  });

  it("renderChildren does nothing when no template content", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const result = el.renderChildren();
    expect(result).toBeFalsy();
  });

  it("renders inline template content when isActive is set", async () => {
    KitLogger.suppress();
    const el = fixture<any>(
      `<${TAG}><template><p>Hello</p></template></${TAG}>`,
    );
    el.isActive = true;
    await wait(50);
    expect(el.querySelector("p")?.textContent).toBe("Hello");
    expect(el).dom.to.equalTag(
      `<${TAG} is-active did-load></${TAG}>`,
    );
    // Without persist-content, the live tree is not retained on the element
    expect(el._persistedTree).toBeFalsy();
  });

  it("removes rendered content when isActive is unset", async () => {
    KitLogger.suppress();
    const el = fixture<any>(
      `<${TAG}><template><p>Temp</p></template></${TAG}>`,
    );
    el.isActive = true;
    await wait(50);
    expect(el.querySelector("p")).not.toBeNull();

    el.isActive = false;
    await wait(50);
    expect(el.querySelector("p")).toBeNull();
    // `did-load` stays set (warm re-resolve); no persisted live tree
    expect(el).dom.to.equalTag(`<${TAG} did-load></${TAG}>`);
    expect(el._persistedTree).toBeFalsy();
  });

  it("keeps didLoad but not _persistedTree when unrendered without persistContent", async () => {
    KitLogger.suppress();
    const el = fixture<any>(
      `<${TAG}><template><span>X</span></template></${TAG}>`,
    );
    el.isActive = true;
    await wait(50);
    expect(el.didLoad).toBe(true);
    expect(el._persistedTree).toBeFalsy();

    el.isActive = false;
    await wait(50);
    expect(el.didLoad).toBe(true);
    expect(el._persistedTree).toBeFalsy();

    el.isActive = true;
    await wait(50);
    expect(el.querySelector("span")?.textContent).toBe("X");
    expect(el._persistedTree).toBeFalsy();
  });

  it("retains live nodes on _persistedTree when persistContent is true", async () => {
    KitLogger.suppress();
    const el = fixture<any>(
      `<${TAG} persist-content><template><span>Keep</span></template></${TAG}>`,
    );
    el.isActive = true;
    await wait(50);
    const live = el.querySelector("span");
    expect(live).not.toBeNull();
    expect(el._persistedTree).toBeTruthy();

    el.isActive = false;
    await wait(50);
    expect(el.didLoad).toBe(true);
    expect(el._persistedTree).toBeTruthy();

    el.isActive = true;
    await wait(50);
    expect(el.querySelector("span")).toBe(live);
  });

  it("bypassCache defaults to false", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    expect(el.bypassCache).toBeFalsy();
  });

  it("startReady creates a ready promise and tryCompleteReady resolves it", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    el.startReady();
    expect(el.readyPromiseObject).toBeTruthy();
    const { promise, resolve, reject } = el.readyPromiseObject;
    const resolveSpy = vi.fn(resolve);
    const rejectSpy = vi.fn(reject);
    el.readyPromiseObject = { promise, resolve: resolveSpy, reject: rejectSpy };
    el.tryCompleteReady("renderChildren");
    expect(resolveSpy).toHaveBeenCalled();
    expect(rejectSpy).not.toHaveBeenCalled();
    expect(el.readyPromiseObject).toBeNull();
  });

  it("startReady is a no-op when a ready promise already exists", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    el.startReady();
    const first = el.readyPromiseObject;
    el.startReady();
    expect(el.readyPromiseObject).toBe(first);
  });

  it("startTeardown rejects ready and emits aborted while loading", async () => {
    KitLogger.suppress();
    const el = fixture<any>(
      `<${TAG}><template><p>X</p></template></${TAG}>`,
    );
    el.isLoading = true;
    el.startReady();
    const readyPromise = el.readyPromiseObject!.promise;
    const aborted = waitForEvent(el, "aborted");
    el.startTeardown();
    await aborted;
    await expect(readyPromise).rejects.toBeUndefined();
    expect(el.isLoading).toBe(false);
    expect(el.readyPromiseObject).toBeNull();
  });

  it("startTeardown unrenders painted content when idle", async () => {
    KitLogger.suppress();
    const el = fixture<any>(
      `<${TAG}><template><p>Hi</p></template></${TAG}>`,
    );
    el.isActive = true;
    await wait(50);
    expect(el.querySelector("p")).not.toBeNull();

    el.startTeardown();
    await wait(0);
    expect(el.querySelector("p")).toBeNull();
  });

  it("tryCompleteReady rejects when passed reject", async () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    el.startReady();
    const readyPromise = el.readyPromiseObject!.promise;
    el.tryCompleteReady("startTeardown", "reject");
    await expect(readyPromise).rejects.toBeUndefined();
    expect(el.readyPromiseObject).toBeNull();
  });

});
