// Node built-ins loaded at call time, not imported: the library build targets
// browsers and stubs `node:` imports. Typed here: consumers need no Node types.
interface Builtins {
  "node:buffer": { Buffer: { from(data: string | Uint8Array): Uint8Array } };
  "node:module": { createRequire(url: string): (id: string) => unknown };
  "node:fs": {
    readFileSync(path: string): Uint8Array<ArrayBuffer>;
    realpathSync(path: string): string;
    statSync(
      path: string,
      options: { throwIfNoEntry: false }
    ): { isDirectory(): boolean } | undefined;
  };
  "node:path": {
    extname(path: string): string;
    isAbsolute(path: string): boolean;
    join(...paths: string[]): string;
    relative(from: string, to: string): string;
    resolve(...paths: string[]): string;
    sep: string;
  };
  "node:timers": { setTimeout(callback: () => void, ms: number): unknown };
  "node:url": { fileURLToPath(url: string | URL): string };
  "node:vm": { runInNewContext(code: string): unknown };
}

declare const process: {
  getBuiltinModule<K extends keyof Builtins>(id: K): Builtins[K];
};

export const builtin = <K extends keyof Builtins>(id: K): Builtins[K] =>
  process.getBuiltinModule(id);

/** Resolves a Node macrotask later, whichever timers `globalThis` carries. */
export const macrotask = (): Promise<void> =>
  new Promise((resolve) => builtin("node:timers").setTimeout(resolve, 0));
