import { KitRoute, KitRouteData } from "@excom/kit-router";
import { deepCompare } from "@excom/kit-utils";
import { ConstructorType, Neutron, TEvent, TokenList } from "@excom/neutron";
import { RenderableElement } from "@excom/renderable-element";
import { RoutableElement } from "@excom/routable-element";

export type SpaRouteProvisionThunk = () => void;

export type SpaRouteProvisionEvent = TEvent & {
  type: "spa-route-provision";
  detail: SpaRouteProvisionThunk;
};

export type SpaRouteProvision = {
  routeHref: string;
  matchNested: boolean;
  scrollResetY: string[];
  scrollResetX: string[];
  scrollResetBehavior: ScrollBehavior;
  noTransition: boolean;
  active: KitRouteData["active"];
  event: KitRouteData["event"];
  match: KitRouteData["match"];
  move: KitRouteData["move"];
  next: KitRouteData["next"];
  previous: KitRouteData["previous"];
  params: KitRouteData["params"];
  query: KitRouteData["query"];
};

/**
 * One screen of a single-page app. Matches `route-href` / `route-regex`, then renders its `<template>` while active and unrenders on the way out. Place inside `<spa-manager>` for view transitions, `document-title` and scroll reset / restore: without one, none of them happen.
 *
 * @summary Declarative SPA screen — URL match → render.
 *
 * @example
 * <spa-manager>
 *   <spa-route route-href="/">
 *     <template><home-page></home-page></template>
 *   </spa-route>
 *   <spa-route route-href="/users/:id">
 *     <template><user-page></user-page></template>
 *   </spa-route>
 * </spa-manager>
 *
 * @example
 * <!-- 404 fallback: only activates when no other route matches the path -->
 * <spa-manager>
 *   <spa-route route-href="/known"><template>Known</template></spa-route>
 *   <spa-route route-regex=".*" is-fallback>
 *     <template>Not found</template>
 *   </spa-route>
 * </spa-manager>
 *
 * @fires spa-route-provision - Cancelable. On (de)activation, and whenever
 *   the path or query changes while active; a hash-only move does neither.
 *   `event.detail` is a thunk that updates route data. `<spa-manager>`
 *   batches this into its update like render/unrender.
 * @type SpaRouteProvisionEvent
 *
 * @default-action spa-route-provision - Invokes `event.detail()` to apply
 *   the new provision.
 *
 * @child template - Screen content. Cloned (or reused with `persist-content`) on activation.
 */
export const SpaRoute = Neutron.compose([
  RenderableElement,
  RoutableElement,
  Neutron({
    tag: "spa-route",
    events: {
      ["spa-route-provision"]: {},
    },
    props: {
      /**
       * @option
       * When this route matches while already active, `reuse` keeps the
       * rendered tree and updates route data; `refresh` tears down and
       * re-renders once params, the matched path or the query change. Use
       * `refresh` for param-driven screens (e.g. `/users/:id` →
       * `/users/2`); `reuse` when only route data should change (e.g.
       * `/logs/:view`). Pair with `scroll-set-disabled` to leave the
       * viewport untouched.
       * @values reuse | refresh
       * @default reuse
       */
      sameRoute: {
        type: String,
        defaultValue: () => "reuse",
      },
      /**
       * @option
       * This route's render / unrender never starts a `<spa-manager>` View Transition. It still takes part in one another route starts.
       */
      noTransition: Boolean,
      /**
       * @option
       * `window.scrollTo` behavior when `<spa-manager>` resets scroll for
       * this route. Restores are instant.
       * @default instant
       * @values auto | instant | smooth
       */
      scrollResetBehavior: String,
      /**
       * @option
       * Navigation moves that reset scroll X to `0` once a route renders
       * (a query-only move keeps its place; a `#fragment` target wins). Moves
       * omitted here restore the saved X for that history entry instead.
       * @values push | replace | back | forward
       * @default push replace
       */
      scrollResetX: {
        type: TokenList,
        defaultValue: () => ["push", "replace"],
      },
      /**
       * @option
       * Navigation moves that reset scroll Y to `0` once a route renders
       * (a query-only move keeps its place; a `#fragment` target wins). Moves
       * omitted here restore the saved Y for that history entry instead.
       * @values push | replace | back | forward
       * @default push replace
       */
      scrollResetY: {
        type: TokenList,
        defaultValue: () => ["push", "replace"],
      },
      /**
       * @option
       * While this route is active, `<spa-manager>` neither resets nor
       * restores scroll.
       */
      scrollSetDisabled: Boolean,
      /**
       * @option
       * Only activate when this route matches *and* no other `<spa-route>` in its closest `<spa-manager>` (nested routes included; without one, its document or shadow root) matches the current path. Other fallbacks, and routes that contain it or that it contains, never count. Place it last. Pair with a permissive `route-regex` (e.g. `.*`) for 404 catch-alls.
       */
      isFallback: Boolean,
      /**
       * @option
       * `document.title` while this route is active. The outermost
       * `<spa-manager>` applies the last active route carrying one — so a
       * nested route beats its ancestor — and restores the page's own
       * `<title>` once no active route has one. Cold loads and back /
       * forward retitle too: it keys off activation, not clicks.
       */
      documentTitle: String,
      /**
       * @state
       * Set briefly while navigating away. Style outgoing screens / card-expansion exits with `spa-route[was-active]`.
       */
      wasActive: Boolean,
      /**
       * @provision
       * Active route payload for this activation (`null` when inactive).
       * Not reflected as an attribute.
       * @type SpaRouteProvision
       */
      provision: Object as unknown as ConstructorType<KitRouteData>,
      // private
      routeParams: Object as unknown as ConstructorType<KitRouteData["params"]>,
      // ready waits for both the render and the provision of this activation
      _renderPending: { type: Boolean, attr: false },
      _provisionPending: { type: Boolean, attr: false },
      /* The provision last requested, set at once: `provision` lands only
         when the batched thunk runs, so A, B, A in one update would compare
         against a stale one. */
      _requested: {
        type: Object as unknown as ConstructorType<SpaRouteProvision | null>,
        attr: false,
      },
    },
  }),
])
  .defineMethods({
    isResponsibleForReady: (
      { readyOn, _renderPending, _provisionPending },
      caller: string | Event
    ) => ({
      returns:
        caller === "startTeardown" ||
        (readyOn
          ? caller instanceof Event
          : // Without `ready-on`: ready once rendered (if this activation
            // renders) and provisioned, whichever lands last
            (caller === "renderChildren" && !_provisionPending) ||
            (caller === "doProvision" && !_renderPending)),
    }),
    doProvision: (_, newProvision: SpaRouteProvision) => [
      { provision: newProvision, _provisionPending: false },
      { tryCompleteReady: ["doProvision"] },
    ],
    routeChanged: (element, routeData: KitRouteData) => {
      const {
        sameRoute,
        isActive,
        _requested,
        // @ts-ignore
        doProvision,
        isFallback,
        routeHref,
        routeInstance,
        matchNested,
        scrollResetY,
        scrollResetX,
        scrollResetBehavior,
        noTransition,
      } = element;
      if (!routeInstance) return;
      // `match.input` is the matched path: a nested layout's `match[0]` stays put
      const path = (routeData.match as RegExpMatchArray | null)?.input;
      const willActivate =
        !!routeData.match &&
        // Fallback: off while another mounted non-fallback route in scope
        // matches. Patterns, not `is-active`: routes dispatched later are stale
        !(
          isFallback &&
          Array.from(
            (
              element.closest("spa-manager") ??
              (element.getRootNode() as ParentNode)
            ).querySelectorAll<
              Element & { isFallback?: boolean; routeInstance?: KitRoute }
            >("spa-route")
          ).some(
            (route) =>
              !route.isFallback &&
              // Lineage never counts: its layout, a route in its own template
              !route.contains(element) &&
              !element.contains(route) &&
              route.routeInstance?.match(path!).match
          )
        );
      const queryChanged = !deepCompare(
        _requested?.query ?? {},
        routeData.query ?? {}
      );
      const pathChanged =
        (_requested?.match as RegExpMatchArray | null)?.input !== path;
      if (
        isActive === willActivate &&
        !(willActivate && (pathChanged || queryChanged))
      ) {
        // Activation, path and query unchanged (e.g. a hash-only move)
        return false;
      }
      const willStayActive = willActivate && isActive;
      const wasActivated =
        !willActivate || willStayActive
          ? // After a reload, history survives but router states don't: check `next.url`
            routeData.move === "back" && routeData.next?.url
            ? routeInstance.match(routeData.next.url)?.match?.[0]
            : // Same reload gap: check `previous.url`
              ["forward", "push", "replace"].includes(routeData.move!) &&
                routeData.previous?.url
              ? routeInstance.match(routeData.previous.url)?.match?.[0]
              : false
          : false;
      const newProvision = willActivate
        ? ({
            // Element options
            routeHref,
            matchNested,
            scrollResetY,
            scrollResetX,
            scrollResetBehavior,
            noTransition,
            // Router data
            active: routeData.active,
            event: routeData.event,
            match: routeData.match,
            move: routeData.move,
            next: routeData.next,
            previous: routeData.previous,
            params: routeData.params,
            query: routeData.query,
          } as SpaRouteProvision)
        : null;
      const shouldRefresh =
        sameRoute === "refresh" &&
        willStayActive &&
        (queryChanged ||
          _requested?.match?.[0] !== routeData.match?.[0] ||
          !deepCompare(_requested?.params || {}, routeData.params || {}));
      const willReuse = willStayActive && !shouldRefresh;
      return [
        shouldRefresh && {
          isActive: false,
          startTeardown: [],
        },
        {
          isActive: willActivate,
          wasActive: wasActivated,
          _requested: newProvision,
          _provisionPending: willActivate,
          // A reuse keeps waiting for a render still in flight
          ...(!willReuse && { _renderPending: willActivate }),
        },
        // Before the provision event, so its thunk hands `<spa-manager>` this
        // activation's ready promise
        willActivate && { startReady: [] },
        {
          firePromiseEvent: [
            "spa-route-provision",
            () => doProvision(newProvision),
          ],
        },
      ];
    },
  })
  /* Retitle the live page when a Quark rule (or JS) rewrites the title of the
     route that is already on screen. An inactive route waits for activation,
     which the manager picks up at the end of its route update. `element` over
     a destructure: `closest` needs its receiver. */
  .onPropChanged("documentTitle", (element) => {
    if (!element.isActive) return;
    // Same family: the manager owns `document.title`
    (
      element.closest("spa-manager") as unknown as {
        syncDocumentTitle: () => void;
      } | null
    )?.syncDocumentTitle();
  })
  .onEvent(
    "spa-route-did-render",
    (element, e) => e.target === element && { _renderPending: false }
  )
  .onEventDefault("spa-route-provision", (_, { detail }) => {
    detail();
  });
