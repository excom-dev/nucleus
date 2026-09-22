import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { flush, mountView, readDemo } from "@excom/quark/support/tests/view-helpers";
import { lastFake, resetFakes, stubMatchMedia } from "./fake-match-media";

const DARK = "(prefers-color-scheme: dark)";

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    resetFakes();
  });

  it("reflects the dark color scheme and follows its change", async () => {
    stubMatchMedia({ [DARK]: true });
    const { root } = await mountView(readDemo(import.meta.url, "simple"));
    const el = root.querySelector("detect-media")!;

    expect(el.getAttribute("media-query")).toBe(DARK);
    expect(el.hasAttribute("is-matched")).toBe(true);

    lastFake().flip(false);
    await flush();
    expect(el.hasAttribute("is-matched")).toBe(false);
  });
});
