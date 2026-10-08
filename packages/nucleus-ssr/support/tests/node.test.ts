import { parentChannel } from "../../src/node";
import { afterEach, describe, expect, it, vi } from "@excom/nucleus-test";

const WORKER = "NUCLEUS_SSR_WORKER";
const original = {
  send: Object.getOwnPropertyDescriptor(process, "send"),
  connected: Object.getOwnPropertyDescriptor(process, "connected"),
  worker: process.env[WORKER],
};

/** `process` as a forked child sees it: an IPC channel, connected or not, marked or not. */
const asChild = ({ marked = true, connected = true } = {}) => {
  Object.defineProperty(process, "send", { configurable: true, writable: true, value: vi.fn() });
  Object.defineProperty(process, "connected", { configurable: true, value: connected });
  if (marked) process.env[WORKER] = "1";
  else delete process.env[WORKER];
  const listeners = new Map<string, () => void>();
  const on = vi.spyOn(process, "on").mockImplementation(((event: string, listener: () => void) => {
    listeners.set(event, listener);
    return process;
  }) as never);
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  return { listeners, on, exit };
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const [name, descriptor] of Object.entries({ send: original.send, connected: original.connected })) {
    if (descriptor) Object.defineProperty(process, name, descriptor);
    else delete (process as unknown as Record<string, unknown>)[name];
  }
  if (original.worker === undefined) delete process.env[WORKER];
  else process.env[WORKER] = original.worker;
});

describe("parentChannel", () => {
  it("is none without an IPC channel, or in a process no run forked", () => {
    const { on } = asChild();
    delete (process as unknown as Record<string, unknown>).send;
    expect(parentChannel()).toBeUndefined();
    asChild({ marked: false });
    expect(parentChannel()).toBeUndefined();
    process.env[WORKER] = "0";
    expect(parentChannel()).toBeUndefined();
    expect(on).not.toHaveBeenCalled();
  });

  it("is the process itself, which ends once the parent is gone", () => {
    const { listeners, exit } = asChild();
    expect(parentChannel()).toBe(process);
    expect(exit).not.toHaveBeenCalled();
    listeners.get("disconnect")!();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("ends at once when the parent is gone before the worker looks", () => {
    const { exit } = asChild({ connected: false });
    parentChannel();
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
