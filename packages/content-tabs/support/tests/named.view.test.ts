import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
  wait,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

describe("named view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("pairs headers and bodies by tab-name", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "named"));
    const headerB = root.querySelector('content-tabs-header[tab-name="b"]')!;
    const bodyA = root.querySelector('content-tabs-body[tab-name="a"]')!;
    const bodyB = root.querySelector('content-tabs-body[tab-name="b"]')!;
    expect(bodyA.hasAttribute("is-open")).toBe(true);
    headerB.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wait(0);
    expect(bodyB.hasAttribute("is-open")).toBe(true);
    expect(bodyA.hasAttribute("is-open")).toBe(false);
  });
});
