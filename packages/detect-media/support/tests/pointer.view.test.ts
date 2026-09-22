import "@excom/include-content";
import "@excom/quark-sheet";
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

const COARSE = "(pointer: coarse)";

describe("pointer view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    resetFakes();
  });

  it("activates the touch or pointer layout from is-matched, live", async () => {
    stubMatchMedia({ [COARSE]: true });
    const { root } = await mountView(readDemo(import.meta.url, "pointer"));
    await flush();
    const touch = root.querySelector("[bind-touch]")!;
    const pointer = root.querySelector("[bind-pointer]")!;

    expect(touch.hasAttribute("is-active")).toBe(true);
    expect(pointer.hasAttribute("is-active")).toBe(false);

    lastFake().flip(false);
    await flush();

    expect(pointer.hasAttribute("is-active")).toBe(true);
    expect(touch.hasAttribute("is-active")).toBe(false);
  });
});
