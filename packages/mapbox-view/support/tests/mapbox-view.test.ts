import {
  parseCoordsFromTokens,
  parseNumsFromTokens,
  queueTask,
} from "../../src/utils";
import {
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/node_modules/vitest";

describe("mapbox-view utils", () => {
  it("parses coordinate tokens with offsets", () => {
    const result = parseCoordsFromTokens(["1", "2"], ["3", "4"]);
    expect(result).toEqual([4, 6]);
  });

  it("parses numeric tokens", () => {
    expect(parseNumsFromTokens(["1", "2", "3"])).toEqual([1, 2, 3]);
    expect(parseNumsFromTokens(["1", "x"])).toBeUndefined();
  });

  it("queues tasks until map is loaded", () => {
    const task = vi.fn();
    (window as unknown as { mapboxgl?: object }).mapboxgl = { version: "1" };
    const loadedMap = { _loaded: true, on: vi.fn() };
    queueTask(loadedMap as any, task);
    expect(task).toHaveBeenCalledWith(loadedMap, (window as any).mapboxgl);

    const on = vi.fn((_, cb: () => void) => cb());
    const pendingMap = { _loaded: false, on };
    const pendingTask = vi.fn();
    queueTask(pendingMap as any, pendingTask);
    expect(on).toHaveBeenCalled();
    expect(pendingTask).toHaveBeenCalledWith(
      pendingMap,
      (window as any).mapboxgl
    );
  });
});
