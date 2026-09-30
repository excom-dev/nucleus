import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("defines the service-worker element", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "simple"));
    expect(root.querySelector("service-worker")).toBeTruthy();
  });
});
