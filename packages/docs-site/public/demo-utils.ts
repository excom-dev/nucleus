/**
 * Demo helpers for docs-site live demos (`@use "/demo-utils"`). Each
 * function is a `handle:` listener for work Quark has no declaration for.
 */

/** `localStorage` key the `provider-storage` demo reads. */
export const DEMO_STORAGE_KEY = "demo-provider-storage";

/**
 * Stands in for app code writing storage (`provider-storage` demo): stores
 * the time, then re-sets `key-name` on every provider of that key. A
 * same-tab write fires no `storage` event, so the re-set forces the read.
 */
export const seedDemoStorage = () => {
  localStorage.setItem(
    DEMO_STORAGE_KEY,
    JSON.stringify({ seededAt: new Date().toLocaleTimeString() })
  );
  document
    .querySelectorAll<Element & { keyName: string }>(
      `provider-storage[key-name="${DEMO_STORAGE_KEY}"]`
    )
    .forEach((provider) => {
      provider.keyName = "";
      provider.keyName = DEMO_STORAGE_KEY;
    });
};

/** Feature flags the app already holds (`quark` js-api demo). */
export const DEMO_FLAGS = { "new-checkout": true, "gift-cards": false };

/**
 * Stands in for app JS handing its flags to the document (`quark` js-api
 * demo): writes `$app-flags` on the listening element.
 */
export const handFlagsOver = (event: Event) =>
  (event.currentTarget as Element).quark.setProperty("$app-flags", DEMO_FLAGS);

/**
 * Runs a renderable element's render / unrender thunk (`event.detail`)
 * inside a view transition (`renderable-element` render-event demo).
 */
export const renderInTransition = (event: CustomEvent<() => unknown>) => {
  if (!document.startViewTransition) return;
  event.preventDefault();
  document.startViewTransition(() => event.detail());
};
