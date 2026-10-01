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

describe("file-tabs view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("switches file tab bodies", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "file-tabs"));
    const headers = root.querySelectorAll("content-tabs-header");
    const bodies = root.querySelectorAll("content-tabs-body");
    expect(root.classList.contains("file-tabs")).toBe(true);
    headers[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wait(0);
    expect(bodies[1].hasAttribute("is-open")).toBe(true);
    expect(bodies[1].textContent).toMatch(/double/);
  });
});
