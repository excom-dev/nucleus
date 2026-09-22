window.__DEPENDENCY_PROMISES__ = window.__DEPENDENCY_PROMISES__ || {};

type TDepGlobalName = string;
declare global {
  interface Window {
    __DEPENDENCY_PROMISES__: Record<TDepGlobalName, Promise<any> | undefined>;
  }
}

/* Load an ESM module or a UMD script; return the export / global. */
export async function loadDependency<T = any>(
  type: "esm" | "umd",
  uri: string,
  globalName?: TDepGlobalName
): Promise<T> {
  if (type === "esm") {
    return import(/* @vite-ignore */ uri);
  } else if (type === "umd" && globalName) {
    if (window[globalName]) {
      return window[globalName];
    }
    if (!window.__DEPENDENCY_PROMISES__[globalName]) {
      window.__DEPENDENCY_PROMISES__[globalName] = new Promise(
        (resolve, reject) => {
          const script = document.createElement("script");
          script.src = uri;
          document.body.appendChild(script);
          script.onload = () => resolve(window[globalName]);
          script.onerror = () =>
            reject(new Error(`Failed to load dependency: ${globalName}`));
        }
      );
    }
    return window.__DEPENDENCY_PROMISES__[globalName]!;
  } else {
    throw new Error(
      `Invalid dependency load request: ${type} | ${uri} | ${globalName}`
    );
  }
}
