import * as ui from "./ui";
import { Quark } from "@excom/quark";

/**
 * Serve the pane's helper module to `@use "/devtools-ui"` from the bundle
 * instead of a runtime `import()`, extension pages have no such URL and
 * their CSP forbids remote code. Import this module BEFORE anything that
 * defines `<quark-sheet>`: sheets start loading `@use` imports the moment
 * they upgrade.
 */
export const UI_MODULE_URL = "/devtools-ui";

const defaultLoader = Quark.moduleLoader;

Quark.moduleLoader = (url: string) =>
  url === UI_MODULE_URL ? Promise.resolve({ ...ui }) : defaultLoader(url);
