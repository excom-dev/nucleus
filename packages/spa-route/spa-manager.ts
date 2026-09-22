import type {
  SpaRoute as TSpaRoute,
  SpaRouteProvisionEvent,
} from "./spa-route";
import { type KitRouteData, kitRouter } from "@excom/kit-router";
import { ConstructorType, Neutron, TEvent } from "@excom/neutron";
import type {
  RenderableErrorEvent,
  RenderableRenderEvent,
  RenderableUnrenderEvent,
} from "@excom/renderable-element";
import { RoutableElement } from "@excom/routable-element";

type THTMLSpaRouteElement = typeof TSpaRoute.CustomElement;

export type SpaManagerTransitionDetail = {
  transition: ViewTransition;
};

export type SpaManagerWillTransitionEvent = TEvent & {
  type: "spa-manager-will-transition";
  detail: void;
};

export type SpaManagerTransitionEvent = TEvent & {
  type: "spa-manager-transition";
  detail: SpaManagerTransitionDetail;
};

export type SpaManagerRenderedEvent = TEvent & {
  type: "spa-manager-rendered";
  detail: void;
};

export type SpaManagerErrorEvent = TEvent & {
  type: "spa-manager-error";
  detail: unknown;
};

export type SpaManagerPushEvent = TEvent & {
  type: "spa-manager-push";
  detail: void;
};

export type SpaManagerReplaceEvent = TEvent & {
  type: "spa-manager-replace";
  detail: void;
};

export type SpaManagerBackEvent = TEvent & {
  type: "spa-manager-back";
  detail: void;
};

export type SpaManagerForwardEvent = TEvent & {
  type: "spa-manager-forward";
  detail: void;
};

export type SpaManagerRouteListenEvents =
  | SpaRouteProvisionEvent
  | RenderableRenderEvent
  | RenderableUnrenderEvent
  | RenderableErrorEvent;

const clamp = (value, min, max) => {
  return Math.min(Math.max(Math.round(value), min), max);
};

/**
 * Coordinates sibling `<spa-route>` children: batches their render / unrender into one View Transition per navigation, re-emits nav lifecycle events, and optionally handles touch edge-swipe back / forward.
 *
 * @summary SPA shell — view transitions, swipe nav, route orchestration.
 *
 * @example
 * <spa-manager overscroll-behavior-x="navigate">
 *   <spa-route route-href="/"><template>Home</template></spa-route>
 *   <spa-route route-href="/about"><template>About</template></spa-route>
 * </spa-manager>
 *
 * @descendant spa-route - Routes this manager coordinates. Their render lifecycle is intercepted and batched into one view transition per navigation.
 *
 * @fires spa-manager-will-transition - Cancelable. Once per navigation, just before the View Transition starts. `preventDefault()` skips the transition for this navigation.
 * @type SpaManagerWillTransitionEvent
 * @fires spa-manager-transition - After `document.startViewTransition()` is called.
 * @type SpaManagerTransitionEvent
 * @fires spa-manager-rendered - After the transition (or synchronous fallback) finishes and routes are settled.
 * @type SpaManagerRenderedEvent
 * @fires spa-manager-error - Re-emitted when a child fires `spa-route-error`. `event.detail` mirrors the source error.
 * @type SpaManagerErrorEvent
 * @fires spa-manager-push - On `pushState` navigations.
 * @type SpaManagerPushEvent
 * @fires spa-manager-replace - On `replaceState` navigations.
 * @type SpaManagerReplaceEvent
 * @fires spa-manager-back - On `back` navigations.
 * @type SpaManagerBackEvent
 * @fires spa-manager-forward - On `forward` navigations.
 * @type SpaManagerForwardEvent
 *
 * @default-action spa-manager-will-transition - Starts the batched View Transition (or synchronous update when transitions are unavailable / opted out).
 *
 * @listens spa-route-render - Queues the child's render callback for the next batched transition.
 * @type RenderableRenderEvent
 * @listens spa-route-unrender - Queues the child's unrender callback (runs before renders so the outgoing route leaves first).
 * @type RenderableUnrenderEvent
 * @listens spa-route-provision - Queues a same-route param update (reuse) into the next batched transition.
 * @type SpaRouteProvisionEvent
 * @listens spa-route-error - Falls back to a non-transitioned update and re-emits as `spa-manager-error`.
 * @type RenderableErrorEvent
 */
export const SpaManager = Neutron.compose([
  RoutableElement,
  Neutron({
    tag: "spa-manager",
    props: {
      /**
       * @option
       * Animate the very first activation (cold load) with a View Transition. Off by default so the initial paint is instant.
       */
      transitionFirstRender: Boolean,
      /**
       * @option
       * Delay (ms) before starting the batched View Transition. Gives late
       * sibling render/unrender events time to queue, or room for last-second
       * DOM work. Unset / `null` starts synchronously.
       */
      transitionDelay: Number,
      /**
       * @option
       * Disable View Transitions for every child route.
       */
      noTransition: Boolean,
      /**
       * @option
       * Max wait (ms) for child render promises before forcing the transition to resolve. Raise for slow remote templates.
       * @default 2000
       */
      renderTimeout: {
        type: Number,
        // Safety timeout for an uncaught failure. High so slow template loads survive.
        defaultValue: () => 2000,
      },
      /**
       * @option
       * Touch edge-swipe on touch devices. `none` blocks horizontal overscroll; `navigate` also calls back / forward past the threshold.
       * @values none | navigate
       */
      overscrollBehaviorX: String,
      /**
       * @option
       * Edge inset (px) where a touch start counts as an edge swipe.
       * @default 40
       */
      overscrollXThreshold: {
        type: Number,
        defaultValue: () => 40,
      },
      /**
       * @option
       * Cap retained router history states (scroll positions, transition types, etc.).
       */
      maxStates: Number,
      /**
       * @state
       * Last navigation direction (`push` / `replace` / `back` / `forward`). Pick CSS transition styles from this.
       * @values push | replace | back | forward
       */
      lastMove: String,
      /**
       * @state
       * URL of the currently active route.
       */
      activeUrl: String,
      /**
       * @state
       * A View Transition is in flight.
       */
      isTransitioning: Boolean,
      /**
       * @state
       * At least one render has committed. Gates `transition-first-render`; useful for hiding loading shells.
       */
      hasRendered: Boolean,
      /**
       * @provision
       * Current route payload. Not reflected as an attribute.
       * @type KitRouteData
       */
      provision: Object as unknown as ConstructorType<KitRouteData>,
      router: Object as unknown as ConstructorType<typeof kitRouter>,
      // private
      executingTransition: { type: Boolean, attr: false },
      // the batch right after an unbatched first paint (see pushRouteCallback)
      _firstPaintPending: { type: Boolean, attr: false },
      // the page's own <title>, captured before the first route title lands
      _defaultTitle: { type: String, attr: false },
      renderTimeoutId: {
        type: Number as unknown as ConstructorType<
          ReturnType<typeof setTimeout>
        >,
        attr: false,
      },
      transitionDelayId: {
        type: Number as unknown as ConstructorType<
          ReturnType<typeof setTimeout>
        >,
        attr: false,
      },
      _activeViewTransition: {
        type: Object as unknown as ConstructorType<ViewTransition | null>,
        attr: false,
      },
      _routeCallbacks: Object as unknown as ConstructorType<{
        provision: Array<() => void>;
        render: Array<() => void>;
        unrender: Array<() => void>;
      }>,
      attemptTransitionDebounced: Function,
      swipeTracker: Object as unknown as ConstructorType<{
        identifier: number;
        startX: number;
        startY: number;
      }>,
      routeHref: {
        // Override RoutableElement
        type: RegExp,
        attr: false,
      },
    },
  }),
])
  .defineMethods({
    hasCallbacks: ({ _routeCallbacks }) => ({
      returns: Object.values(_routeCallbacks!).some(
        (callbacks) => callbacks.length > 0
      ),
    }),
    pushRouteCallback: (
      element,
      e,
      type: "provision" | "render" | "unrender",
      callback
    ) => {
      e.stopPropagation();
      if (shouldTransition(element, e.target as THTMLSpaRouteElement)) {
        const shouldStartTransition =
          // @ts-ignore TODO defineMethods
          !element.isTransitioning && !element.hasCallbacks();
        const _routeCallbacks = {
          provision: [...(element._routeCallbacks?.provision || [])],
          render: [...(element._routeCallbacks?.render || [])],
          unrender: [...(element._routeCallbacks?.unrender || [])],
        };
        _routeCallbacks[type]!.push(callback);
        e.preventDefault();
        /* Rapid back/forward (or any nav) during a transition: skip the
           current View Transition so `finished` resolves and `doCleanup`
           can drain the newly queued callbacks now. */
        if (element.isTransitioning) {
          element._activeViewTransition?.skipTransition?.();
        }
        return [
          { _routeCallbacks },
          // Start a new transition only when nothing is in flight
          shouldStartTransition && {
            emit: ["spa-manager-will-transition"],
          },
        ];
      } else {
        /* First paint runs unbatched; the rest of the same activation
           (`spa-route-provision`) is batched next, and that batch must not
           start a View Transition — a hard load used to cross-fade the page. */
        return { hasRendered: true, _firstPaintPending: !element.hasRendered };
      }
    },
    // @ts-ignore TODO defineMethods
    doCleanup: ({ _routeCallbacks, hasCallbacks }) => {
      // More callbacks arrived mid-transition: run another transition
      return [
        { _activeViewTransition: null },
        ...(hasCallbacks()
          ? [{ updateRoutes: [true] }]
          : [
              {
                executingTransition: false,
              },
              // Routes have settled: the active set is final
              {
                syncDocumentTitle: [],
              },
              {
                emit: ["spa-manager-rendered"],
              },
            ]),
      ];
    },
    /**
     * `document.title` = the last active descendant route carrying a
     * `document-title`, else the page's own `<title>`.
     */
    syncDocumentTitle: (element) => {
      const parentManager = element.parentElement?.closest(
        "spa-manager"
      ) as unknown as { syncDocumentTitle: () => void } | null;
      // One document, one title: a nested manager computes nothing, it hands
      // the job to the outermost one, which sees every active route.
      if (parentManager) {
        parentManager.syncDocumentTitle();
        return;
      }
      // Attribute reflection is synchronous, but the prop is the source of truth
      const titled = (
        Array.from(
          element.querySelectorAll("spa-route")
        ) as THTMLSpaRouteElement[]
      )
        // Last in document order wins, so a nested route beats its ancestor
        .findLast((route) => route.isActive && route.documentTitle);
      // No route has ever claimed the title: leave the page's own alone
      if (!titled && element._defaultTitle == null) return;
      if (element._defaultTitle == null) {
        element._defaultTitle = document.title;
      }
      const title = titled?.documentTitle ?? element._defaultTitle;
      if (document.title !== title) {
        document.title = title;
      }
    },
    _updateRoutes: (element, doTransition: boolean) => {
      // @ts-ignore TODO defineMethods
      const { doCleanup, provision, fireTransition } = element;
      // Callbacks that arrived mid-transition are picked up by `doCleanup`
      const callbacks = [
        // Order matters: unrender first
        ...(element._routeCallbacks?.unrender || []),
        // then render
        ...(element._routeCallbacks?.render || []),
        // `provision` last: otherwise Quark starts rendering before unrender/render wipes the tree.
        ...(element._routeCallbacks?.provision || []),
      ];
      const runUpdate = () => {
        const promises = callbacks
          .map((cb) => cb())
          .filter((p: any) => p instanceof Promise);
        return new Promise((resolve) => {
          if (!promises.length) {
            resolve(true);
          } else {
            // Aborted renders reject their ready promise; settle either way
            // so a skipped / canceled nav doesn't hang until `renderTimeout`.
            Promise.allSettled(promises).then(() => {
              resolve(true);
            });
            element.renderTimeoutId = setTimeout(() => {
              resolve(true);
            }, element.renderTimeout!);
          }
        });
      };
      const firstPaint = element._firstPaintPending;
      element._firstPaintPending = false;
      // Skip if the browser already has a UA visual transition
      if (
        doTransition &&
        !firstPaint &&
        !provision?.event?.hasUAVisualTransition
      ) {
        element.isTransitioning = true;
        const viewTransition = document.startViewTransition({
          update: runUpdate,
          types: [provision?.move ? "route-" + provision.move : undefined]
            .concat(
              provision?.move === "back"
                ? provision?.next?.ttypes || []
                : provision?.active?.ttypes || []
            )
            .filter((type): type is string => type !== undefined),
        });
        viewTransition.finished.then(() => {
          doCleanup();
        });
        fireTransition(viewTransition);
      } else {
        runUpdate().then(() => {
          doCleanup();
        });
      }
      return {
        _routeCallbacks: {
          provision: [],
          render: [],
          unrender: [],
        },
      };
    },
    resetTransitionDelayId: ({ transitionDelayId }, clear: boolean) => {
      if (clear && transitionDelayId) {
        clearTimeout(transitionDelayId);
      }
      return { transitionDelayId: null };
    },
    updateRoutes: (
      // @ts-ignore TODO defineMethods
      { _updateRoutes, transitionDelay, resetTransitionDelayId },
      doTransition: boolean
    ) => {
      resetTransitionDelayId(true);
      const cb = () => {
        resetTransitionDelayId(false);
        _updateRoutes(doTransition);
      };
      if (transitionDelay == null) {
        cb();
      } else {
        return { transitionDelayId: setTimeout(cb, transitionDelay) };
      }
    },
    fireTransition: (_, viewTransition: ViewTransition) => ({
      _activeViewTransition: viewTransition,
      emit: [
        "spa-manager-transition",
        { detail: { transition: viewTransition } },
      ],
    }),
    routeChanged: ({ activeUrl }, routeData: KitRouteData) => ({
      ...(activeUrl && { lastMove: routeData.move }),
      activeUrl: routeData.active.url,
      provision: routeData,
      ...(routeData.move && { emit: ["spa-manager-" + routeData.move] }),
    }),
    handleTouchStart: ({ overscrollXThreshold }, e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        if (
          touch.clientX < overscrollXThreshold ||
          touch.clientX > window.innerWidth - overscrollXThreshold
        ) {
          return {
            swipeTracker: {
              identifier: touch.identifier,
              startX: clamp(touch.clientX, 0, window.innerWidth),
              startY: clamp(touch.clientY, 0, window.innerHeight),
            },
          };
        }
      }
    },
    handleTouchMove: (
      { swipeTracker, overscrollBehaviorX, overscrollXThreshold, router },
      e: TouchEvent
    ) => {
      if (!swipeTracker) return null;
      const touch = Array.from(e.touches).find(
        ({ identifier }) => identifier === swipeTracker.identifier
      );
      if (!touch) return null;

      const diffX = touch.clientX - swipeTracker.startX;
      const diffY = touch.clientY - swipeTracker.startY;
      const Y_TOLERANCE = 0.4;
      const shouldPrevent =
        Math.abs(diffX) >= 2 &&
        Math.abs(diffX) >= Math.round(diffY * Y_TOLERANCE);
      const shouldNavigate =
        shouldPrevent && overscrollBehaviorX === "navigate";
      const draggedRight =
        // went right
        diffX > 0 &&
        // started before threshold
        swipeTracker.startX < overscrollXThreshold &&
        // ended after threshold
        touch.clientX > overscrollXThreshold;
      const draggedLeft =
        // dragged left
        diffX < 0 &&
        // started before threshold
        swipeTracker.startX > window.innerWidth - overscrollXThreshold &&
        // ended after threshold
        touch.clientX < window.innerWidth - overscrollXThreshold;

      if (shouldPrevent) {
        e.preventDefault();
      }
      if (shouldNavigate && (draggedRight || draggedLeft)) {
        const method = draggedRight
          ? "back"
          : draggedLeft
            ? "forward"
            : undefined;
        if (method) {
          router![method]();
          return { swipeTracker: null };
        }
      }
    },
    handleTouchEnd: () => {
      return {
        swipeTracker: null,
      };
    },
  })
  .onConstructed(() => ({
    router: kitRouter,
    _routeCallbacks: {
      provision: [],
      render: [],
      unrender: [],
    },
  }))
  .onConnected(
    // Run RoutableElement logic
    ({ wasMounted }) => !wasMounted && { routeHref: new RegExp(".*") }
  )
  .onPropChanged(
    "overscrollBehaviorX",
    ({
      overscrollBehaviorX,
      handleTouchStart,
      handleTouchMove,
      handleTouchEnd,
    }) => {
      // Skip on non-touch devices
      if (!("ontouchstart" in window || navigator.maxTouchPoints > 0))
        return null;

      const shouldListen = ["none", "navigate"].includes(
        overscrollBehaviorX as string
      );
      const opts = { target: document, passive: false };
      return {
        toggleListeners: [
          ["touchstart", handleTouchStart, shouldListen, opts],
          ["touchmove", handleTouchMove, shouldListen, opts],
          ["touchend", handleTouchEnd, shouldListen, opts],
          ["touchcancel", handleTouchEnd, shouldListen, opts],
        ],
      };
    }
  )
  .onPropChanged("maxStates", ({ maxStates, router }) => {
    router!.MAX_STATES = maxStates ?? router!.DEFAULT_MAX_STATES;
  })
  .onPropSet("executingTransition", () => ({
    updateRoutes: [true],
  }))
  .onPropUnset(
    "executingTransition",
    ({ renderTimeoutId, resetTransitionDelayId, _activeViewTransition }) => {
      if (renderTimeoutId) {
        clearTimeout(renderTimeoutId);
      }
      // @ts-ignore TODO fix `onPropUnset` typing for boolean props
      resetTransitionDelayId(true);
      // @ts-ignore TODO fix `onPropUnset` typing for boolean props
      _activeViewTransition?.skipTransition?.();
      return {
        renderTimeoutId: null,
        _activeViewTransition: null,
        _routeCallbacks: {
          provision: [],
          render: [],
          unrender: [],
        },
        isTransitioning: false,
      };
    }
  )
  .onEvent("spa-route-unrender", (_, e) => ({
    pushRouteCallback: [e, "unrender", e.detail],
  }))
  .onEvent("spa-route-render", (_, e) => ({
    pushRouteCallback: [e, "render", e.detail],
  }))
  .onEvent("spa-route-provision", (_, e) => ({
    pushRouteCallback: [e, "provision", e.detail],
  }))
  .onEventDefault("spa-manager-will-transition", () => ({
    hasRendered: true,
    executingTransition: true,
  }))
  .onEvent("spa-route-error", (_, e) => {
    e.stopPropagation();
    return {
      updateRoutes: [false],
      emit: ["spa-manager-error", { detail: e.detail }],
    };
  });
const prefersReducedMotion =
  // @ts-ignore make ts unhappy, but this supports legacy browsers
  window.matchMedia?.(`(prefers-reduced-motion: reduce)`) === true ||
  window.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches === true;

function shouldTransition(
  // typeof SpaManager.CustomElement
  manager: any,
  route: THTMLSpaRouteElement
): boolean {
  return (
    !!document.startViewTransition &&
    !prefersReducedMotion &&
    !manager.noTransition &&
    !route.noTransition &&
    (manager.transitionFirstRender || manager.hasRendered)
  );
}
