import "@excom/include-content";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

describe("host-selector view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders into the selector mount point", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "host-selector"));
    expect(root.querySelector(".sidebar-mount")?.textContent).toBeTruthy();
  });
});
