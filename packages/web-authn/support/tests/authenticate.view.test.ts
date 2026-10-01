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
import { mountView } from "@excom/quark/support/tests/view-helpers";

describe("authenticate view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts the authenticate form", async () => {
    spyFetch({
      status: 200,
      body: JSON.stringify({ challenge: "x" }),
    });
    const { root } = await mountView(readDemo(import.meta.url, "authenticate"));
    expect(root.querySelector("web-authn")?.getAttribute("start-method")).toBe(
      "authenticate",
    );
    expect(root.querySelector("button")?.textContent).toMatch(/passkey/);
  });
});
