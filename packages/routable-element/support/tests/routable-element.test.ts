import { RoutableElement } from "../../index";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const TAG = "routable-element-test";
if (!customElements.get(TAG)) {
  RoutableElement.define(TAG);
}

describe("RoutableElement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("throws when routeChanged is not implemented", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    expect(() => el.routeChanged()).toThrowError(/routeChanged/);
  });

  it("has default props", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    expect(el).dom.to.equalTag(`<${TAG}></${TAG}>`);
  });

  it("sets routeInstance to null on disconnect when routeHref is set", async () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    el.routeChanged = vi.fn();
    el.routeHref = "/test";
    await wait(0);
    el.remove();
    await wait(0);
    expect(el.routeInstance).toBeNull();
  });
});
