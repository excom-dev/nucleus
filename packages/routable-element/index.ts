import { KitRoute, kitRouter } from "@excom/kit-router";
import { Neutron } from "@excom/neutron";

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
     * URL pattern to match. Supports named placeholders (`/users/:id`) and wildcards. Set this or `route-regex`.
     * @values <path pattern>
     */
    routeHref: String,
    /**
     * @option
     * RegExp source string matched against the current URL — alternative to `route-href` for catch-alls / advanced patterns.
     * @values <RegExp source>
     */
    routeRegex: String,
    /**
     * @option
     * Also match nested paths of `route-href` (e.g. `/users` stays active on `/users/42`). Essential for layout routes and nested SPAs.
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
  .onConnected(
    ({
      routeHref,
      routeRegex,
      routeChanged,
      matchNested,
      isMoving,
      wasMounted,
    }) => {
      if (isMoving) return;
      return (
        wasMounted &&
        (routeHref || routeRegex) && {
          routeInstance: new KitRoute(
            (routeHref || new RegExp(routeRegex!))!,
            routeChanged,
            {
              matchNested,
            }
          ),
          _usedRouteProp: "routeHref",
        }
      );
    }
  )
  .onDisconnected(({ routeHref, isMoving }) => {
    if (isMoving) return;
    return (
      routeHref && {
        routeInstance: null,
      }
    );
  })
  .onPropChanged(
    ["routeHref", "routeRegex"],
    ({ routeHref, routeRegex, routeChanged, matchNested }, previous) => {
      let routeInstance;
      if (previous?.routeHref || previous?.routeRegex) {
        // if previous routeInstance was set, remove it
        routeInstance = null;
      }
      if (routeHref || routeRegex) {
        // if new route, set a new routeInstance, which will also remove the previous one
        routeInstance = new KitRoute(
          (routeHref || new RegExp(routeRegex!))!,
          routeChanged,
          { matchNested }
        );
      }
      return { routeInstance };
    }
  )
  .onPropChanged("routeInstance", ({ routeInstance }, previous) => {
    if (previous?.routeInstance) {
      kitRouter.off(previous.routeInstance);
    }
    if (routeInstance) {
      kitRouter.on(routeInstance);
    }
  });
