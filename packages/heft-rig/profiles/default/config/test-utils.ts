/// <reference types="@open-wc/semantic-dom-diff" />

export * from "@open-wc/semantic-dom-diff";
export * from "vitest";
import {  vi } from "vitest";

declare global {
  namespace Chai {
    interface Assertion {
      equalTag(
        expected: string,
        options?: import("@open-wc/semantic-dom-diff/get-diffable-html").DiffOptions
      ): void;
      toMatchListeners(expected: Record<string, number>): void;
      toContainListeners(expected: Record<string, number>): void;
    }
  }
  var getEventListeners: (
    target: EventTarget
  ) => Record<string, EventListener[]>;
  var clearEventListeners: (target: EventTarget) => void;
}

const _waitFor = ({
  triggerFn,
  waitExtra,
  rejectionTimeout,
  rejectionMessage,
  setterFn,
  cleanupSuccessCb,
  cleanupErrorCb,
}) => {
  let resolve, reject, didFire;
  const listener = (value) => {
    setTimeout(() => {
      if (resolve) {
        didFire = true;
        resolve(value);
      } else {
        listener(value);
      }
    }, waitExtra);
  };
  setterFn?.(listener);
  setTimeout(() => {
    if (!didFire) {
      reject(rejectionMessage);
    }
  }, rejectionTimeout);
  return new Promise((res, rej) => {
    resolve = res;
    reject = rej;
    triggerFn?.();
  })
    .then(() => {
      cleanupSuccessCb(listener);
    })
    .catch((error) => {
      cleanupErrorCb(listener);
      throw error;
    });
};

export const waitForEvent = (
  target,
  eventName,
  eventTriggerFn?,
  waitExtra?
) => {
  return _waitFor({
    triggerFn: eventTriggerFn,
    waitExtra: waitExtra ?? 0,
    rejectionTimeout: 1000,
    rejectionMessage: `Waiting for event "${eventName}" on element \`${target.localName}\` timed out after 1s`,
    setterFn: (listener) => target.addEventListener(eventName, listener),
    cleanupSuccessCb: (listener) =>
      target.removeEventListener(eventName, listener),
    cleanupErrorCb: (listener) =>
      target.removeEventListener(eventName, listener),
  });
};

export const wait = (ms: number = 0) =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve(true);
    }, ms);
  });

export const fixture = <T>(html: string): T => {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el.firstElementChild as T;
};

export const HTTP_STATUS_TEXT = {
  200: "OK",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  500: "Internal Server Error",
};

type PartialRes = Partial<Response>;
export const spyFetch = (_res: PartialRes | (() => PartialRes), ms = 0) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(() => {
          const r = typeof _res === "function" ? _res() : _res;
          const response = new Response(r.body ?? null, {
            status: r.status ?? 200,
            statusText: r.statusText ?? HTTP_STATUS_TEXT[r.status ?? 200],
            headers:
              r.headers ??
              new Headers({
                "content-type": "application/json",
              }),
          });

          ["ok", "redirected", "type", "url"].forEach((key) => {
            if (r.hasOwnProperty(key)) {
              Object.defineProperty(response, key, { value: r[key] });
            }
          });
          resolve(response);
        }, ms)
      )
  );
