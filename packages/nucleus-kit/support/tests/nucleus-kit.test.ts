import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/node_modules/vitest";

describe("nucleus-kit", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("registers a few shared elements", () => {
    expect(customElements.get("content-drawer")).toBeTruthy();
    expect(customElements.get("detect-browser")).toBeTruthy();
    expect(customElements.get("dom-observer")).toBeTruthy();
  });
});
