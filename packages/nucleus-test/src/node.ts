// Node built-ins loaded at call time, not imported: the library build targets
// browsers and stubs `node:` imports. Typed here: consumers need no Node types.
interface Builtins {
  "node:fs": {
    readFileSync(path: string | URL, encoding: "utf8"): string;
    readFileSync(path: string): Uint8Array<ArrayBuffer>;
    statSync(
      path: string,
      options: { throwIfNoEntry: false }
    ): { isDirectory(): boolean } | undefined;
  };
  "node:path": {
    extname(path: string): string;
    join(...paths: string[]): string;
    relative(from: string, to: string): string;
    resolve(...paths: string[]): string;
  };
  "node:url": { fileURLToPath(url: string | URL): string };
}

declare const process: {
  getBuiltinModule<K extends keyof Builtins>(id: K): Builtins[K];
};

export const builtin = <K extends keyof Builtins>(id: K): Builtins[K] =>
  process.getBuiltinModule(id);
