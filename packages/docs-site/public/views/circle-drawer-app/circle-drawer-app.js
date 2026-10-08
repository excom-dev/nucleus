/** Circle Drawer example helper (`@use "/views/circle-drawer-app/circle-drawer-app.js"`). */

/**
 * The circle a point selects: of the circles whose centre is closer to the
 * point than their radius, the nearest. `null` on empty canvas. Quark
 * expressions take no callbacks, so the search is the app's one function.
 * @param {{ id: number, x: number, y: number, d: number }[]} circles
 * @param {number} x
 * @param {number} y
 */
export const nearest = (circles, x, y) =>
  (circles ?? [])
    .map((circle) => ({
      circle,
      distance: Math.hypot(circle.x - x, circle.y - y),
    }))
    .filter(({ circle, distance }) => distance < circle.d / 2)
    // a tie goes to the later circle: it is drawn on top
    .reduce((best, hit) => (best?.distance < hit.distance ? best : hit), null)
    ?.circle ?? null;
