import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

describe("with-format view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("formats the seeded phone number", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "with-format"));
    const input = root.querySelector("input")!;
    expect(input.value).toMatch(/\(\d{3}\)/);
    expect(input.inputMode).toBe("numeric");
  });
});
