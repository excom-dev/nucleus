import type {
  SpaRoute as TSpaRoute,
  SpaRouteProvisionEvent,
} from "./spa-route";
import { type KitRouteData, kitRouter } from "@excom/kit-router";
import { tc } from "@excom/kit-utils";
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

type RouteCallback = () => unknown;

const noCallbacks = () => ({
  provision: [] as RouteCallback[],
  render: [] as RouteCallback[],
  unrender: [] as RouteCallback[],
});

// Hold a restored offset this long while the layout settles
const HOLD_SCROLL_MS = 2000;
// The person taking over scroll
const SCROLL_INPUTS = ["wheel", "touchstart", "pointerdown", "keydown"];

/* Connected outermost managers. The browser's own scroll restore stays off
   while any is connected; the page's value comes back after the last. */
let owners = 0;
let pageScrollRestoration: ScrollRestoration = "auto";

/** The outermost manager owns the View Transition, `document.title` and scroll. */
const isOwner = (manager: Element): boolean =>
  !manager.parentElement?.closest<Element>("spa-manager");

const activeRoutes = (manager: Element) =>
  (
    Array.from(manager.querySelectorAll("spa-route")) as THTMLSpaRouteElement[]
  ).filter(({ isActive }) => isActive);

/** Nested managers whose routes are in the outermost manager's update. */
const joinedManagers = (owner: Element) =>
  Array.from(
    owner.querySelectorAll<
      Element & { _joined?: boolean; hasRendered?: boolean }
    >("spa-manager")
  ).filter(({ _joined }) => _joined);

/** A render / unrender animates unless its route or a manager above opts out. */
const animates = (route: THTMLSpaRouteElement): boolean =>
  !route.noTransition && !route.closest("spa-manager[no-transition]");

const canTransition = () =>
  typeof document.startViewTransition === "function" &&
  !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches &&
  document.visibilityState !== "hidden";

const settle = (...promises: unknown[]) => Promise.allSettled(promises);

/** Settle `promises`, giving up at `deadline` (a `performance.now()` time). */
const settleBy = async (promises: unknown[], deadline: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    settle(...promises),
    new Promise(
      (resolve) =>
        (timeoutId = setTimeout(
          resolve,
          Math.max(0, deadline - performance.now())
        ))
    ),
  ]);
  clearTimeout(timeoutId);
};

/**
 * The one scroll write the entry being entered is due:
 * - its saved offset (back / forward / reload), held while the layout settles;
 * - else its `#fragment` element, when the document has it;
 * - else `0` on axes the last active route resets for this move, only once a
 *   route rendered (a query-only move keeps its place).
 * None while an active route has `scroll-set-disabled`.
 */
const dueScroll = (
  routes: THTMLSpaRouteElement[],
  { move, active }: KitRouteData,
  rendered: boolean
): { target?: ScrollToOptions; held?: ScrollToOptions; fragment?: Element } => {
  if (routes.some(({ scrollSetDisabled }) => scrollSetDisabled)) return {};
  const route = routes.at(-1);
  const resets = (moves?: string[]) =>
    rendered && !!move && !!moves?.includes(move);
  const resetX = resets(route?.scrollResetX);
  const resetY = resets(route?.scrollResetY);
  // Restores are instant, and only they are held
  const restored: ScrollToOptions = {
    ...(!resetX && active?.scrollX != null && { left: active.scrollX }),
    ...(!resetY && active?.scrollY != null && { top: active.scrollY }),
    behavior: "instant",
  };
  const held = "left" in restored || "top" in restored ? restored : undefined;
  const fragment =
    !held && location.hash
      ? document.getElementById(
          tc(() => decodeURIComponent(location.hash.slice(1))) ?? ""
        )
      : null;
  if (fragment) return { fragment };
  if (!held && !resetX && !resetY) return {};
  return {
    held,
    target: {
      behavior: (route?.scrollResetBehavior as ScrollBehavior) || "instant",
      ...(resetX && { left: 0 }),
      ...(resetY && { top: 0 }),
      ...held,
    },
  };
};

// A frame, or 100 ms where frames pause (a hidden page)
const nextFrame = async () => {
  let frameId = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  await new Promise((resolve) => {
    frameId = requestAnimationFrame(resolve);
    timeoutId = setTimeout(resolve, 100);
  });
  cancelAnimationFrame(frameId);
  clearTimeout(timeoutId);
};

const scrollState = () => ({
  x: window.scrollX,
  y: window.scrollY,
  size: `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`,
});

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
 * @fires spa-manager-will-transition - Cancelable. Outermost manager, once per update chain (the first paint included), before its update (and View Transition, if any) starts. `preventDefault()` holds the update until `updateRoutes(true)` is called (`updateRoutes()` runs it without a View Transition).
 * @type SpaManagerWillTransitionEvent
 * @fires spa-manager-transition - Outermost manager, after `document.startViewTransition()` is called.
 * @type SpaManagerTransitionEvent
 * @fires spa-manager-rendered - After the update (and its transition) finishes: routes settled, title and scroll applied. Nested managers whose routes took part fire it too, without bubbling.
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
 * @default-action spa-manager-will-transition - Starts the batched update, inside a View Transition unless the API is missing, reduced motion is on, the page is hidden, it is the first paint (without `transition-first-render`), the browser already animated the navigation, the batch only provisions or routes opt out.
 *
 * @listens spa-route-render - Queues the child's render callback for the next batched update. A nested manager lets it bubble on to the outermost one.
 * @type RenderableRenderEvent
 * @listens spa-route-unrender - Queues the child's unrender callback (runs before renders so the outgoing route leaves first).
 * @type RenderableUnrenderEvent
 * @listens spa-route-provision - Queues the child's route data update into the next batched update.
 * @type SpaRouteProvisionEvent
 * @listens spa-route-error - Re-emits as `spa-manager-error`.
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
       * Delay (ms) before an update that animates (its View Transition) starts;
       * an update that does not animate, and the first paint, never are. Gives late
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
       * Max wait (ms) for child routes to be ready before the update (title, scroll, its View Transition) moves on. Raise for slow remote templates.
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
       * The first update with a render has settled (rendered, failed or hit `render-timeout`). Set in that update, inside its View Transition if one runs, before `spa-manager-rendered`: hide a loading shell / splash screen on it. Gates `transition-first-render`.
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
      // an update is scheduled or running, or its transition is finishing
      executingTransition: { type: Boolean, attr: false },
      // the update is running its routes: route events join it
      _updating: { type: Boolean, attr: false },
      // the queued batch has a render / unrender that may animate
      _animate: { type: Boolean, attr: false },
      // nested: its routes are in the outermost manager's update
      _joined: { type: Boolean, attr: false },
      // outermost: a navigation's scroll write is still due
      _scrollDue: { type: Boolean, attr: false },
      // registered with the router: later calls are navigations
      _routed: { type: Boolean, attr: false },
      // a restored offset, re-applied while the layout settles
      _heldScroll: {
        type: Object as unknown as ConstructorType<ScrollToOptions | null>,
        attr: false,
      },
      // counted in `owners`
      _ownsScroll: { type: Boolean, attr: false },
      // the page's own <title>, captured before the first route title lands
      _defaultTitle: { type: String, attr: false },
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
      _routeCallbacks: Object as unknown as ConstructorType<
        ReturnType<typeof noCallbacks>
      >,
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
      e: Event,
      type: "provision" | "render" | "unrender",
      callback: RouteCallback
    ) => {
      // Nested: let the event bubble on, the outermost manager batches it
      if (!isOwner(element)) return { _joined: true };
      e.stopPropagation();
      e.preventDefault();
      const {
        _routeCallbacks,
        _updating,
        isTransitioning,
        executingTransition,
        _activeViewTransition,
      } = element;
      // @ts-ignore TODO defineMethods
      const isIdle = !executingTransition && !element.hasCallbacks();
      /* A navigation after the update, while its transition still animates:
         skip it so `doCleanup` starts the next update now. During the update
         the route joins it instead (a nested route rendered by a layout). */
      if (isTransitioning && !_updating) {
        _activeViewTransition?.skipTransition?.();
      }
      return [
        {
          _routeCallbacks: {
            ...noCallbacks(),
            ..._routeCallbacks,
            [type]: [...(_routeCallbacks?.[type] || []), callback],
          },
        },
        type !== "provision" &&
          animates(e.target as THTMLSpaRouteElement) && { _animate: true },
        isIdle && { emit: ["spa-manager-will-transition"] },
      ];
    },
    _takeCallbacks: ({ _routeCallbacks }) => [
      { returns: { ...noCallbacks(), ..._routeCallbacks } },
      { _routeCallbacks: noCallbacks(), _animate: false },
    ],
    doCleanup: (element) => {
      // @ts-ignore TODO defineMethods
      if (element.hasCallbacks()) {
        // A navigation arrived after the update: run the next one
        return [{ _activeViewTransition: null }, { updateRoutes: [true] }];
      }
      return [
        { _activeViewTransition: null, executingTransition: false },
        // Nested managers whose routes took part announce it too; not
        // bubbling, so the outermost one gets one event per update
        ...joinedManagers(element).map((target) => ({
          emit: ["spa-manager-rendered", { target, bubbles: false }],
        })),
        { emit: ["spa-manager-rendered"] },
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
      // Last in document order wins, so a nested route beats its ancestor
      const titled = activeRoutes(element).findLast(
        ({ documentTitle }) => documentTitle
      );
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
    _updateRoutes: (_, animate: boolean) => [
      { isTransitioning: animate, _updating: true },
      { _runUpdate: [animate] },
    ],
    _runUpdate: async (element, animate: boolean) => {
      const {
        // @ts-ignore TODO defineMethods
        _takeCallbacks,
        // @ts-ignore TODO defineMethods
        hasCallbacks,
        // @ts-ignore TODO defineMethods
        _finishUpdate,
        // @ts-ignore TODO defineMethods
        doCleanup,
        // @ts-ignore TODO defineMethods
        fireTransition,
        provision,
        renderTimeout,
      } = element;
      /* The one update, with or without a View Transition: routes (and any
         route that activates meanwhile), then title, then scroll. One
         `render-timeout` for the whole update, late joins included. */
      const update = async () => {
        const deadline = performance.now() + renderTimeout!;
        let rendered = false;
        try {
          do {
            const queue: ReturnType<typeof noCallbacks> = _takeCallbacks();
            rendered ||= queue.render.length > 0;
            // Aborted renders reject their ready promise: settle either way
            await settleBy(
              // Unrender, then render; `provision` last: otherwise Quark
              // starts rendering before unrender/render wipes the tree.
              [...queue.unrender, ...queue.render, ...queue.provision].map(
                (callback) => callback()
              ),
              deadline
            );
          } while (hasCallbacks());
        } finally {
          _finishUpdate(rendered);
        }
      };
      let updating: Promise<void> | undefined;
      // An engine that rejects the options (no transition types) throws
      const transition: ViewTransition | undefined =
        animate &&
        tc(() =>
          document.startViewTransition({
            update: () => (updating = update()),
            types: [provision?.move ? "route-" + provision.move : undefined]
              .concat(
                provision?.move === "back"
                  ? provision?.next?.ttypes || []
                  : provision?.active?.ttypes || []
              )
              .filter((type): type is string => type !== undefined),
          })
        );
      try {
        if (transition) {
          fireTransition(transition);
          // A skipped transition rejects `ready`: settle all, then clean up
          await settle(
            transition.ready,
            transition.updateCallbackDone,
            transition.finished
          );
          await settle(updating);
        } else {
          await update();
        }
      } finally {
        doCleanup();
      }
    },
    /* Routes settled: `has-rendered` lands with them (in the new snapshot),
       on nested managers that took part too. A manager removed mid-update
       leaves title and scroll alone. */
    _finishUpdate: (element, rendered: boolean) => {
      if (rendered) {
        joinedManagers(element).forEach(
          (manager) => (manager.hasRendered = true)
        );
      }
      return [
        rendered && { hasRendered: true },
        element.isMounted && { syncDocumentTitle: [] },
        element.isMounted && { _applyScroll: [rendered] },
        { _updating: false },
      ];
    },
    /**
     * The navigation's one scroll write: in its update once the routes are
     * ready, before the new snapshot, or right away when no route reacted
     * (a hash-only move).
     */
    _applyScroll: (element, rendered: boolean) => {
      const { provision, _scrollDue } = element;
      if (!_scrollDue || !provision) return;
      const { target, held, fragment } = dueScroll(
        activeRoutes(element),
        provision,
        rendered
      );
      fragment?.scrollIntoView();
      if (target) window.scrollTo(target);
      return { _scrollDue: false, _heldScroll: held ?? null };
    },
    // @ts-ignore TODO defineMethods
    _scrollIfIdle: ({ _updating, hasCallbacks }) =>
      !_updating && !hasCallbacks() && { _applyScroll: [false] },
    /**
     * Re-apply a held offset whenever the page's scroll size changes (late
     * content, scroll anchoring). A move while the size stays put is the
     * person (a scrollbar drag) or the app scrolling: release.
     */
    _holdScroll: async (element, held: ScrollToOptions) => {
      const releaseAt = performance.now() + HOLD_SCROLL_MS;
      let last = scrollState();
      while (element._heldScroll === held && performance.now() < releaseAt) {
        await nextFrame();
        const now = scrollState();
        if (element._heldScroll !== held) break;
        if (now.size === last.size) {
          if (Math.abs(now.x - last.x) >= 1 || Math.abs(now.y - last.y) >= 1) {
            break;
          }
          continue;
        }
        window.scrollTo(held);
        last = scrollState();
      }
      if (element._heldScroll === held) {
        // @ts-ignore TODO defineMethods
        element._releaseScroll();
      }
    },
    _releaseScroll: () => ({ _heldScroll: null }),
    resetTransitionDelayId: ({ transitionDelayId }, clear: boolean) => {
      if (clear && transitionDelayId) {
        clearTimeout(transitionDelayId);
      }
      return { transitionDelayId: null };
    },
    updateRoutes: (element, doTransition: boolean) => {
      const {
        // @ts-ignore TODO defineMethods
        _updateRoutes,
        // @ts-ignore TODO defineMethods
        resetTransitionDelayId,
        transitionDelay,
        provision,
        hasRendered,
        transitionFirstRender,
        _animate,
      } = element;
      resetTransitionDelayId(true);
      const animate =
        doTransition &&
        // A batch that only provisions changes nothing to animate
        !!_animate &&
        canTransition() &&
        // First paint has nothing to transition from
        (hasRendered || transitionFirstRender) &&
        // The browser already animated the navigation
        !provision?.event?.hasUAVisualTransition;
      const cb = () => {
        resetTransitionDelayId(false);
        _updateRoutes(animate);
      };
      // Only an update that animates waits for `transition-delay`, never the
      // first paint
      if (!animate || !hasRendered || transitionDelay == null) {
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
    routeChanged: (element, routeData: KitRouteData) => {
      const owns = isOwner(element);
      /* Routes react to a navigation synchronously: no batch by the next
         microtask means nothing will write its scroll. Not the registration
         call: routes may connect later, the first update writes. */
      // @ts-ignore TODO defineMethods
      if (owns && element._routed) queueMicrotask(element._scrollIfIdle);
      return {
        _routed: true,
        ...(element.activeUrl && { lastMove: routeData.move }),
        activeUrl: routeData.active.url,
        provision: routeData,
        // A navigation starts: its write is due, a held offset is released
        ...(owns && { _scrollDue: true, _heldScroll: null }),
        ...(routeData.move && { emit: ["spa-manager-" + routeData.move] }),
      };
    },
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
    _routeCallbacks: noCallbacks(),
  }))
  .onConnected(
    // Run RoutableElement logic
    ({ wasMounted }) => !wasMounted && { routeHref: new RegExp(".*") }
  )
  /* The outermost manager restores scroll itself: the browser's own restore
     lands during `popstate`, on the old view, before any transition starts. */
  .onConnected((element) => {
    if (element.isMoving || !isOwner(element)) return;
    if (owners++ === 0) pageScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return { _ownsScroll: true };
  })
  .onDisconnected(({ isMoving, _ownsScroll }) => {
    if (isMoving) return;
    if (_ownsScroll && --owners === 0) {
      history.scrollRestoration = pageScrollRestoration;
    }
    // Re-registers on reconnect; a detached manager writes nothing
    return {
      _routed: false,
      _ownsScroll: false,
      _scrollDue: false,
      _heldScroll: null,
    };
  })
  // Hold a restored offset until the person scrolls, touches, clicks or types
  .onPropChanged("_heldScroll", ({ _heldScroll, _releaseScroll }) => [
    {
      toggleListeners: SCROLL_INPUTS.map((type) => [
        type,
        _releaseScroll,
        !!_heldScroll,
        { target: window, passive: true },
      ]),
    },
    _heldScroll && { _holdScroll: [_heldScroll] },
  ])
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
    ({ resetTransitionDelayId, _activeViewTransition }) => {
      // @ts-ignore TODO fix `onPropUnset` typing for boolean props
      resetTransitionDelayId(true);
      // @ts-ignore TODO fix `onPropUnset` typing for boolean props
      _activeViewTransition?.skipTransition?.();
      // The queue stays: a `spa-manager-rendered` listener may navigate
      return {
        _activeViewTransition: null,
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
    executingTransition: true,
  }))
  // Nested: announced by the outermost manager's update
  .onEvent(
    "spa-manager-rendered",
    (element, e) => e.target === element && { _joined: false }
  )
  .onEvent("spa-route-error", (_, e) => {
    e.stopPropagation();
    return {
      emit: ["spa-manager-error", { detail: e.detail }],
    };
  });
