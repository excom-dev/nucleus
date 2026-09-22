import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("switches the open tab", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "simple"));
    const headers = root.querySelectorAll("content-tabs-header");
    const bodies = root.querySelectorAll("content-tabs-body");
    expect(headers[0].hasAttribute("is-open")).toBe(true);
    expect(bodies[0].hasAttribute("is-open")).toBe(true);
    headers[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wait(0);
    expect(headers[1].hasAttribute("is-open")).toBe(true);
    expect(bodies[1].hasAttribute("is-open")).toBe(true);
    expect(headers[0].hasAttribute("is-open")).toBe(false);
    expect(bodies[0].hasAttribute("is-open")).toBe(false);
  });
});
