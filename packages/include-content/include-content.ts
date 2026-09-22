import { requestIdleCb } from "@excom/kit-shims";
import { selectOne } from "@excom/kit-utils";
import { Neutron } from "@excom/neutron";
import { RenderableElement } from "@excom/renderable-element";

/**
 * Renders a `<template>` / remote HTML on demand — when visible, when idle,
 * or immediately. Common cases need no app JavaScript.
 *
 * @summary Declarative view rendering — lazy (un)load, idle, conditional.
 */
export const IncludeContent = Neutron.compose([
  RenderableElement,
  Neutron({
    tag: "include-content",
    props: {
      /**
       * @option
       * Activate after first paint, when the browser is idle. Useful for
       * below-the-fold / secondary views that should not compete with
       * critical content.
       */
      idleLoad: Boolean,
      /**
       * @option
       * Activate when this element is on screen. Pair with
       * `lazy-unload` for lazy load and lazy unload of views.
       */
      lazyLoad: Boolean,
      /**
       * @option
       * Deactivate (unrender) when no longer on screen. Use with
       * `lazy-load` to free DOM for off-screen views.
       */
      lazyUnload: Boolean,
      /**
       * @option
       * Scroll container for lazy load / unload. Defaults to the
       * viewport.
       * @values <CSS Selector>
       */
      observerRoot: String,
      /**
       * @option
       * How far outside the root counts as "visible". Expand (e.g.
       * `500px`) to lazy-load a view *before* it enters the viewport so
       * users never see an empty slot; shrink (default `-1px`) so
       * edge-flush elements wait until they truly enter.
       * @default -1px -1px -1px -1px
       * @values <length> | <percentage>
       */
      observerRootMargin: {
        type: String,
        defaultValue: () => "-1px -1px -1px -1px",
      },
      /**
       * @option
       * Fraction of the element that must be visible (`0`–`1`) before
       * activating.
       */
      observerThreshold: Number,
      /**
       * @option
       * Minimum time visible before activating (ms). Ignored where
       * unsupported. Useful for ensuring lazy load is not triggered
       * when a programmatic smooth scroll zips the user right past
       * the element.
       * @default 0
       */
      observerDelay: {
        type: Number,
        defaultValue: () => 0,
      },
      // private state
      observer: IntersectionObserver,
    },
  }),
])
  .defineMethods({
    determineActive: (element, entry: IntersectionObserverEntry) => {
      const isVisible = element.checkVisibility
        ? element.checkVisibility()
        : true;
      if (
        isVisible &&
        entry.isIntersecting &&
        !element.isActive &&
        element.lazyLoad
      )
        return { isActive: true };
      else if (
        (!isVisible || !entry.isIntersecting) &&
        element.isActive &&
        element.lazyUnload
      )
        return { isActive: false };
    },
    createObserver: (element) => {
      if (!element.observer) {
        return {
          observer: watchElementWithIntersectionObserver(
            element,
            // @ts-ignore TODO defineMethods
            element.determineActive,
            {
              root: element.observerRoot
                ? selectOne(element.observerRoot, {
                    scope: element,
                  })
                : null,
              // Default `-1px` all around, so `top: 100vh` (etc.) isn't "visible"
              rootMargin: element.observerRootMargin,
              threshold: element.observerThreshold ?? undefined,
              // IntersectionObserver spec v2; TypeScript typings lag behind
              delay: element.observerDelay,
            }
          ),
        };
      }
    },
    destroyObserver: ({ observer }) => {
      if (observer) {
        observer.disconnect();
        return {
          observer: null,
        };
      }
    },
  })
  .onPropSet("idleLoad", (el) => {
    if (!el.isActive) {
      const cb = () => {
        // Re-check `idleLoad`; the captured value may be stale.
        // `cancelIdleCallback` would be nicer, but Safari lacks it.
        if (el.idleLoad) {
          el.isActive = true;
        }
      };
      // Fallback: wait until after the next paint (~16ms)
      requestIdleCb(cb, 17);
    }
  })
  .onPropChanged(["lazyLoad", "lazyUnload"], ({ lazyLoad, lazyUnload }) =>
    lazyLoad || lazyUnload ? { createObserver: [] } : { destroyObserver: [] }
  )
  /* Drop the observer once it's no longer needed */
  .onPropSet(
    "isActive",
    ({ lazyUnload }) =>
      !lazyUnload && {
        destroyObserver: [],
      }
  )
  .onPropUnset(
    "isActive",
    ({ lazyLoad }) => !lazyLoad && { destroyObserver: [] }
  )
  .onDisconnected(() => ({ destroyObserver: [] }))
  .onConnected(
    ({ lazyLoad, lazyUnload, wasMounted }) =>
      // Rebuilt after a real remove + reconnect (dev / framework remounts)
      wasMounted && (lazyLoad || lazyUnload) && { createObserver: [] }
  );

function watchElementWithIntersectionObserver(
  element: HTMLElement,
  callback: (entry: IntersectionObserverEntry) => void,
  // TODO: `IntersectionObserverInit` here causes a circular dependency?
  options = {}
) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(callback);
  }, options);
  observer.observe(element);
  return observer;
}
