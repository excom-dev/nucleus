import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("auto-plays from slide one to two", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "simple"));
    const slides = root.querySelectorAll("content-carousel-slide");
    expect(slides[0].hasAttribute("is-active")).toBe(true);
    await wait(1600);
    expect(slides[1].hasAttribute("is-active")).toBe(true);
    expect(slides[0].hasAttribute("is-active")).toBe(false);
  });
});
