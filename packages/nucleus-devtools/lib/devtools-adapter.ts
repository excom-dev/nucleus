/**
 * The slice of the extension API the pane uses, behind a small interface so
 * the selection source (and the `<devtools-selection>` Adapter) can be driven
 * by a fake in tests.
 */
export type DevtoolsPort = {
  postMessage: (message: unknown) => void;
  onMessage: (cb: (message: unknown) => void) => void;
  onDisconnect: (cb: () => void) => void;
};

export type DevtoolsAdapter = {
  /** `inspectedWindow.eval`, resolves `null` on exception. */
  evalInPage: <T>(expression: string) => Promise<T | null>;
  /** `runtime.onMessage`; returns a disposer. */
  onRuntimeMessage: (cb: (message: unknown) => void) => () => void;
  /** `devtools.panels.elements.onSelectionChanged`; returns a disposer. */
  onSelectionChanged: (cb: () => void) => () => void;
  /** `runtime.connect({ name })`. */
  connectPort: (name: string) => DevtoolsPort;
};

/** Minimal structural type of the WebExtension API object we touch. */
export type BrowserLike = {
  devtools: {
    inspectedWindow: {
      eval: (
        expression: string,
        cb: (result: unknown, exception: unknown) => void,
      ) => void;
    };
    panels: {
      elements: {
        onSelectionChanged: {
          addListener: (cb: () => void) => void;
          removeListener: (cb: () => void) => void;
        };
      };
    };
  };
  runtime: {
    onMessage: {
      addListener: (cb: (message: unknown) => void) => void;
      removeListener: (cb: (message: unknown) => void) => void;
    };
    connect: (info: { name: string }) => {
      postMessage: (message: unknown) => void;
      onMessage: { addListener: (cb: (message: unknown) => void) => void };
      onDisconnect: { addListener: (cb: () => void) => void };
    };
  };
};

/**
 * The extension API object for this page. WXT's `browser` is an auto-import
 * inside `entrypoints/`, not a global: Chrome pages expose `chrome`, Firefox
 * (and the polyfill) expose `browser`. Everything the adapter calls is
 * callback-based, so both shapes work unchanged.
 */
export const resolveExtensionApi = (): BrowserLike => {
  const g = globalThis as Record<string, unknown>;
  const api = ((g.browser as BrowserLike | undefined)?.runtime
    ? g.browser
    : g.chrome) as BrowserLike | undefined;
  if (!api?.runtime || !api.devtools) {
    throw new Error(
      "nucleus-devtools: extension API unavailable — the pane must run inside a DevTools sidebar page",
    );
  }
  return api;
};

export const createBrowserAdapter = (
  browser: BrowserLike = resolveExtensionApi(),
): DevtoolsAdapter => ({
  evalInPage: <T>(expression: string) =>
    new Promise<T | null>((resolve) => {
      browser.devtools.inspectedWindow.eval(expression, (result, exception) => {
        if (exception) {
          resolve(null);
          return;
        }
        resolve((result as T) ?? null);
      });
    }),
  onRuntimeMessage: (cb) => {
    browser.runtime.onMessage.addListener(cb);
    return () => browser.runtime.onMessage.removeListener(cb);
  },
  onSelectionChanged: (cb) => {
    browser.devtools.panels.elements.onSelectionChanged.addListener(cb);
    return () =>
      browser.devtools.panels.elements.onSelectionChanged.removeListener(cb);
  },
  connectPort: (name) => {
    const port = browser.runtime.connect({ name });
    return {
      postMessage: (message) => port.postMessage(message),
      onMessage: (cb) => port.onMessage.addListener(cb),
      onDisconnect: (cb) => port.onDisconnect.addListener(cb),
    };
  },
});
