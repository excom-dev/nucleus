import { KitRoute, kitRouter } from "@excom/kit-router";
import { Neutron } from "@excom/neutron";

/** The element's route; `null` without a pattern or while detached. */
const toRoute = ({
  routeHref,
  routeRegex,
  routeChanged,
  matchNested,
  isMounted,
}) =>
  isMounted && (routeHref || routeRegex)
    ? new KitRoute(routeHref || new RegExp(routeRegex), routeChanged, {
        matchNested,
      })
    : null;

/**
 * Composition base that makes an element route-aware. Subclasses implement `routeChanged` to react when the URL matches. Used by `<spa-route>`, `<spa-a>`, and `<spa-manager>`.
 *
 * @summary URL matching for Neutron elements.
 */
export const RoutableElement = Neutron({
  tag: "noop-tag",
  props: {
    /**
     * @option
     * URL pattern to match. Supports named placeholders (`/users/:id`) and wildcards: `*rest` matches one path segment, a bare `*` across segments. A relative pattern (`checkout`) resolves against the page's `<base>`; without one, against the page URL at registration. Set this or `route-regex`; with both, this one wins.
     * @values <path pattern>
     */
    routeHref: String,
    /**
     * @option
     * RegExp source string matched against the pathname (never the query or hash) — alternative to `route-href` for catch-alls / advanced patterns, ignored when `route-href` is set. Here and in a `route-href`, named groups become `params` (`(?<id>\d+)` → `params.id`); unnamed groups stay in `match`.
     * @values <RegExp source>
     */
    routeRegex: String,
    /**
     * @option
     * Also match child paths of `route-href`: `/users` matches `/users` and `/users/42`, never `/usersx`. Essential for layout routes and nested SPAs.
     */
    matchNested: Boolean,
    routeInstance: KitRoute,
  },
})
  .defineMethods({
    routeChanged: () => {
      throw new Error("routeChanged must be implemented");
    },
  })
  // First mount registers through `onPropChanged`
  .onConnected(
    (element) =>
      !element.isMoving &&
      element.wasMounted && { routeInstance: toRoute(element) }
  )
  .onDisconnected(
    ({ routeInstance, isMoving }) =>
      !isMoving && routeInstance && { routeInstance: null }
  )
  .onPropChanged(["routeHref", "routeRegex", "matchNested"], (element) => ({
    routeInstance: toRoute(element),
  }))
  .onPropChanged("routeInstance", ({ routeInstance }, previous) => {
    if (previous?.routeInstance) {
      kitRouter.off(previous.routeInstance);
    }
    if (routeInstance) {
      kitRouter.on(routeInstance);
    }
  });
