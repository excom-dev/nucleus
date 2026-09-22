import { KitRouteData } from "@excom/kit-router";
import { deepCompare } from "@excom/kit-utils";
import {
  ConstructorType,
  Neutron,
  TEvent,
  TokenList,
} from "@excom/neutron";
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
};

/**
 * One screen of a single-page app. Matches `route-href` / `route-regex`, then renders its `<template>` while active and unrenders on the way out. Place inside `<spa-manager>` for view transitions and coordinated scroll.
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
 * <!-- 404 fallback: only activates if no preceding sibling matched -->
 * <spa-manager>
 *   <spa-route route-href="/known"><template>Known</template></spa-route>
 *   <spa-route route-regex=".*" is-fallback>
 *     <template>Not found</template>
 *   </spa-route>
 * </spa-manager>
 *
 * @fires spa-route-provision - Cancelable. Same route stayed active but
 *   params changed (`same-route="reuse"`). `event.detail` is a thunk that
 *   updates route data and resolves the ready promise. `<spa-manager>`
 *   batches this into the View Transition like render/unrender.
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
       * re-renders. Use `refresh` for param-driven screens (e.g.
       * `/users/:id` → `/users/2`); `reuse` when only route data should
       * change (e.g. `/logs/:view`). Pair with `scroll-set-disabled` to
       * leave the viewport untouched.
       * @values reuse | refresh
       * @default reuse
       */
      sameRoute: {
        type: String,
        defaultValue: () => "reuse",
      },
      /**
       * @option
       * Opt this route out of the parent `<spa-manager>` View Transition. Still renders/unrenders — just without the cross-fade.
       */
      noTransition: Boolean,
      /**
       * @option
       * `window.scrollTo` behavior when this route applies a scroll reset /
       * restore.
       * @default instant
       * @values auto | instant | smooth
       */
      scrollResetBehavior: String,
      /**
       * @option
       * Navigation moves that reset scroll X to `0`. Moves omitted here
       * restore the saved X for that history entry instead.
       * @values push | replace | back | forward
       * @default push replace
       */
      scrollResetX: {
        type: TokenList,
        defaultValue: () => ["push", "replace"],
      },
      /**
       * @option
       * Navigation moves that reset scroll Y to `0`. Moves omitted here
       * restore the saved Y for that history entry instead.
       * @values push | replace | back | forward
       * @default push replace
       */
      scrollResetY: {
        type: TokenList,
        defaultValue: () => ["push", "replace"],
      },
      /**
       * @option
       * Disable all scroll reset / restore for this route.
       */
      scrollSetDisabled: Boolean,
      /**
       * @option
       * Only activate when this route matches *and* no earlier sibling `<spa-route>` is already active. Pair with a permissive `route-regex` (e.g. `.*`) for 404 catch-alls.
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
    },
  }),
])
  .defineMethods({
    setScroll: (element) => {
      // Read props inside the timeout: ready may resolve before the
      // matching `provision` effect lands.
      setTimeout(() => {
        const {
          provision,
          scrollResetX,
          scrollResetY,
          scrollResetBehavior,
          scrollSetDisabled,
        } = element;
        if (!provision || scrollSetDisabled) return;
        const move = provision?.move as string;
        window.scrollTo({
          top:
            !move || scrollResetY?.includes(move)
              ? 0
              : provision.active.scrollY || 0,
          left:
            !move || scrollResetX?.includes(move)
              ? 0
              : provision.active.scrollX || 0,
          behavior: (scrollResetBehavior as ScrollBehavior) || "instant",
        });
      }, 0);
    },
    isResponsibleForReady: ({ readyOn }, caller: string | Event) => {
      if (caller === "startTeardown") {
        return { returns: true };
      } else if (readyOn && caller instanceof Event) {
        return { returns: true };
        // Same idea as RenderableElement.isResponsibleForReady, except `doProvision` flips ready, not the render
      } else if (!readyOn && caller === "doProvision") {
        return { returns: true };
      }
      return { returns: false };
    },
    doProvision: (_, newProvision: SpaRouteProvision) => [
      { provision: newProvision },
      // Reuse doesn't re-render; resolve ready now unless `ready-on` is
      // waiting on an external paint signal
      { tryCompleteReady: ["doProvision"] },
    ],
    routeChanged: (element, routeData: KitRouteData) => {
      const {
        sameRoute,
        isActive,
        provision,
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
      let willActivate = !!routeData.match;
      if (
        // Fallback matched, but another route is already active: stay off.
        // Not itself: an active fallback moving between two unmatched URLs
        isFallback &&
        willActivate &&
        Array.from(
          element
            .closest("spa-manager")
            ?.querySelectorAll("spa-route[is-active]") ?? []
        ).some((route) => route !== element)
      ) {
        willActivate = false;
      }
      const provisionChanged =
        !deepCompare(provision?.params || {}, routeData?.params || {}) ||
        // param-less routes (a `route-regex` catch-all) still change per URL
        provision?.match?.[0] !== routeData?.match?.[0];
      if (isActive === willActivate && !provisionChanged) {
        // Skip only when both activation and params are unchanged.
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
          } as SpaRouteProvision)
        : null;
      const shouldRefresh = sameRoute === "refresh" && willStayActive;
      const willReuse = willStayActive && !shouldRefresh;
      return [
        shouldRefresh && {
          isActive: false,
          startTeardown: [],
        },
        {
          isActive: willActivate,
          wasActive: wasActivated,
        },
        willReuse && {
          // Same route doesn't set `isActive`, so call `startReady` here
          startReady: [],
        },
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
  .onPropSet("readyPromiseObject", ({ readyPromiseObject, setScroll }) =>
    // Reject = aborted mid-flight; scroll only on successful ready
    readyPromiseObject.promise.then(setScroll, () => {})
  )
  .onEventDefault("spa-route-provision", (_, { detail }) => {
    detail();
  });
