import { urlMatchesHref } from "./src/utils";
import { KitLogger } from "@excom/kit-logger";
import { KitRoute, kitRouter } from "@excom/kit-router";
import { ListenableElement } from "@excom/listenable-element";
import { Neutron, TokenList } from "@excom/neutron";
import { RoutableElement } from "@excom/routable-element";

/**
 * SPA link — navigates without a full page reload. Set `route-href` to the destination; `is-active` / `was-active` reflect match state for CSS (nav highlighting, card-expansion exits, etc.).
 *
 * @summary Declarative SPA link with active-state styling.
 *
 * @example
 * <spa-a route-href="/pricing">Pricing</spa-a>
 *
 * @example
 * <spa-a route-href="/login" route-action="replace">Sign in</spa-a>
 */
export const SpaA = Neutron.compose([
  ListenableElement,
  RoutableElement,
  Neutron({
    tag: "spa-a",
    props: {
      /**
       * @option
       * Navigation mode when activated (default click). `back` / `forward` walk in-app history only: with none to walk, the link pushes its `route-href`; without one it logs an error and does nothing.
       * @default push
       * @values push | replace | back | forward
       */
      routeAction: String,
      /**
       * @option
       * Sets `document.title` after navigation.
       */
      documentTitle: String,
      /**
       * @option
       * Space-separated View Transition types for this navigation (CSS View Transitions API). Useful for shared-element morphs like card expansion.
       * @values <token>…
       */
      transitionTypes: TokenList,
      /**
       * @option
       * Require the URL hash to match when setting `is-active`.
       */
      matchHash: Boolean,
      /**
       * @state
       * Current URL matches `route-href`. Style with `spa-a[is-active]`.
       */
      isActive: Boolean,
      /**
       * @state
       * Previous URL matched `route-href`. Style outgoing links / card-expansion exits with `spa-a[was-active]`.
       */
      wasActive: Boolean,
      routeInstance: KitRoute,
    },
  }),
])
  .defineMethods({
    actionHandler: ({
      routeAction,
      routeHref,
      documentTitle,
      transitionTypes,
    }) => {
      if (routeAction === "back" && kitRouter.canGoBack()) {
        kitRouter.back();
      } else if (routeAction === "forward" && kitRouter.canGoForward()) {
        kitRouter.forward();
      } else if (routeHref) {
        // Can't go back or forward: fall back to push if `route-href` is set
        kitRouter[routeAction === "replace" ? "replaceState" : "pushState"]({
          url: routeHref,
          title: documentTitle ?? undefined,
          ttypes: transitionTypes ?? undefined,
        });
      } else {
        KitLogger.error(
          "spa-a",
          routeAction === "back"
            ? "Cannot go back"
            : routeAction === "forward"
              ? "Cannot go forward"
              : "No route-href provided"
        );
      }
    },
    routeChanged: (
      { routeHref, matchHash, matchNested },
      { move, previous, next }
    ) => {
      const opts = { ignoreHash: !matchHash, nested: matchNested };
      const matches = (url: string) =>
        !!routeHref && urlMatchesHref(url, routeHref, opts);
      return {
        isActive: matches(location.href),
        wasActive:
          // Entry left: `next` on back, `previous` on push / forward.
          // Replace: `previous` is the entry before the replaced one.
          move === "back" && next?.url
            ? matches(next.url)
            : ["forward", "push", "replace"].includes(move!) && previous?.url
              ? matches(previous.url)
              : false,
      };
    },
  })
  .onPropChanged(
    "routeHref",
    ({ routeHref }) =>
      !routeHref && {
        // No `routeHref`: clear `isActive`
        isActive: false,
      }
  )
  .onConnected(
    ({ listenFor, listenForLifecycle, handleEvent, isMoving }) =>
      !isMoving &&
      !listenFor?.length &&
      !listenForLifecycle?.length && {
        addListener: ["click", handleEvent],
      }
  );
