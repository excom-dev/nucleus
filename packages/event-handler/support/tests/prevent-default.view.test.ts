import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

describe("prevent-default view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("cancels the native link click", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "prevent-default"));
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    root.querySelector("a")!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
