import "@excom/include-content";
import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
  vi,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

describe("safari view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders the install hint on iOS Safari", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IOS_SAFARI);
    const { root } = await mountView(readDemo(import.meta.url, "safari"));
    const include = root.querySelector("include-content")!;
    expect(include.hasAttribute("is-active")).toBe(true);
    expect(include.textContent).toMatch(/Add to Home Screen/);
  });

  it("renders nothing in other browsers", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "safari"));
    const include = root.querySelector("include-content")!;
    expect(root.querySelector("detect-browser")!.getAttribute("browser-name")).not.toBe(
      "safari",
    );
    expect(include.hasAttribute("is-active")).toBe(false);
    expect(include.textContent?.trim()).toBe("");
  });
});
