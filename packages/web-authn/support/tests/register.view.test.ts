import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
  spyFetch,
} from "@excom/nucleus-test";
import { flush, mountView } from "@excom/quark/support/tests/view-helpers";

describe("register view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts the register form (no authenticator in happy-dom)", async () => {
    spyFetch({
      status: 200,
      body: JSON.stringify({ rp: { name: "demo" }, user: { id: "1" }, challenge: "x" }),
    });
    const { root } = await mountView(readDemo(import.meta.url, "register"));
    expect(root.querySelector("web-authn")?.getAttribute("start-method")).toBe(
      "register",
    );
    expect(root.querySelector('input[name="username"]')).toBeTruthy();
    await flush();
  });
});
