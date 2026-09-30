import { guardConsole } from "./src/console";
import {
  clearEventListeners,
  getEventListeners,
  trackEventListeners,
} from "./src/listeners";
import { matchers } from "./src/matchers";
import { installShims } from "@excom/nucleus-dom";
import { chaiDomDiff, getDiffableHTML } from "@open-wc/semantic-dom-diff";
import { chai, expect } from "vitest";

// shims first: the command shim's own `click` listener stays out of the registry
installShims(globalThis);
trackEventListeners();
Object.assign(globalThis, { getEventListeners, clearEventListeners });
guardConsole();
chai.use(chaiDomDiff);
chai.use(matchers);
expect.addSnapshotSerializer({
  test: (value) => value instanceof HTMLElement,
  print: (value) => getDiffableHTML(value as HTMLElement),
});
