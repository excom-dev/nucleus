import "@excom/include-content";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

describe("host-shadow view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts a shadow-host include-content", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "host-shadow"));
    expect(root.querySelector("include-content")).toBeTruthy();
  });
});
