/**
 * Cross-package loop: an event-emitting Adapter (`dom-observer`) and a Quark
 * `@on` block that writes the attribute the Adapter observes. Every hop is
 * asynchronous (MutationObserver → event → deferred paint), so only the
 * shared loop guard's address-carried depth can see it as one chain.
 */
import "../../index";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { LoopGuard, type LoopGuardTrip } from "@excom/kit-utils";

describe("nucleus-kit: loop guard across elements and Quark", () => {
  let trips: LoopGuardTrip[];
  let off: () => void;

  beforeEach(() => {
    LoopGuard.reset();
    LoopGuard.configure({ limit: 6, log: () => {} });
    trips = [];
    off = LoopGuard.onTrip((trip) => trips.push(trip));
  });

  afterEach(() => {
    off();
    LoopGuard.reset();
    document.body.innerHTML = "";
  });

  const settle = async (done: () => boolean, ticks = 400) => {
    for (let i = 0; i < ticks && !done(); i++) await wait(0);
  };

  it("cuts an attribute → event → @on block → attribute cycle", async () => {
    const root = fixture<HTMLElement>(
      `<section>
        <quark-sheet>
          dom-observer {
            @on dom-observer-change {
              #box { data-n: attr("data-n") + "x"; }
            }
          }
        </quark-sheet>
        <dom-observer target-ref="#box"><div id="box" data-n=""></div></dom-observer>
      </section>`
    );
    const box = root.querySelector("#box")!;
    await wait(0);
    await wait(0);
    // kick the cycle from outside: one mutation → change event → block
    // writes `data-n` → another mutation → …
    box.setAttribute("data-n", "start");
    await settle(() => trips.length > 0);
    expect(trips.length).toBeGreaterThanOrEqual(1);
    expect(trips[0]).toMatchObject({ kind: "depth", target: box, name: "data-n" });
    const value = box.getAttribute("data-n")!;
    expect(value.length).toBeLessThanOrEqual("start".length + LoopGuard.limit);
    // dead: nothing changes any more
    for (let i = 0; i < 10; i++) await wait(0);
    expect(box.getAttribute("data-n")).toBe(value);
  });

  it("does not trip when each change is an external one", async () => {
    const root = fixture<HTMLElement>(
      `<section>
        <quark-sheet>
          dom-observer {
            @on dom-observer-change {
              #box { data-seen: attr("data-n"); }
            }
          }
        </quark-sheet>
        <dom-observer target-ref="#box"><div id="box" data-n=""></div></dom-observer>
      </section>`
    );
    const box = root.querySelector("#box")!;
    await wait(0);
    await wait(0);
    for (let i = 1; i <= 10; i++) {
      box.setAttribute("data-n", String(i));
      await settle(() => box.getAttribute("data-seen") === String(i), 40);
    }
    expect(box.getAttribute("data-seen")).toBe("10");
    expect(trips).toEqual([]);
  });
});
