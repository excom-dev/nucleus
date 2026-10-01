/** A happy-dom `Window` seen as a browser `window`. */
export type DomWindow = Window & typeof globalThis;

/**
 * `true` the first time `key` marks `target`. happy-dom shares element
 * classes between windows, so shims mark what they patch, not the window.
 */
export const claim = (target: object, key: symbol): boolean =>
  !Object.hasOwn(target, key) &&
  Reflect.defineProperty(target, key, { value: true });
