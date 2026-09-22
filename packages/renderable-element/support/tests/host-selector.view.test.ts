import "@excom/include-content";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("host-selector view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders into the selector mount point", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "host-selector"));
    expect(root.querySelector(".sidebar-mount")?.textContent).toBeTruthy();
  });
});
