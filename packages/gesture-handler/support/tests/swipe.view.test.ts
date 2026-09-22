import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  flush,
  mountView,
  readDemo,
} from "@excom/quark/support/tests/view-helpers";
import { drag, tap } from "./pointer-utils";

describe("swipe view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("flicks the card away and taps it back", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "swipe"));
    const handler = root as HTMLGestureHandlerElement;
    const card = root.querySelector("article")!;

    // a fling: release right after the last move
    const release = await drag(card, { x: 50, y: 50 }, { x: 130, y: 50 });
    await wait(2);
    release();
    expect(handler.getAttribute("last-gesture")).toBe("swipe-right");
    expect(handler.provision?.snap).toBe(1);
    await wait(0);
    await flush();
    expect(handler.style.getPropertyValue("--gesture-progress")).toBe("1");
    expect(card.hasAttribute("data-is-dismissed")).toBe(true);

    await tap(card);
    await flush();
    expect(handler.getAttribute("last-gesture")).toBe("tap");
    expect(handler.style.getPropertyValue("--gesture-progress")).toBe("0");
    expect(card.hasAttribute("data-is-dismissed")).toBe(false);
  });
});
