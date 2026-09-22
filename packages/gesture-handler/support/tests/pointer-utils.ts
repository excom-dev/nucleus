/** Synthetic touch gestures for view tests: down on `target`, moves / ups on `window` (as pointer capture delivers them). */
const pointerEvent = (type: string, x: number, y: number) =>
  new PointerEvent(type, {
    pointerId: 1,
    pointerType: "touch",
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });

export const frame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Press at `from`, move in two frames to `to`; returns the release. */
export const drag = async (
  target: Element,
  from: { x: number; y: number },
  to: { x: number; y: number }
) => {
  target.dispatchEvent(pointerEvent("pointerdown", from.x, from.y));
  window.dispatchEvent(
    pointerEvent("pointermove", (from.x + to.x) / 2, (from.y + to.y) / 2)
  );
  await frame();
  window.dispatchEvent(pointerEvent("pointermove", to.x, to.y));
  await frame();
  return () => window.dispatchEvent(pointerEvent("pointerup", to.x, to.y));
};
export const pull = async (
  target: Element,
  from: { x: number; y: number },
  to: { x: number; y: number }
) => {
  target.dispatchEvent(pointerEvent("pointerdown", from.x, from.y));
  const touch = new Touch({
    identifier: 1,
    target,
    clientX: from.x + Math.sign(to.x - from.x) * 8,
    clientY: from.y + Math.sign(to.y - from.y) * 8,
  });
  const first = new TouchEvent("touchmove", {
    touches: [touch],
    changedTouches: [touch],
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(first);
  await frame();
  window.dispatchEvent(pointerEvent("pointermove", to.x, to.y));
  await frame();
  return {
    first,
    release: () => window.dispatchEvent(pointerEvent("pointerup", to.x, to.y)),
  };
};

export const tap = async (target: Element, x = 10, y = 10) => {
  target.dispatchEvent(pointerEvent("pointerdown", x, y));
  await frame();
  window.dispatchEvent(pointerEvent("pointerup", x, y));
};
