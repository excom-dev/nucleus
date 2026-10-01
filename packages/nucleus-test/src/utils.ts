import { vi } from "vitest";

/** A response for `spyFetch`: every field optional, `body` as passed to `new Response()`. */
export type FakeResponse = Partial<Omit<Response, "body">> & {
  body?: BodyInit | null;
};

export const HTTP_STATUS_TEXT: Record<number, string> = {
  200: "OK",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  500: "Internal Server Error",
};

/** Mounts `html` in `document.body` and returns its first element. */
export const fixture = <T = HTMLElement>(html: string): T => {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as T;
};

/** Resolves `true` after `ms` (default: the next macrotask). */
export const wait = (ms = 0): Promise<true> =>
  new Promise((resolve) => setTimeout(() => resolve(true), ms));

/** Clicks like a user: a bubbling, cancelable, composed `click`. `false` when a listener prevented it. */
export const click = (target: EventTarget, init?: MouseEventInit): boolean =>
  target.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
      ...init,
    })
  );

/**
 * Resolves `delay` ms after `type` fires on `target`; `trigger` runs once
 * the listener is in place. Rejects after 1 s without the event. Leaves no
 * listener or timer behind.
 */
export const waitForEvent = (
  target: EventTarget,
  type: string,
  trigger?: () => unknown,
  delay = 0
): Promise<void> =>
  new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timeout);
      target.removeEventListener(type, listener);
    };
    const listener = () => {
      stop();
      setTimeout(resolve, delay);
    };
    const timeout = setTimeout(() => {
      stop();
      reject(
        `Waiting for event "${type}" on element \`${(target as Element).localName}\` timed out after 1s`
      );
    }, 1000);
    target.addEventListener(type, listener);
    trigger?.();
  });

/**
 * Stubs `fetch`: each call resolves `response` (or `response()`) after `ms`.
 * Defaults: status 200, its status text, a JSON `content-type`. Returns the spy.
 */
export const spyFetch = (
  response: FakeResponse | (() => FakeResponse),
  ms = 0
) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(() => {
          const fake = typeof response === "function" ? response() : response;
          const status = fake.status ?? 200;
          const result = new Response(fake.body ?? null, {
            status,
            statusText: fake.statusText ?? HTTP_STATUS_TEXT[status],
            headers:
              fake.headers ??
              new Headers({ "content-type": "application/json" }),
          });
          // read-only on a real Response
          for (const key of ["ok", "redirected", "type", "url"] as const) {
            if (Object.hasOwn(fake, key))
              Object.defineProperty(result, key, { value: fake[key] });
          }
          resolve(result);
        }, ms)
      )
  );
