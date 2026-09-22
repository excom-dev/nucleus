import "@excom/event-handler";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  click,
  flush,
  mountView,
  readDemo,
} from "@excom/quark/support/tests/view-helpers";

describe("manual view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("steps forward and back", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "manual"));
    const slides = root.querySelectorAll("content-carousel-slide");
    const next = root.querySelector("[rel='next']");
    const prev = root.querySelector("[rel='prev']");
    expect(slides[0].hasAttribute("is-active")).toBe(true);
    click(next);
    await flush();
    expect(slides[1].hasAttribute("is-active")).toBe(true);
    click(prev);
    await flush();
    expect(slides[0].hasAttribute("is-active")).toBe(true);
  });
});
