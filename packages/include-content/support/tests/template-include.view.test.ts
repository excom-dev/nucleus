import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  spyFetch,
  vi,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("template-include view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("includes a local template and a remote URL", async () => {
    spyFetch({
      body: "<p>A remote view piece.</p>",
      headers: new Headers({ "content-type": "text/html" }),
    });
    const { root } = await mountView(
      readDemo(import.meta.url, "template-include"),
    );
    const [local, remote] = root.querySelectorAll("include-content");
    expect(local.textContent).toMatch(/reusable view piece/);
    if (!remote.hasAttribute("did-load")) {
      await waitForEvent(remote, "include-content-did-render");
    }
    expect(remote.textContent).toMatch(/remote view piece/);
  });
});
