import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

describe("portal view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("portals content into the aside", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "portal"));
    expect(root.querySelector("#ic-portal-mount")?.textContent).toMatch(
      /Portaled/,
    );
  });
});
