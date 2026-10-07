/**
 * `@excom/nucleus-kit/server`: the Nucleus Kit for prerendering in Node. Every
 * `index` export except the elements that read the device or the person, which
 * must never upgrade on the server. Not for the browser.
 */
export * from "@excom/content-carousel";
export * from "@excom/content-drawer";
export * from "@excom/content-tabs";
export * from "@excom/data-table";
export * from "@excom/dialog-anchor";
export * from "@excom/dismiss-watcher";
export * from "@excom/dom-observer";
export * from "@excom/event-handler";
export * from "@excom/include-content";
export { KitLogger } from "@excom/kit-logger";
export * from "@excom/neutron";
export * from "@excom/provider-fetch";
export * from "@excom/quark";
export * from "@excom/quark-sheet";
export * from "@excom/scroll-into-view";
export * from "@excom/spa-route";
export * from "@excom/super-form";
export * from "@excom/super-input";

/**
 * Tags of the elements left out of this entry. A prerenderer asserts none is
 * defined once its entry has loaded.
 */
export const SERVER_EXCLUDED_TAGS: readonly string[] = [
  "detect-browser",
  "detect-features",
  "detect-media",
  "gesture-handler",
  "network-status",
  "provider-geolocation",
  "provider-orientation",
  "provider-storage",
  "service-worker",
  "web-authn",
];
