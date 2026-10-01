import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

describe("template-ref view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the shared template into the active host", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "template-ref"));
    const hosts = root.querySelectorAll("include-content");
    expect(hosts[0].textContent).toMatch(/Shared template/);
    expect(hosts[0].hasAttribute("is-active")).toBe(true);
  });
});
