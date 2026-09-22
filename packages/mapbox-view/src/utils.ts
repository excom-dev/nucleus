import type { MapInstance } from "./types";
import type { TMapboxgl } from "./types";
import { isNumber } from "@excom/kit-utils";

export const EASINGS = {
  // Slow start, then speed up
  ["ease-in-cubic"]: function (t) {
    return t * t * t;
  },
  // Fast start, long slow wind-down
  ["ease-out-quint"]: function (t) {
    return 1 - Math.pow(1 - t, 5);
  },
  // Slow start and finish, fast middle
  ["ease-in-out-circ"]: function (t) {
    return t < 0.5
      ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
      : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;
  },
  // Fast start, bounce at the end
  ["ease-out-bounce"]: function (t) {
    const n1 = 7.5625;
    const d1 = 2.75;

    if (t < 1 / d1) {
      return n1 * t * t;
    } else if (t < 2 / d1) {
      return n1 * (t -= 1.5 / d1) * t + 0.75;
    } else if (t < 2.5 / d1) {
      return n1 * (t -= 2.25 / d1) * t + 0.9375;
    } else {
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
  },
};
export const parseCoordsFromTokens = (
  tokens: string[] | null = [],
  offsetTokens: string[] | null = []
): [number, number] | undefined => {
  if (tokens?.length === 2) {
    const long = Number(tokens[0]);
    const lat = Number(tokens[1]);
    if (isNumber(long) && isNumber(lat)) {
      const offset = parseCoordsFromTokens(offsetTokens);
      if (offset) {
        return [long + offset[0], lat + offset[1]];
      } else {
        return [long, lat];
      }
    }
  }
  return undefined;
};

export const parseNumsFromTokens = (
  tokens: string[] | null = []
): number[] | undefined => {
  const parsed = tokens?.map((t) => Number(t));
  if (parsed?.every(isNumber)) {
    return parsed as number[];
  }
  return undefined;
};

export const queueTask = (
  mapInstance?: MapInstance | null,
  task?: (m: MapInstance, mapboxgl: TMapboxgl) => any
) => {
  if (mapInstance) {
    if (mapInstance._loaded) {
      task?.(mapInstance, window["mapboxgl"] as unknown as TMapboxgl);
    } else {
      mapInstance.on("load", () => {
        task?.(mapInstance, window["mapboxgl"] as unknown as TMapboxgl);
      });
    }
  }
};
