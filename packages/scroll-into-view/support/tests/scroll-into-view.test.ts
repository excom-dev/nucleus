import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";

describe("scroll-into-view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("invokes scroll on connect when no triggers configured", async () => {
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});
    fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view></scroll-into-view>`,
    );
    await wait(50);
    expect(scrollToSpy).toHaveBeenCalled();
  });

  it("scrolls target element when targetRef is set", async () => {
    const target = document.createElement("div");
    target.id = "scroll-target";
    document.body.appendChild(target);
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});
    fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view target-ref="#scroll-target"></scroll-into-view>`,
    );
    await wait(50);
    expect(scrollToSpy).toHaveBeenCalled();
  });

  it("defaults scrollAlign to nearest/start", () => {
    const el = fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view></scroll-into-view>`,
    );
    expect(el.scrollAlign).toEqual(["nearest", "start"]);
  });

  it("defaults scrollBehavior to auto", () => {
    const el = fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view></scroll-into-view>`,
    );
    expect(el.scrollBehavior).toBe("auto");
  });

  it("defaults scrollOffset to 0 0", () => {
    const el = fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view></scroll-into-view>`,
    );
    expect(el.scrollOffset).toEqual(["0", "0"]);
  });

  it("accepts custom scroll-align", () => {
    const el = fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view scroll-align="center end"></scroll-into-view>`,
    );
    expect(el.scrollAlign).toEqual(["center", "end"]);
  });

  it("accepts custom scroll-offset", () => {
    const el = fixture<HTMLScrollIntoViewElement>(
      `<scroll-into-view scroll-offset="10 20"></scroll-into-view>`,
    );
    expect(el.scrollOffset).toEqual(["10", "20"]);
  });
});
