import { getEventListeners } from "./listeners";
import type { DiffOptions } from "@open-wc/semantic-dom-diff/get-diffable-html";

type Check = (this: Chai.AssertionStatic, subject: any, ...args: any[]) => void;

const listenerCounts = (target: EventTarget): Record<string, number> =>
  Object.fromEntries(
    Object.entries(getEventListeners(target)).map(([type, listeners]) => [
      type,
      listeners.length,
    ])
  );

/** Chai plugin: `equalTag`, `toMatchListeners`, `toContainListeners`. */
export const matchers: Chai.ChaiPlugin = (chai, utils) => {
  const addMethod = (name: string, check: Check) =>
    chai.Assertion.addMethod(
      name,
      function method(this: Chai.AssertionStatic, ...args: unknown[]) {
        try {
          check.call(this, utils.flag(this, "object"), ...args);
        } catch (error) {
          // the stack starts at the test's line, not in here
          Error.captureStackTrace(error, method);
          throw error;
        }
      }
    );

  addMethod(
    "equalTag",
    (element: Element, expected: string, options: DiffOptions = {}) => {
      new chai.Assertion(element).dom.to.equal(expected, {
        ...options,
        ignoreChildren: [...(options.ignoreChildren ?? []), element?.localName],
      });
    }
  );

  addMethod(
    "toMatchListeners",
    function (target: EventTarget, expected: Record<string, number>) {
      const actual = listenerCounts(target);
      this.assert(
        JSON.stringify(actual) === JSON.stringify(expected),
        "expected listeners #{act} to match #{exp}",
        "expected listeners #{act} to not match #{exp}",
        expected,
        actual
      );
    }
  );

  addMethod(
    "toContainListeners",
    function (target: EventTarget, expected: Record<string, number>) {
      const actual = listenerCounts(target);
      for (const type in expected) {
        this.assert(
          (actual[type] ?? 0) === expected[type],
          "expected listeners #{act} to match #{exp}",
          "expected listeners #{act} to not match #{exp}",
          expected,
          actual
        );
      }
    }
  );
};
