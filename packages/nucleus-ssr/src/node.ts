// Node built-ins loaded at call time, not imported: the library build targets
// browsers and stubs `node:` imports. Typed here: consumers need no Node types.
interface Builtins {
  "node:child_process": {
    fork(
      path: string,
      args: string[],
      options: { serialization: "advanced"; env: Record<string, string> }
    ): Child;
  };
  "node:crypto": {
    createHash(algorithm: "sha256"): {
      update(data: string): { digest(encoding: "hex"): string };
    };
    randomUUID(): string;
  };
  "node:fs": {
    existsSync(path: string): boolean;
    mkdirSync(path: string, options: { recursive: true }): unknown;
    readdirSync(path: string, options: { recursive: true }): string[];
    readFileSync(path: string, encoding: "utf8"): string;
    renameSync(from: string, to: string): void;
    rmSync(path: string, options: { force: true }): void;
    writeFileSync(path: string, data: string): void;
  };
  "node:os": { availableParallelism(): number };
  "node:path": {
    dirname(path: string): string;
    isAbsolute(path: string): boolean;
    join(...paths: string[]): string;
    resolve(...paths: string[]): string;
  };
  "node:timers": {
    clearTimeout(handle: unknown): void;
    setTimeout(callback: () => void, ms: number): unknown;
  };
  "node:url": {
    fileURLToPath(url: string | URL): string;
    pathToFileURL(path: string): URL;
  };
  "node:util": {
    inspect(value: unknown, options: object): string;
    parseArgs(config: object): {
      values: Record<string, string | boolean | undefined>;
      positionals: string[];
    };
  };
}

type RejectionListener = (reason: unknown) => void;

/** One end of an IPC channel: the parent, seen from a forked child. */
export interface Channel {
  send(message: unknown): unknown;
  on(event: "message", listener: (message: never) => void): unknown;
}

/** A forked child process. */
export interface Child extends Channel {
  /** None when the process could not start. */
  pid?: number;
  kill(signal: "SIGKILL"): unknown;
  on(event: "message", listener: (message: never) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(
    event: "exit",
    listener: (code: number | null, signal: string | null) => void
  ): unknown;
}

declare const process: {
  getBuiltinModule<K extends keyof Builtins>(id: K): Builtins[K];
  on(event: "unhandledRejection", listener: RejectionListener): void;
  on(event: "message", listener: (message: never) => void): void;
  on(event: "disconnect", listener: () => void): void;
  off(event: "unhandledRejection", listener: RejectionListener): void;
  connected?: boolean;
  cwd(): string;
  env: Record<string, string>;
  exit(): never;
  send?(message: unknown): unknown;
};

// set in the processes `forkWorker()` starts
const WORKER = "NUCLEUS_SSR_WORKER";

export const builtin = <K extends keyof Builtins>(id: K): Builtins[K] =>
  process.getBuiltinModule(id);

/** The process's working directory. */
export const cwd = (): string => process.cwd();

/** Environment variable `name`. */
export const env = (name: string): string | undefined => process.env[name];

/**
 * Starts the module at `path` in a process of its own, with an IPC channel
 * `parentChannel()` finds; `env` adds to this process's environment, for
 * that process alone.
 */
export const forkWorker = (
  path: string,
  env: Record<string, string> = {}
): Child =>
  builtin("node:child_process").fork(path, [], {
    serialization: "advanced",
    env: { ...process.env, ...env, [WORKER]: "1" },
  });

/** The channel to the parent, in a process `forkWorker()` started; the process ends once the parent is gone. */
export const parentChannel = (): Channel | undefined => {
  if (!process.send || process.env[WORKER] !== "1") return undefined;
  if (!process.connected) process.exit();
  process.on("disconnect", () => process.exit());
  return process as Channel;
};

/** SHA-256 of `text`, hex. */
export const sha256 = (text: string): string =>
  builtin("node:crypto").createHash("sha256").update(text).digest("hex");

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

// Node runs a timer set any longer at once
const LONGEST_DELAY = 2 ** 31 - 1;

/**
 * Calls `callback` after `ms` on Node's clock (a held window timer never
 * fires); never for an endless `ms`. The handle is `clearTimeout`'s.
 */
export const later = (callback: () => void, ms: number): unknown =>
  Number.isFinite(ms)
    ? builtin("node:timers").setTimeout(callback, Math.min(ms, LONGEST_DELAY))
    : undefined;

/** `work`'s value, or `EXPIRED` after `ms` (see `later`). */
export const within = async (work: unknown, ms: number) => {
  let timer: unknown;
  try {
    return await Promise.race([
      work,
      new Promise<typeof EXPIRED>((resolve) => {
        timer = later(() => resolve(EXPIRED), ms);
      }),
    ]);
  } finally {
    builtin("node:timers").clearTimeout(timer);
  }
};
