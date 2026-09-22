import { vi } from "@excom/heft-rig/profiles/default/config/test-utils";

export type FakeMediaQueryList = {
  media: string;
  matches: boolean;
  listeners: Set<EventListener>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  /** Set `matches` and dispatch `change` to every subscribed listener. */
  flip: (matches: boolean) => void;
};

export const fakes: FakeMediaQueryList[] = [];

const createFake = (media: string, matches: boolean): FakeMediaQueryList => {
  const listeners = new Set<EventListener>();
  const fake: FakeMediaQueryList = {
    media,
    matches,
    listeners,
    addEventListener: vi.fn((_type: string, fn: EventListener) => {
      listeners.add(fn);
    }),
    removeEventListener: vi.fn((_type: string, fn: EventListener) => {
      listeners.delete(fn);
    }),
    flip(next) {
      fake.matches = next;
      const event = Object.assign(new Event("change"), { matches: next, media });
      [...listeners].forEach((fn) => fn(event));
    },
  };
  fakes.push(fake);
  return fake;
};

/**
 * Stub `window.matchMedia`. Each call returns a fresh fake whose
 * `matches` comes from `matching[query]` (default `false`).
 */
export const stubMatchMedia = (matching: Record<string, boolean> = {}) =>
  vi
    .spyOn(window, "matchMedia")
    .mockImplementation(
      (media: string) =>
        createFake(media, matching[media] ?? false) as unknown as MediaQueryList
    );

export const lastFake = () => fakes[fakes.length - 1];

export const resetFakes = () => {
  fakes.length = 0;
};
