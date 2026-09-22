export const requestIdleCb = (
  cb: (arg?: { didTimeout: boolean; timeRemaining: () => number }) => void,
  fallbackDelay: number = 1
) => {
  if (window.requestIdleCallback) {
    /* Use the caller delay as a timeout so idle work can't race ahead of
       "wait until after paint" (Safari fallback already uses
       `fallbackDelay` as setTimeout ms). */
    return window.requestIdleCallback(cb, { timeout: fallbackDelay });
  } else {
    const start = Date.now();
    return setTimeout(() => {
      cb({
        didTimeout: false,
        timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
      });
    }, fallbackDelay);
  }
};

/*
 * unused
 * export const cancelIdleCb = (id: number) => {
 *   if (window.cancelIdleCallback) {
 *     window.cancelIdleCallback(id);
 *   } else {
 *     clearTimeout(id);
 *   }
 * };
 */
