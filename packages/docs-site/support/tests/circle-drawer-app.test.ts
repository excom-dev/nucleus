import { describe, expect, it } from "@excom/nucleus-test";
import { nearest } from "../../public/views/circle-drawer-app/circle-drawer-app";

const circle = (id: number, x: number, y: number, d: number) => ({ id, x, y, d });

describe("nearest", () => {
  const a = circle(1, 100, 100, 40);
  const b = circle(2, 200, 100, 40);

  it("is the circle that contains the point", () => {
    expect(nearest([a, b], 105, 95)).toBe(a);
    expect(nearest([a, b], 190, 110)).toBe(b);
  });

  it("is null on empty canvas", () => {
    expect(nearest([a, b], 150, 100)).toBeNull();
    expect(nearest([], 100, 100)).toBeNull();
  });

  it("needs the centre closer than the radius: the edge itself is outside", () => {
    expect(nearest([a], 119, 100)).toBe(a);
    expect(nearest([a], 120, 100)).toBeNull();
    expect(nearest([a], 100, 80)).toBeNull();
  });

  it("is the nearest centre when several circles contain the point, whatever their order or size", () => {
    const wide = circle(3, 100, 100, 300);
    const near = circle(4, 180, 100, 60);
    expect(nearest([wide, near], 170, 100)).toBe(near);
    expect(nearest([near, wide], 170, 100)).toBe(near);
    expect(nearest([wide, near], 130, 100)).toBe(wide);
  });

  it("gives a tie to the later circle, the one drawn on top", () => {
    const left = circle(5, 100, 100, 80);
    const right = circle(6, 140, 100, 80);
    expect(nearest([left, right], 120, 100)).toBe(right);
    expect(nearest([right, left], 120, 100)).toBe(left);
  });

  it("reads a missing list as an empty canvas", () => {
    expect(nearest(undefined, 0, 0)).toBeNull();
    expect(nearest(null, 0, 0)).toBeNull();
  });
});
