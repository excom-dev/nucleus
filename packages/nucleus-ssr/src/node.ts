// Node built-ins loaded at call time, not imported: the library build targets
// browsers and stubs `node:` imports. Typed here: consumers need no Node types.
interface Builtins {
  "node:fs": {
    mkdirSync(path: string, options: { recursive: true }): unknown;
    readFileSync(path: string, encoding: "utf8"): string;
    writeFileSync(path: string, data: string): void;
  };
  "node:path": {
    dirname(path: string): string;
    join(...paths: string[]): string;
    resolve(...paths: string[]): string;
  };
  "node:timers": {
    clearTimeout(handle: unknown): void;
    setTimeout(callback: () => void, ms: number): unknown;
  };
  "node:url": { fileURLToPath(url: string | URL): string };
  "node:util": { inspect(value: unknown, options: object): string };
}

type RejectionListener = (reason: unknown) => void;

declare const process: {
  getBuiltinModule<K extends keyof Builtins>(id: K): Builtins[K];
  on(event: "unhandledRejection", listener: RejectionListener): void;
  off(event: "unhandledRejection", listener: RejectionListener): void;
  cwd(): string;
};

export const builtin = <K extends keyof Builtins>(id: K): Builtins[K] =>
  process.getBuiltinModule(id);

/** The process's working directory. */
export const cwd = (): string => process.cwd();

/** Calls `listener` with each unhandled promise rejection until the returned stop function runs. */
export const onUnhandledRejection = (
  listener: RejectionListener
): (() => void) => {
  process.on("unhandledRejection", listener);
  return () => process.off("unhandledRejection", listener);
};

/** An absolute path from a path or `file:` URL. */
export const pathOf = (location: string | URL): string =>
  builtin("node:path").resolve(
    String(location).startsWith("file:")
      ? builtin("node:url").fileURLToPath(location)
      : String(location)
  );

export const EXPIRED = Symbol("expired");

/** `work`'s value, or `EXPIRED` after `ms` on Node's clock (a held window timer never fires). */
export const within = async (work: unknown, ms: number) => {
  const { setTimeout, clearTimeout } = builtin("node:timers");
  let timer: unknown;
  try {
    return await Promise.race([
      work,
      new Promise<typeof EXPIRED>((resolve) => {
        timer = setTimeout(() => resolve(EXPIRED), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
