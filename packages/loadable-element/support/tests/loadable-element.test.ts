import { LoadableElement } from "../../index";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
} from "@excom/nucleus-test";

const TAG = "loadable-element-test";
if (!customElements.get(TAG)) {
  LoadableElement.define(TAG);
}
// Events use the base's config tag (`noop-tag`), not the defined tag
// (same as FetchableElement).
const EVT = (name: string) => `noop-tag-${name}`;

const listen = (el: HTMLElement, type: string) => {
  const spy = vi.fn();
  el.addEventListener(type, spy);
  return spy;
};

describe("LoadableElement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("starts with no state and no provision", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    expect(el.isLoading).toBeFalsy();
    expect(el.isSuccess).toBeFalsy();
    expect(el.isError).toBeFalsy();
    expect(el.provision).toBeFalsy();
  });

  it("_setLoading reflects is-loading and emits the loading event", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const loading = listen(el, EVT("loading"));
    el._setLoading();
    expect(el).dom.to.equalTag(`<${TAG} is-loading></${TAG}>`);
    expect(loading).toHaveBeenCalledTimes(1);
  });

  it("_setSuccess publishes the provision, flips to is-success and emits with detail", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const success = listen(el, EVT("success"));
    const provisioned = listen(el, "neutron-provision");
    el._setLoading();
    el._setSuccess({ ok: true });
    expect(el).dom.to.equalTag(`<${TAG} is-success did-load></${TAG}>`);
    expect(el.provision).toEqual({ ok: true });
    expect(success).toHaveBeenCalledTimes(1);
    expect(success.mock.calls[0][0].detail).toEqual({ ok: true });
    expect(provisioned).toHaveBeenCalledTimes(1);
  });

  it("_setError stores the error as provision, flips to is-error and emits with detail", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const error = listen(el, EVT("error"));
    el._setLoading();
    el._setError({ message: "boom" });
    expect(el).dom.to.equalTag(`<${TAG} is-error></${TAG}>`);
    expect(el.provision).toEqual({ message: "boom" });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0].detail).toEqual({ message: "boom" });
  });

  it("states are mutually exclusive across transitions", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    el._setSuccess(1);
    el._setLoading();
    expect(el).dom.to.equalTag(`<${TAG} is-loading did-load></${TAG}>`);
    el._setError("x");
    expect(el).dom.to.equalTag(`<${TAG} is-error></${TAG}>`);
    el._setSuccess(2);
    expect(el).dom.to.equalTag(`<${TAG} is-success did-load></${TAG}>`);
  });

  it("_resetLoadState clears every state silently and keeps the provision and did-load", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const spies = ["loading", "success", "error"].map((t) =>
      listen(el, EVT(t))
    );
    el._setSuccess("kept");
    spies.forEach((s) => s.mockClear());
    el._resetLoadState();
    expect(el).dom.to.equalTag(`<${TAG} did-load></${TAG}>`);
    expect(el.provision).toBe("kept");
    spies.forEach((s) => expect(s).not.toHaveBeenCalled());
  });

  it("did-load stays through a refresh with the last provision, and clears on error", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    el._setLoading();
    expect(el.didLoad).toBeFalsy();
    el._setSuccess("first");
    el._setLoading();
    expect(el).dom.to.equalTag(`<${TAG} is-loading did-load></${TAG}>`);
    expect(el.provision).toBe("first");
    el._setError({ message: "boom" });
    expect(el).dom.to.equalTag(`<${TAG} is-error></${TAG}>`);
    expect(el.provision).toEqual({ message: "boom" });
    el._setLoading();
    expect(el).dom.to.equalTag(`<${TAG} is-loading></${TAG}>`);
  });
});
