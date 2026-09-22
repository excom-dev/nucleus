import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("with-format view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("formats the seeded phone number", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "with-format"));
    const input = root.querySelector("input")!;
    expect(input.value).toMatch(/\(\d{3}\)/);
  });
});
