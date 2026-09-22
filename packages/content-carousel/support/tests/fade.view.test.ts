import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("fade view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("starts on the first fade slide", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "fade"));
    const carousel = root.querySelector("content-carousel")!;
    expect(carousel.getAttribute("slide-animation")).toBe("fade");
    expect(
      root.querySelector("content-carousel-slide")?.hasAttribute("is-active"),
    ).toBe(true);
  });
});
