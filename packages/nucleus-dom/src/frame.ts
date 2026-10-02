import type { DomWindow } from "./window";

type Win = DomWindow | typeof globalThis;
type Frame = {
  page: { context: { cookieContainer: { clearCookies(): void } } };
} & Record<symbol, { clear(): void }>;

const symbolNamed = (object: object, name: string) =>
  Object.getOwnPropertySymbols(object).find(
    (symbol) => symbol.description === name
  );

/**
 * happy-dom's browser frame behind `win`: private, but `happyDOM.setURL()`
 * hands it to the location's URL setter. Found by name, as the shims find
 * happy-dom's other internals: a test runner may load another copy.
 */
const frameOf = (win: Win): Frame | undefined => {
  const { location } = win;
  const setURL = symbolNamed(Object.getPrototypeOf(location), "setURL");
  if (!setURL) return undefined;
  let frame: Frame | undefined;
  Object.defineProperty(location, setURL, {
    configurable: true,
    value(this: Location, browserFrame: Frame, url: string) {
      frame = browserFrame;
      return Object.getPrototypeOf(this)[setURL].call(this, browserFrame, url);
    },
  });
  try {
    (
      win as unknown as { happyDOM: { setURL(url: string): void } }
    ).happyDOM.setURL(location.href);
  } finally {
    delete (location as unknown as Record<symbol, unknown>)[setURL];
  }
  return frame;
};

/** Forgets the cookies and history entries of `win`'s earlier pages. */
export const forgetVisits = (win: Win): void => {
  const frame = frameOf(win);
  if (!frame) return;
  frame.page.context.cookieContainer.clearCookies();
  const history = symbolNamed(frame, "history");
  if (history) frame[history].clear();
};
