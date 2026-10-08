import "@excom/quark-sheet";
import { LoopGuard } from "@excom/kit-utils";
import {
  afterEach,
  describe,
  expect,
  it,
  readFileRelative,
  vi,
} from "@excom/nucleus-test";
import {
  click,
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
} from "@excom/quark/support/tests/view-helpers";

const html = readFileRelative(import.meta.url, "../../public/views/timer-app/timer-app.html");
const quarkSrc = readFileRelative(
  import.meta.url,
  "../../public/views/timer-app/timer-app.quark",
);

/**
 * The clock is a CSS animation on the readout, which happy-dom does not run:
 * a tick here is the `animationiteration` event the browser would fire.
 */
const mountApp = async () => {
  const mounted = await mountView(html, quarkSrc);
  const { root } = mounted;
  const slider = root.querySelector<HTMLInputElement>('input[type="range"]')!;
  const gauge = root.querySelector("progress")!;
  const readout = root.querySelector<HTMLElement>("[bind-elapsed]")!;
  return {
    ...mounted,
    slider,
    gauge,
    readout,
    /** e, d and what shows them. `filled` is the gauge's fraction, capped as a `<progress>` caps it. */
    state: () => ({
      elapsed: root.getAttribute("data-elapsed"),
      duration: root.getAttribute("data-duration"),
      readout: readout.textContent,
      running: readout.getAttribute("aria-busy") === "true",
      filled: Math.min(
        1,
        Number(gauge.getAttribute("value")) / Number(gauge.getAttribute("max")),
      ),
    }),
    tick: async (times = 1) => {
      for (let i = 0; i < times; i++) {
        readout.dispatchEvent(new Event("animationiteration", { bubbles: true }));
        await flush();
      }
    },
    /** Move the slider without releasing it: `input` fires, `change` does not. */
    drag: (seconds: number) => {
      slider.value = String(seconds);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      return flush();
    },
    /** e as if that much time had passed. */
    elapse: (seconds: string) => {
      root.setAttribute("data-elapsed", seconds);
      return flush();
    },
  };
};

describe("timer-app view (7GUIs task 4)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows e in a gauge and as a number, d on a slider, and a reset button; e starts at zero", async () => {
    // the served markup, then the same once the sheet has run
    const served = document.createElement("div");
    served.innerHTML = html;
    expect(served.querySelector("progress")?.getAttribute("value")).toBe("0");
    expect(served.querySelector("progress")?.getAttribute("max")).toBe("10");
    expect(served.querySelector("[bind-elapsed]")?.textContent).toBe("0.0s");
    expect(served.querySelector("[bind-duration]")?.textContent).toBe("10s");
    expect(served.querySelector("button")?.textContent).toBe("Reset");

    const { root, state } = await mountApp();
    expect(state()).toEqual({
      elapsed: "0",
      duration: "10",
      readout: "0.0s",
      running: true,
      filled: 0,
    });
    expect(root.querySelector("[bind-duration]")?.textContent).toBe("10s");
  });

  it("a tick adds 0.1 s to e; the gauge and the number follow", async () => {
    const { quark, state, tick } = await mountApp();

    const meter = measureComplexity(quark!);
    await tick();
    const budget = meter.take();
    meter.stop();
    expect(state()).toMatchObject({ elapsed: "0.1", readout: "0.1s", filled: 0.01 });

    await tick(2);
    expect(state()).toMatchObject({ elapsed: "0.3", readout: "0.3s", filled: 0.03 });
    expectComplexity(budget);
  });

  it("adjusting S is reflected on d and on G immediately, not only when S is released", async () => {
    const { root, state, drag, elapse } = await mountApp();
    await elapse("5.0");
    expect(state()).toMatchObject({ duration: "10", filled: 0.5 });

    await drag(20);
    expect(state()).toMatchObject({ duration: "20", elapsed: "5.0", filled: 0.25, running: true });
    expect(root.querySelector("[bind-duration]")?.textContent).toBe("20s");

    await drag(8);
    expect(state()).toMatchObject({ duration: "8", elapsed: "5.0", filled: 0.625, running: true });
  });

  it("when e >= d the timer stops and G is full", async () => {
    const trips = vi.fn();
    const offTrip = LoopGuard.onTrip(trips);
    const { state, tick } = await mountApp();

    // the whole default run: 100 ticks of 0.1 s reach d = 10 exactly
    await tick(99);
    expect(state()).toMatchObject({ elapsed: "9.9", running: true });
    await tick();
    expect(state()).toEqual({
      elapsed: "10.0",
      duration: "10",
      readout: "10.0s",
      running: false,
      filled: 1,
    });

    // a tick that still arrives is not counted
    await tick(3);
    expect(state()).toMatchObject({ elapsed: "10.0", running: false });
    offTrip();
    expect(trips).not.toHaveBeenCalled();
  }, 30_000);

  it("dragging d below e while it runs leaves e where it is and stops the timer, G full", async () => {
    const { state, tick, drag, elapse } = await mountApp();
    await elapse("5.0");
    await tick();
    expect(state()).toMatchObject({ elapsed: "5.1", running: true });

    await drag(3);
    expect(state()).toEqual({
      elapsed: "5.1",
      duration: "3",
      readout: "5.1s",
      running: false,
      filled: 1,
    });
    await tick(2);
    expect(state()).toMatchObject({ elapsed: "5.1", running: false });
  });

  it("raising d above e after the timer stopped resumes ticking from e, until e >= d again", async () => {
    const { state, tick, drag, elapse } = await mountApp();
    await elapse("5.1");
    await drag(3);
    expect(state()).toMatchObject({ elapsed: "5.1", running: false });

    // d = e is not above e
    await drag(5);
    expect(state()).toMatchObject({ elapsed: "5.1", running: false });

    await drag(6);
    expect(state()).toMatchObject({ elapsed: "5.1", running: true, filled: 0.85 });
    await tick(2);
    expect(state()).toMatchObject({ elapsed: "5.3", readout: "5.3s", running: true });

    await tick(7);
    expect(state()).toMatchObject({ elapsed: "6.0", running: false, filled: 1 });
    await tick();
    expect(state()).toMatchObject({ elapsed: "6.0" });
  });

  it("clicking R resets e to zero", async () => {
    const { root, state, tick, drag, elapse } = await mountApp();
    await elapse("5.0");
    click(root.querySelector("button"));
    await flush();
    expect(state()).toEqual({
      elapsed: "0",
      duration: "10",
      readout: "0.0s",
      running: true,
      filled: 0,
    });
    await tick();
    expect(state()).toMatchObject({ elapsed: "0.1" });

    // from a stopped timer too: it runs again
    await drag(1);
    await elapse("1.0");
    expect(state()).toMatchObject({ running: false, filled: 1 });
    click(root.querySelector("button"));
    await flush();
    expect(state()).toMatchObject({ elapsed: "0", running: true, filled: 0 });
  });
});
