import "@excom/quark-sheet";
import { Quark } from "@excom/quark";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  readFileRelative,
} from "@excom/nucleus-test";
import {
  click,
  flush,
  measureComplexity,
  mountView,
} from "@excom/quark/support/tests/view-helpers";
import * as circleDrawer from "../../public/views/circle-drawer-app/circle-drawer-app";

const html = readFileRelative(
  import.meta.url,
  "../../public/views/circle-drawer-app/circle-drawer-app.html",
);
const quarkSrc = readFileRelative(
  import.meta.url,
  "../../public/views/circle-drawer-app/circle-drawer-app.quark",
);

const originalLoader = Quark.moduleLoader;
const buttonProto = HTMLButtonElement.prototype as unknown as Record<string, unknown>;
const invokers = Object.getOwnPropertyDescriptor(buttonProto, "commandForElement");

/*
 * happy-dom has no layout, pointer or top layer: the tests give each event
 * the coordinates a browser would and read the State the sheet writes
 * (attributes, rows, their custom properties, which dialog is open).
 */
const mount = async () => {
  const { root, quark } = await mountView(html, quarkSrc);
  const canvas = root.querySelector<HTMLElement>("[bind-canvas]")!;
  const point = root.querySelector<HTMLButtonElement>("[bind-point]")!;
  const menu = root.querySelector<HTMLDialogElement>("#circle-menu")!;
  const adjust = root.querySelector<HTMLDialogElement>("#circle-adjust")!;
  const slider = adjust.querySelector<HTMLInputElement>("input")!;
  const button = (action: string) =>
    root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  // where the pointer is: a browser gives every pointer event its own coordinates
  const at = { x: 0, y: 0 };
  const pointer = (type: string, x: number, y: number) => {
    Object.assign(at, { x, y });
    return canvas.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, offsetX: x, offsetY: y }),
    );
  };
  return {
    root,
    quark: quark!,
    canvas,
    point,
    menu,
    adjust,
    slider,
    undo: button("undo"),
    redo: button("redo"),
    entry: menu.querySelector<HTMLButtonElement>("button")!,
    /** The history as the host holds it. */
    history: () => ({
      changes: JSON.parse(root.dataset.changes!),
      step: Number(root.dataset.step),
    }),
    /** Every circle on the canvas: centre, diameter as drawn, selected or not. */
    circles: () =>
      [...root.querySelectorAll<HTMLElement>("[bind-circles] li")].map((li) => ({
        x: Number(li.style.getPropertyValue("--x")),
        y: Number(li.style.getPropertyValue("--y")),
        d: Number(li.style.getPropertyValue("--d")),
        selected: li.hasAttribute("data-is-selected"),
      })),
    /** Move the pointer over the canvas. */
    moveTo: async (x: number, y: number) => {
      pointer("pointermove", x, y);
      await flush();
    },
    /** Move the pointer, then left-click there. */
    clickAt: async (x: number, y: number) => {
      pointer("pointermove", x, y);
      await flush();
      pointer("click", x, y);
      await flush();
    },
    /** A touch tap: the pointer goes down there without having moved there. */
    tapAt: async (x: number, y: number) => {
      pointer("pointerdown", x, y);
      await flush();
      pointer("click", x, y);
      await flush();
    },
    /** Right-click where the pointer is; `false` when the sheet took the event. */
    rightClick: async () => {
      const untouched = pointer("contextmenu", at.x, at.y);
      await flush();
      return untouched;
    },
    /** One event there and nothing before it: the pointer has not moved there. */
    only: async (type: "click" | "contextmenu", x: number, y: number) => {
      const untouched = pointer(type, x, y);
      await flush();
      return untouched;
    },
    /** Drag the slider of the open frame. */
    slide: async (diameter: number) => {
      slider.value = String(diameter);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
    },
    press: async (key: string) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      point.dispatchEvent(event);
      await flush();
      return event;
    },
  };
};

/** Right-click the circle under the pointer, choose the entry, slide, close. */
const adjustTo = async (app: Awaited<ReturnType<typeof mount>>, diameter: number) => {
  await app.rightClick();
  click(app.entry);
  await flush();
  await app.slide(diameter);
  app.adjust.close();
  await flush();
};

describe("circle-drawer-app view", () => {
  beforeEach(() => {
    Quark.moduleLoader = async (url: string) => {
      if (url.includes("circle-drawer-app")) return circleDrawer;
      throw new Error(`unexpected @use module: ${url}`);
    };
    // the test DOM's invoker shim gives `show-modal` / `close` no action:
    // without it, `@command` calls the dialog's own method
    delete buttonProto.commandForElement;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    Quark.moduleLoader = originalLoader;
    if (invokers) Object.defineProperty(buttonProto, "commandForElement", invokers);
  });

  it("is a frame containing an undo and redo button as well as a canvas area underneath", async () => {
    const { root, canvas, undo, redo, menu, adjust, circles, history } = await mount();

    expect([...root.querySelectorAll("[data-action]")].map((b) => b.textContent)).toEqual([
      "Undo",
      "Redo",
    ]);
    expect(
      redo.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // the task's initial state: an empty canvas, nothing to undo or redo
    expect(circles()).toEqual([]);
    expect(history()).toEqual({ changes: [], step: 0 });
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
    expect(menu.open).toBe(false);
    expect(adjust.open).toBe(false);
  });

  it("left-clicking inside an empty area creates an unfilled circle with a fixed diameter whose center is the left-clicked point", async () => {
    const { canvas, circles, clickAt, tapAt, moveTo, history, undo } = await mount();

    await clickAt(120, 80);
    await tapAt(260, 150);
    // same diameter, each centred on its click
    expect(circles().map(({ x, y, d }) => ({ x, y, d }))).toEqual([
      { x: 120, y: 80, d: 40 },
      { x: 260, y: 150, d: 40 },
    ]);
    expect(history().step).toBe(2);
    expect(undo.disabled).toBe(false);

    // unfilled: away from the pointer, no circle carries the gray fill's attribute
    await moveTo(20, 230);
    expect(circles().map((c) => c.selected)).toEqual([false, false]);
    expect(canvas.closest("[data-selected]")).toBeNull();

    // not an empty area: a click inside a circle draws nothing
    await clickAt(125, 85);
    expect(circles()).toHaveLength(2);
    expect(history().step).toBe(2);
  });

  it("the circle nearest to the pointer, its centre closer than its radius, is the selected circle", async () => {
    const app = await mount();
    const { root, circles, clickAt, moveTo } = app;
    await clickAt(100, 100);
    await clickAt(200, 100);
    // widen both to 120 so they overlap between x = 140 and x = 160
    await moveTo(100, 100);
    await adjustTo(app, 120);
    await moveTo(200, 100);
    await adjustTo(app, 120);

    const selected = () => circles().map((c) => c.selected);
    await moveTo(145, 100); // inside both, nearer the first
    expect(selected()).toEqual([true, false]);
    expect(root.dataset.selected).toBe("1");
    await moveTo(155, 100); // inside both, nearer the second
    expect(selected()).toEqual([false, true]);
    expect(root.dataset.selected).toBe("2");
    await moveTo(100, 159); // 59 from the first centre: inside its radius of 60
    expect(selected()).toEqual([true, false]);
    await moveTo(100, 160); // exactly the radius: not less than it
    expect(selected()).toEqual([false, false]);
    expect(root.hasAttribute("data-selected")).toBe(false);
  });

  it("right-clicking the selected circle makes a popup menu appear with one entry \"Adjust diameter..\"", async () => {
    const { menu, clickAt, moveTo, rightClick } = await mount();
    await clickAt(120, 80);

    // empty canvas: the browser's own menu, not ours
    await moveTo(300, 200);
    expect(await rightClick()).toBe(true);
    expect(menu.open).toBe(false);

    await moveTo(125, 85);
    expect(await rightClick()).toBe(false);
    expect(menu.open).toBe(true);
    expect([...menu.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Adjust diameter..",
    ]);

    // a click beside the menu dismisses it and changes nothing
    click(menu);
    await flush();
    expect(menu.open).toBe(false);
  });

  it("a click draws at its own point, not at the point the last move left", async () => {
    const { root, circles, only, history } = await mount();
    const stale = [Number(root.dataset.x), Number(root.dataset.y)];

    await only("click", 119, 109);
    expect(history().changes).toEqual([{ id: 1, x: 119, y: 109, d: 40 }]);
    expect(stale).not.toEqual([119, 109]);
    // the point follows the click, and with it the selection
    expect([root.dataset.x, root.dataset.y]).toEqual(["119", "109"]);
    expect(circles()).toEqual([{ x: 119, y: 109, d: 40, selected: true }]);
  });

  it("a click on empty canvas draws a circle and opens no menu while the last point is still in another circle", async () => {
    const { root, menu, circles, clickAt, only } = await mount();
    await clickAt(120, 110);
    expect(root.dataset.selected).toBe("1");

    await only("click", 300, 200);
    expect(menu.open).toBe(false);
    expect(circles().map(({ x, y, selected }) => ({ x, y, selected }))).toEqual([
      { x: 120, y: 110, selected: false },
      { x: 300, y: 200, selected: true },
    ]);
  });

  it("a right-click acts on its own point: a circle's menu opens without a move first, empty canvas opens none", async () => {
    const { root, menu, clickAt, moveTo, only, history } = await mount();
    await clickAt(120, 110);
    await moveTo(300, 200); // the point is on empty canvas

    expect(await only("contextmenu", 125, 105)).toBe(false);
    expect(menu.open).toBe(true);
    expect(root.dataset.selected).toBe("1");
    menu.close();

    // the point is in the circle; the right-click is not
    expect(await only("contextmenu", 300, 200)).toBe(true);
    expect(menu.open).toBe(false);
    expect(root.hasAttribute("data-selected")).toBe(false);
    expect(history().step).toBe(1);
  });

  it("clicking the entry opens another frame with a slider that adjusts the diameter of the selected circle; changes are applied immediately", async () => {
    const app = await mount();
    const { root, menu, adjust, slider, entry, circles, clickAt, moveTo, rightClick, slide, history } = app;
    await clickAt(120, 80);
    await clickAt(260, 150);
    await moveTo(262, 148);
    await rightClick();

    click(entry);
    await flush();
    expect(menu.open).toBe(false);
    expect(adjust.open).toBe(true);
    // the frame knows its circle: the label names it, the slider starts at its diameter
    expect(adjust.querySelector("[bind-centre]")?.textContent).toBe("(260, 150)");
    expect(slider.type).toBe("range");
    expect(slider.value).toBe("40");

    await slide(90);
    expect(circles().map((c) => c.d)).toEqual([40, 90]);
    await slide(64);
    expect(circles().map((c) => c.d)).toEqual([40, 64]);
    // drawn, but not history until the frame closes
    expect(root.dataset.diameter).toBe("64");
    expect(history().step).toBe(2);
    expect(history().changes).toHaveLength(2);
  });

  it("closing the frame marks the last diameter as significant for the undo/redo history", async () => {
    const app = await mount();
    const { root, adjust, entry, undo, circles, clickAt, rightClick, slide, history } = app;
    await clickAt(120, 80);
    await rightClick();
    click(entry);
    await flush();
    await slide(90);
    await slide(64);

    adjust.close();
    await flush();
    // one change for the whole adjustment, holding the last diameter only
    expect(history()).toEqual({
      changes: [
        { id: 1, x: 120, y: 80, d: 40 },
        { id: 1, x: 120, y: 80, d: 64 },
      ],
      step: 2,
    });
    expect(root.hasAttribute("data-diameter")).toBe(false);
    expect(circles().map((c) => c.d)).toEqual([64]);
    click(undo);
    await flush();
    expect(circles().map((c) => c.d)).toEqual([40]);

    // a frame closed on the diameter it opened with leaves no change
    await rightClick();
    click(entry);
    await flush();
    await slide(70);
    await slide(40);
    adjust.close();
    await flush();
    expect(history().step).toBe(1);
    expect(history().changes).toHaveLength(2);
  });

  it("clicking undo undoes the last significant change (circle creation or diameter adjustment)", async () => {
    const app = await mount();
    const { undo, redo, circles, clickAt, moveTo } = app;
    await clickAt(120, 80);
    await clickAt(260, 150);
    await moveTo(120, 80);
    await adjustTo(app, 100);
    const drawn = () => circles().map(({ x, y, d }) => ({ x, y, d }));
    expect(drawn()).toEqual([
      { x: 120, y: 80, d: 100 },
      { x: 260, y: 150, d: 40 },
    ]);

    click(undo); // the adjustment
    await flush();
    expect(drawn()).toEqual([
      { x: 120, y: 80, d: 40 },
      { x: 260, y: 150, d: 40 },
    ]);
    click(undo); // the second circle
    await flush();
    expect(drawn()).toEqual([{ x: 120, y: 80, d: 40 }]);
    expect(undo.disabled).toBe(false);
    expect(redo.disabled).toBe(false);
    click(undo); // the first circle
    await flush();
    expect(drawn()).toEqual([]);
    expect(undo.disabled).toBe(true);
  });

  it("clicking redo reapplies the last undone change unless new changes were made by the user in the meantime", async () => {
    const app = await mount();
    const { undo, redo, circles, clickAt, moveTo, history } = app;
    await clickAt(120, 80);
    await moveTo(120, 80);
    await adjustTo(app, 100);
    const drawn = () => circles().map(({ x, y, d }) => ({ x, y, d }));

    click(undo);
    await flush();
    click(undo);
    await flush();
    expect(drawn()).toEqual([]);
    click(redo);
    await flush();
    expect(drawn()).toEqual([{ x: 120, y: 80, d: 40 }]);
    click(redo);
    await flush();
    expect(drawn()).toEqual([{ x: 120, y: 80, d: 100 }]);
    expect(redo.disabled).toBe(true);

    // a new change after an undo: the undone one is gone for good
    click(undo);
    await flush();
    await clickAt(300, 200);
    expect(redo.disabled).toBe(true);
    expect(history()).toEqual({
      changes: [
        { id: 1, x: 120, y: 80, d: 40 },
        { id: 2, x: 300, y: 200, d: 40 },
      ],
      step: 2,
    });
    click(redo); // disabled: a stray click must not move the step either
    await flush();
    expect(drawn()).toEqual([
      { x: 120, y: 80, d: 40 },
      { x: 300, y: 200, d: 40 },
    ]);
  });

  it("works with the keyboard: arrow keys move the point, Enter draws a circle or opens the selected circle's menu", async () => {
    const { root, canvas, point, menu, adjust, entry, circles, press, slide, history } = await mount();
    // the size a browser would lay the canvas out at
    Object.defineProperty(canvas, "clientWidth", { value: 300 });
    Object.defineProperty(canvas, "clientHeight", { value: 200 });
    const at = () => [Number(root.dataset.x), Number(root.dataset.y)];
    const [x, y] = at();

    expect((await press("ArrowRight")).defaultPrevented).toBe(true);
    await press("ArrowDown");
    await press("ArrowDown");
    expect(at()).toEqual([x + 10, y + 20]);
    await press("ArrowLeft");
    await press("ArrowUp");
    expect(at()).toEqual([x, y + 10]);
    // the point stays on the canvas
    for (let i = 0; i < 20; i++) await press("ArrowRight");
    for (let i = 0; i < 15; i++) await press("ArrowUp");
    expect(at()).toEqual([300, 0]);
    await press("ArrowLeft");
    await press("ArrowDown");
    expect(point.style.getPropertyValue("--x")).toBe("290");
    expect(point.style.getPropertyValue("--y")).toBe("10");

    // Enter on a button is a click that carries no position (offset 0, 0):
    // on empty canvas it draws at the cursor's point
    click(point);
    await flush();
    expect(circles()).toEqual([{ x: 290, y: 10, d: 40, selected: true }]);
    // the point now sits in that circle: Enter opens its menu, and draws nothing
    click(point);
    await flush();
    expect(menu.open).toBe(true);
    expect(circles()).toHaveLength(1);
    click(entry);
    await flush();
    await slide(80);
    adjust.close();
    await flush();
    expect(history().changes.at(-1)).toEqual({ id: 1, x: 290, y: 10, d: 80 });
  });

  it("a pointer moving inside the selected circle costs the same however many circles are drawn", async () => {
    const cost = async (count: number) => {
      const { root, quark, circles, clickAt, moveTo } = await mount();
      for (let i = 0; i < count; i++) await clickAt(30 + 50 * (i % 6), 30 + 50 * Math.floor(i / 6));
      await moveTo(28, 30);
      const meter = measureComplexity(quark);
      await moveTo(33, 34);
      const { ruleRuns, variableRuns, attributeRuns, listenerRuns, setAttribute, textContent, importNode } =
        meter.take();
      meter.stop();
      expect(circles().filter((c) => c.selected)).toHaveLength(1);
      root.remove();
      return { ruleRuns, variableRuns, attributeRuns, listenerRuns, setAttribute, textContent, importNode };
    };

    // the point's rule runs; no circle's does, and the history is not read again
    const few = await cost(2);
    expect(await cost(12)).toEqual(few);
    expect(few).toMatchObject({ listenerRuns: 0, textContent: 0, importNode: 0 });
  });
});
