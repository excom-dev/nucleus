/**
 * The kit's load-state attributes, as Loadable and Renderable elements
 * reflect them, with what each means to a render:
 * - `waiting` (`is-loading`, `delaying-ready`): still set once the page
 *   settled, the page would be written half-rendered (or hidden): an error.
 * - `loaded` (`is-success`, `did-load`): removed from an element whose data
 *   stays out of the island. In the browser it is then not loaded, with its
 *   server-rendered content in place, and fetches as on a cold load: rules
 *   keyed on its loaded state match once its data arrives, not before.
 */
export const LOAD_STATE_ATTRIBUTES = {
  "is-loading": "waiting",
  "delaying-ready": "waiting",
  "is-success": "loaded",
  "did-load": "loaded",
} as const;

type LoadState =
  (typeof LOAD_STATE_ATTRIBUTES)[keyof typeof LOAD_STATE_ATTRIBUTES];

/** The load-state attributes that mean `state`. */
export const loadStateAttributes = (state: LoadState): string[] =>
  Object.entries(LOAD_STATE_ATTRIBUTES)
    .filter(([, meaning]) => meaning === state)
    .map(([name]) => name);
