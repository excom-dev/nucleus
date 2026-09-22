import { ConstructorType, Neutron, TEvent } from "@excom/neutron";

export interface DetectMediaProvision {
  mediaQuery: string;
  isMatched: boolean;
}

export type DetectMediaChangeEvent = TEvent & {
  type: "detect-media-change";
  detail: DetectMediaProvision;
};

/**
 * Live media-query facts as attributes — `is-matched` follows
 * `window.matchMedia(mediaQuery).matches` and its `change` event, so CSS and
 * Quark can select on what a media query knows (color scheme, pointer type,
 * viewport width, reduced motion). One element per query.
 *
 * @summary Live media query reflected as `is-matched`.
 *
 * @example
 * <detect-media media-query="(pointer: coarse)"></detect-media>
 * <!-- detect-media[is-matched] ... -->
 *
 * @fires detect-media-change - Dispatched every time the query flips (not
 *   on mount). `event.detail` is the `.provision` payload.
 * @type DetectMediaChangeEvent
 */
export const DetectMedia = Neutron({
  tag: "detect-media",
  props: {
    // options
    /**
     * @option
     * Media query to evaluate, in `window.matchMedia` syntax:
     * `(prefers-color-scheme: dark)`, `(pointer: coarse)`, `(width < 600px)`.
     * Required — missing / empty leaves `is-matched` unset and `provision`
     * `null`. Changing it re-subscribes.
     */
    mediaQuery: String,
    // state
    /**
     * @state
     * Present while `media-query` matches. Live — follows the query's
     * `change` event.
     */
    isMatched: Boolean,
    /**
     * @provision
     * `{ mediaQuery, isMatched }` — a new object on first evaluation and on
     * every change; `null` without a query. Not reflected as an attribute.
     * @type DetectMediaProvision
     */
    provision: Object as unknown as ConstructorType<DetectMediaProvision>,
    // private
    _mql: Object as unknown as ConstructorType<MediaQueryList>,
  },
})
  .defineMethods({
    // `change` callback: read the live list, not the event, so a stale
    // dispatch can't disagree with `matches`
    _handleChange: ({ mediaQuery, _mql }) => {
      if (!mediaQuery || !_mql) return;
      const provision: DetectMediaProvision = {
        mediaQuery,
        isMatched: _mql.matches,
      };
      return {
        isMatched: provision.isMatched,
        provision,
        emit: ["detect-media-change", { detail: provision }],
      };
    },
  })
  // Second `defineMethods` so `_handleChange` is typed on the element here
  .defineMethods({
    // Re-evaluate `media-query`: drop the old list, subscribe to the new
    // one via the tracked listener so Neutron restores it on a move
    _subscribe: ({ mediaQuery, _mql, _handleChange }) => {
      const effects: object[] = [];
      if (_mql) {
        effects.push({
          removeListener: ["change", _handleChange, { target: _mql }],
        });
      }
      if (!mediaQuery) {
        effects.push({ _mql: null, isMatched: false, provision: null });
        return effects;
      }
      const mql = window.matchMedia(mediaQuery);
      effects.push(
        { _mql: mql, addListener: ["change", _handleChange, { target: mql }] },
        {
          isMatched: mql.matches,
          provision: { mediaQuery, isMatched: mql.matches },
        }
      );
      return effects;
    },
  })
  .onPropChanged("mediaQuery", () => ({ _subscribe: [] }))
  .onConnected(
    // First mount flushes via `onPropChanged`. A move keeps the tracked
    // listener; only a real reconnect re-evaluates.
    ({ wasMounted, isMoving }) => wasMounted && !isMoving && { _subscribe: [] }
  )
  .onDisconnected(
    // A move restores tracked listeners itself. A real removal drops the
    // list so it can be collected.
    ({ isMoving, _mql, _handleChange }) =>
      !isMoving &&
      !!_mql && [
        { removeListener: ["change", _handleChange, { target: _mql }] },
        { _mql: null },
      ]
  );
