import { AbortableElement } from "@excom/abortable-element";
import { KitLogger } from "@excom/kit-logger";
import { requestIdleCb } from "@excom/kit-shims";
import {
  replaceNonTemplateChildren,
  resolveTemplateContent,
  selectOne,
} from "@excom/kit-utils";
import { ConstructorType, Neutron, TEvent } from "@excom/neutron";

export type RenderThunk = () => Promise<void>;
export type UnrenderThunk = () => void;

export type RenderableRenderEvent = TEvent & {
  type: "{tag}-render";
  detail: RenderThunk;
};

export type RenderableUnrenderEvent = TEvent & {
  type: "{tag}-unrender";
  detail: UnrenderThunk;
};

export type RenderableDidRenderEvent = TEvent & {
  type: "{tag}-did-render";
  detail: void;
};

export type RenderableDidUnrenderEvent = TEvent & {
  type: "{tag}-did-unrender";
  detail: void;
};

export type RenderableErrorEvent = TEvent & {
  type: "{tag}-error";
  detail: void;
};

export type RenderableAbortedEvent = TEvent & {
  type: "{tag}-aborted";
  detail: void;
};

const IFRAME_HOST_ATTR = "data-render-host";
/** Iframes waiting on `load` so their body can be `renderHost`. */
const pendingIframeLoads = new WeakSet<HTMLIFrameElement>();

// Must stay `async` even when `resolveTemplateContent` is sync.
const initTemplatePromise = async (
  element,
  opts: { forceBypassCache?: boolean } = {}
) => {
  const { templateRef, bypassCache, abortController } = element;
  // Snapshot this signal: `doAbort` rotates a fresh controller onto the
  // element, so don't read `element.abortController` after await.
  const { signal } = abortController;
  try {
    return await resolveTemplateContent(templateRef, {
      scope: element,
      bypassCache: bypassCache || opts.forceBypassCache,
      reqInit: { signal },
    });
  } catch (error) {
    // Preserve aborts so disconnect / reload teardown is quiet
    if (error?.name === "AbortError" || signal.aborted) {
      throw error?.name === "AbortError"
        ? error
        : Object.assign(new Error("Aborted"), { name: "AbortError" });
    }
    throw new Error(`Failed to find template: ${templateRef}`);
  }
};

export interface PromiseObject {
  promise: Promise<void>;
  resolve: (value: void) => void;
  reject: (reason?: any) => void;
}

const makePromiseObject = () => {
  const readyPromiseObject = {} as unknown as PromiseObject;
  readyPromiseObject.promise = new Promise((resolve, reject) => {
    readyPromiseObject.resolve = resolve;
    readyPromiseObject.reject = reject;
  });
  return readyPromiseObject;
};

/**
 * Composition base that resolves a `<template>` reference, fetches its
 * content (eagerly, on idle, lazily, or on demand), and renders / unrenders
 * those children into a configurable host (the element's own light DOM, an
 * attached shadow root, a child `<iframe data-render-host>`, or any
 * selector-resolved element). Not a registered element on its own (tag is
 * intentionally `noop-tag`) — compose it via
 * `Neutron.compose([RenderableElement, ...])` and the consumer element
 * inherits every attribute, state, and event declared below.
 *
 * Subclasses only need to toggle `is-active` to drive the lifecycle:
 * setting it triggers loading (if needed) and renders the template;
 * unsetting it unrenders. Templates are resolved via
 * `resolveTemplateContent`, so `template-ref` accepts in-document selectors
 * (`":scope > template"`, the default) as well as URLs to remote
 * templates. URL responses are memoized in kit-utils (`TEMPLATES`);
 * `did-load` reflects that a resolve succeeded so consumers can treat
 * later toggles as warm. `persist-content` is separate: it keeps the
 * live rendered tree in `_persistedTree` across unrender / render.
 *
 * The `render` and `unrender` events are dispatched as cancelable defaults:
 * listeners can `preventDefault()` to take over the actual DOM update by
 * calling `event.detail()` themselves (handy for orchestrating view
 * transitions or animations from a parent like `<spa-manager>`).
 *
 * @fires {tag}-render - Cancelable. Dispatched when the element becomes
 *   active and is about to place template content into the host.
 *   `event.detail` is a thunk that performs the load (if not already
 *   loaded) and renders the children, returning a Promise that resolves
 *   once the corresponding `ready-on` event fires (or immediately if
 *   `ready-on` is unset). The promise rejects if the element is torn
 *   down mid-flight (`startTeardown` while loading / `delaying-ready`).
 *   Call `preventDefault()` to defer rendering and invoke
 *   `event.detail()` later.
 * @type RenderableRenderEvent
 * @fires {tag}-unrender - Cancelable. Dispatched when the element becomes
 *   inactive and content is already painted. `event.detail` is a thunk
 *   that removes the rendered children. Call `preventDefault()` to defer
 *   the removal. Not fired when teardown cancels an in-flight load —
 *   that path emits `aborted` instead.
 * @type RenderableUnrenderEvent
 * @fires {tag}-did-render - Dispatched after the template content has
 *   actually been placed into the host.
 * @type RenderableDidRenderEvent
 * @fires {tag}-did-unrender - Dispatched after rendered children have been
 *   removed from the host.
 * @type RenderableDidUnrenderEvent
 * @fires {tag}-error - Dispatched when the template promise rejects with
 *   anything other than an `AbortError`.
 * @type RenderableErrorEvent
 * @fires {tag}-aborted - Dispatched when an in-flight load / ready wait is
 *   canceled because `is-active` was unset (via `startTeardown`).
 * @type RenderableAbortedEvent
 *
 * @default-action {tag}-render - Invokes `event.detail()` to load (if
 *   needed) and render the template into the host.
 * @default-action {tag}-unrender - Invokes `event.detail()` to remove
 *   rendered children from the host.
 * @command --reload - Aborts any in-flight fetch and re-resolves the
 *   template, bypassing the cache for URL refs (useful after remote content
 *   changes).
 *
 * @child ?template - Optional immediate `<template>` child used when
 *   `template-ref` is the default `":scope > template"`. Not required when
 *   `template-ref` points at a selector or URL elsewhere.
 * @child ?iframe[data-render-host] - Required when `host-ref="iframe"`.
 *   Content paints into `iframe.contentDocument.body`. Provide your own
 *   iframe (e.g. with `srcdoc`); the element will not create one.
 */

export const RenderableElement = Neutron.compose([
  AbortableElement,
  Neutron({
    tag: "noop-tag",
    events: {
      ["render"]: {
        prefixWithTag: true,
      },
      ["unrender"]: {
        prefixWithTag: true,
      },
      ["did-render"]: {
        prefixWithTag: true,
      },
      ["did-unrender"]: {
        prefixWithTag: true,
      },
      error: {
        prefixWithTag: true,
      },
    },
    props: {
      /**
       * @option
       * Source `<template>` — in-document selector or remote URL.
       * Changing mid-flight aborts and reloads. Can use `:scope` to
       * relatively select elements: e.g. `main:has(:scope) > template`
       * @default :scope > template
       * @values <CSS Selector> | <URL>
       */
      templateRef: {
        type: String,
        defaultValue: () => ":scope > template",
      },
      /**
       * @option
       * Skip the in-memory response cache (URL `template-ref` only).
       */
      bypassCache: Boolean,
      /**
       * @option
       * When to fetch the template, independent of when it renders.
       * `""` aliases `eager`.
       * @default lazy
       */
      preFetch: {
        type: String,
        isValid: (value: string) =>
          // lazy (default): fetch only when needed.
          // empty string aliases eager
          ["", "eager", "idle", "lazy"].includes(value),
        defaultValue: () => "lazy",
      },
      /**
       * @option
       * Reuse the same live nodes across unrender / render (held on
       * `_persistedTree`) so form values, scroll position, and subtree
       * state survive toggles.
       */
      persistContent: Boolean,
      /**
       * @option
       * Where rendered children land. Unset = this element's light DOM.
       * `shadow` attaches an open shadow root. `iframe` paints into a
       * child `<iframe data-render-host>` body (you supply the iframe —
       * useful for sandboxed / third-party document isolation). Any
       * other value is a portal selector.
       * @values shadow | iframe | <CSS Selector>
       */
      hostRef: String,
      /**
       * @option
       * Event name that marks rendered children "ready". Until it fires,
       * `delaying-ready` is set so CSS can hide the host for a
       * coordinated paint / view transition.
       * @values <Event Name>
       */
      readyOn: String,
      /**
       * @option
       * @state
       * Master switch. Set to load (if needed) and render; unset to
       * unrender. Drive from visibility, route match, hover, etc.
       */
      isActive: Boolean,
      /**
       * @state
       * Template fetch in flight.
       */
      isLoading: Boolean,
      /**
       * @state
       * Template resolved at least once. Stays set across `is-active`
       * toggles so consumers know later paints are warm (URL refs reuse
       * the shared fetch cache in kit-utils). Cleared when
       * `template-ref` changes or `--reload` forces a fresh resolve.
       */
      didLoad: Boolean,
      /**
       * @state
       * Latest template fetch rejected (excluding abort). Fires with
       * the `error` event.
       */
      isError: Boolean,
      /**
       * @state
       * Between `render` and the matching `ready-on` event. Hook with
       * CSS for coordinated paints / view transitions.
       */
      delayingReady: Boolean,
      // private state
      templatePromise: Promise as unknown as ConstructorType<
        Promise<HTMLTemplateElement>
      >,
      /* Live tree kept only with `persist-content`. Cleared on template
         change / reload. Without persist, each paint re-resolves (URL hits
         `TEMPLATES`) and `importNode`s a fresh clone. */
      _persistedTree: Object as unknown as ConstructorType<Node | null>,
      /* Current render-host (null until set up, or while an iframe host
         is still loading). Null falls back to the element. Not an attribute. */
      renderHost: Object as unknown as ConstructorType<
        Element | ShadowRoot | null
      >,
      readyPromiseObject: Object as unknown as ConstructorType<PromiseObject>,
    },
  }),
])
  .defineMethods({
    setCanceledState: () => [
      { doAbort: [] },
      {
        templatePromise: null,
        isLoading: false,
        didLoad: false,
        isError: false,
        delayingReady: false,
      },
    ],
    /**
     * Resolve `hostRef` to a render-host:
     *   - unset/empty   -> null (caller uses the element)
     *   - "shadow"      -> element.shadowRoot (attaches on first call)
     *   - "iframe"      -> child `iframe[data-render-host]` body (null if
     *                      missing or still loading; load sets `renderHost`
     *                      and paints)
     *   - any other str -> selectOne(value, { scope: element })
     */
    resolveRenderHost: (element) => {
      const ref = element.hostRef as string | undefined;
      if (!ref) return { returns: null };
      if (ref === "shadow") {
        return {
          returns: element.shadowRoot ?? element.attachShadow({ mode: "open" }),
        };
      }
      if (ref === "iframe") {
        const iframe = element.querySelector(
          `:scope > iframe[${IFRAME_HOST_ATTR}]`
        ) as HTMLIFrameElement | null;
        if (!iframe) return { returns: null };
        const takeBody = () => iframe.contentDocument?.body ?? null;
        const body = takeBody();
        if (body) return { returns: body };
        /* Author iframe not ready: wait for load, then paint. Parser-created
           `srcdoc` iframes may have already fired `load` before upgrade, so
           re-probe on a microtask too. */
        if (!pendingIframeLoads.has(iframe)) {
          pendingIframeLoads.add(iframe);
          let settled = false;
          const onReady = () => {
            const readyBody = takeBody();
            if (!readyBody) return;
            if (settled) return;
            settled = true;
            pendingIframeLoads.delete(iframe);
            iframe.removeEventListener("load", onReady);
            if (element.hostRef !== "iframe" || !iframe.isConnected) return;
            element.renderHost = readyBody;
            if (!element.isActive) return;
            // @ts-expect-error TODO defineMethods
            if (element._persistedTree) element.renderChildren();
            // @ts-expect-error TODO defineMethods
            else element.attemptLoad();
          };
          iframe.addEventListener("load", onReady);
          queueMicrotask(onReady);
        }
        return { returns: null };
      }
      return { returns: selectOne(ref, { scope: element }) };
    },
    renderChildren: (element, resolved?: Node) => {
      const source = resolved ?? element._persistedTree;
      if (!source) return;
      // Host not ready yet (e.g. iframe still loading). Its load handler
      // retriggers this call.
      if (element.hostRef && !element.renderHost) return;
      const host = (element.renderHost ?? element) as Element;
      const children = [
        element.persistContent
          ? source
          : (document.importNode(source, true) as Element),
      ];
      if (replaceNonTemplateChildren(host, children as Node[])) {
        return [
          {
            tryCompleteReady: ["renderChildren"],
          },
          {
            emits: [["did-render"]],
          },
        ];
      }
    },
    unrenderChildren: (element) => {
      if (element.hostRef && !element.renderHost) return;
      const host = (element.renderHost ?? element) as Element;
      if (replaceNonTemplateChildren(host, [])) {
        return [
          /* Drop the non-persist source; `didLoad` stays so a warm
             re-resolve is available. With `persist-content`, keep
             `_persistedTree` (detached live nodes). */
          !element.persistContent && { _persistedTree: null },
          {
            emits: [["did-unrender"]],
          },
        ];
      }
    },
    // @ts-ignore TODO defineMethods
    startTeardown: ({ isLoading, delayingReady, unrenderChildren }) => {
      return isLoading || delayingReady
        ? [
            { setCanceledState: [] },
            { emit: ["aborted"] },
            { tryCompleteReady: ["startTeardown", "reject"] },
          ]
        : {
            emit: [
              /* Sync, but order still matters for listening parents. */
              "unrender",
              // Sync: do not return a promise
              { detail: unrenderChildren },
            ],
          };
    },
    // @ts-ignore TODO defineMethods
    setupRenderHost: ({ resolveRenderHost }) => ({
      renderHost: resolveRenderHost(),
    }),
    // Clear the current host's children on a `hostRef` retarget so the
    // next paint can retarget without a full teardown.
    clearHostChildren: (element) => {
      const host = (element.renderHost ?? element) as Element;
      if (replaceNonTemplateChildren(host, [])) {
        return {
          emits: [["did-unrender"]],
        };
      }
    },
    attemptLoad: (element, opts: { forceBypassCache?: boolean } = {}) => {
      const { templatePromise, isLoading, _persistedTree } = element;
      return [
        !templatePromise &&
          !isLoading &&
          !_persistedTree && {
            isLoading: true,
            isError: false,
            templatePromise: initTemplatePromise(element, opts),
          },
      ];
    },
    attemptPreFetch: (element, opts: { forceBypassCache?: boolean } = {}) => {
      // @ts-ignore TODO defineMethods
      const { preFetch, isActive, attemptLoad } = element;
      // Eager / empty `preFetch`, or the element is active.
      if (["eager", ""].includes(preFetch as string) || isActive)
        return { attemptLoad: [] };
      else if (preFetch === "idle") {
        const cb = () => {
          /* Re-read `preFetch` off the element; the captured value may be
             stale. `cancelIdleCallback` would be nicer, but Safari lacks it. */
          if (element.preFetch === "idle") {
            attemptLoad(opts);
          }
        };
        // Fallback: wait until after the next paint
        requestIdleCb(cb, 17);
      }
    },
    changeTemplate: (
      { templatePromise, isActive },
      opts: { forceBypassCache?: boolean } = {}
    ) => [
      templatePromise && {
        setCanceledState: [],
      },
      {
        didLoad: false,
        _persistedTree: null,
        isError: false,
      },
      // Bypass the in-memory template cache so reload sees the latest
      // source (matters when `templateRef` is a URL).
      isActive ? { attemptLoad: [opts] } : { attemptPreFetch: [opts] },
    ],
    readyContent: () => ({
      delayingReady: false,
    }),
    // @ts-ignore TODO defineMethods
    startReady: ({ readyOn, readyContent, readyPromiseObject }) => {
      if (readyPromiseObject) return false;
      const newReadyPromiseObject = makePromiseObject();
      if (readyOn) {
        // Ignore abort rejects; `readyContent` only runs on success
        newReadyPromiseObject!.promise.then(readyContent, () => {});
      }
      return [
        readyOn && { delayingReady: true },
        { readyPromiseObject: newReadyPromiseObject },
      ];
    },
    isResponsibleForReady: ({ readyOn }, caller: string | Event) => {
      if (caller === "startTeardown") {
        return { returns: true };
      } else if (readyOn && caller instanceof Event) {
        return { returns: true };
      } else if (!readyOn && caller === "renderChildren") {
        return { returns: true };
      }
      return { returns: false };
    },
    tryCompleteReady: (
      // @ts-ignore TODO defineMethods
      { readyPromiseObject, isResponsibleForReady },
      caller: string | Event,
      method: "reject" | any
    ) => {
      if (!readyPromiseObject || !isResponsibleForReady(caller)) {
        return;
      }
      /* `readyOn` can fire more than once. Pass `"reject"` on mid-flight
         teardown so waiters (e.g. spa-manager) don't treat the abort as ready. */
      if (method === "reject") {
        // Attach before reject so abort isn't an unhandled rejection when
        // no parent is awaiting the ready promise yet
        readyPromiseObject.promise.catch(() => {});
        readyPromiseObject.reject?.();
      } else {
        readyPromiseObject.resolve?.();
      }
      return {
        readyPromiseObject: null,
      };
    },
    // @ts-ignore TODO defineMethods
    renderCallback: ({ isActive, _persistedTree, tryCompleteReady }) =>
      /* Re-check `isActive`: the consumer may call this later, and the
         load may have been canceled (`isActive` false) in the meantime. */
      isActive
        ? [_persistedTree ? { renderChildren: [] } : { attemptLoad: [] }]
        : /* Torn down before a deferred render thunk ran (a parent such as
             `<spa-manager>` batches these). Reject the ready promise rather
             than dropping it: the thunk already handed it to the batch, and
             an unsettled promise would hang the batch until its timeout. */
          { tryCompleteReady: ["startTeardown", "reject"] },
    firePromiseEvent: (
      { readyPromiseObject },
      eventName: string,
      callback: () => void | Promise<void>
    ) => ({
      emit: [
        eventName,
        {
          detail: () => {
            queueMicrotask(() => {
              callback();
            });
            return readyPromiseObject?.promise;
          },
        },
      ],
    }),
  })
  .onPropChanged("readyOn", ({ readyOn, tryCompleteReady }, previous) => [
    previous.readyOn && {
      removeListener: [previous.readyOn, tryCompleteReady],
    },
    readyOn && {
      addListener: [readyOn, tryCompleteReady],
    },
  ])
  .onPropSet("preFetch", () => ({
    attemptPreFetch: [],
  }))
  // Reset when `templateRef` is removed or changed to a different truthy value
  .onPropChanged("templateRef", () => ({
    changeTemplate: [],
  }))
  .onCommand("--reload", () => ({
    changeTemplate: [{ forceBypassCache: true }],
  }))
  /*
   * Retarget when `hostRef` is set, changed, or unset. Order: clear the
   * old host's children (so a kept host, element / shadow / iframe body /
   * portal, isn't left stale), resolve the new host, then re-render.
   *
   * `persist-content` re-places `_persistedTree`. Otherwise `attemptLoad`
   * re-resolves (URL refs hit the shared fetch cache).
   *
   * An unreadied author iframe: `resolveRenderHost` returns null; its
   * load handler paints once the body exists.
   */
  .onPropChanged("hostRef", ({ isActive, _persistedTree }) => [
    /* Clear the previous host (light DOM / shadow / iframe body / portal)
       before resolving the new one. Author iframes stay; only their body
       children are cleared via `renderHost`. */
    isActive && { clearHostChildren: [] },
    { setupRenderHost: [] },
    isActive && (_persistedTree ? { renderChildren: [] } : { attemptLoad: [] }),
  ])
  .onPromiseResolved(
    "templatePromise",
    ({ isActive, persistContent }, result) => [
      {
        // Keep the live tree only when `persist-content` asks. Non-persist
        // paints get `resolved` as a method arg below.
        _persistedTree: persistContent ? result.templatePromise : null,
        templatePromise: null,
        isLoading: false,
        didLoad: true,
        isError: false,
      },
      isActive && { renderChildren: [result.templatePromise] },
    ]
  )
  .onPromiseRejected("templatePromise", ({ localName }, result) => {
    if (result.templatePromise?.name !== "AbortError") {
      KitLogger.error(
        `${localName}: template load failed`,
        result.templatePromise
      );
      return {
        templatePromise: null,
        isLoading: false,
        didLoad: false,
        isError: true,
        emit: ["error"],
      };
    } else {
      KitLogger.debug("templatePromise was aborted");
    }
  })
  .onPropUnset("isActive", () => ({ startTeardown: [] }))
  .onPropSet("isActive", ({ renderCallback }) => [
    // Re-resolve the host on activate so a late-ready author iframe is
    // picked up even if `host-ref` was set before its body existed.
    { setupRenderHost: [] },
    { startReady: [] },
    { firePromiseEvent: ["render", renderCallback] },
  ])
  /* Abort in-flight template work on disconnect so test teardown / SPA
     unmounts don't throw "Failed to find template" after the light-DOM
     source is gone. */
  .onDisconnected(
    ({ templatePromise, isMoving }) =>
      !isMoving &&
      templatePromise && {
        setCanceledState: [],
      }
  )
  .onEventDefault("render", (_, { detail }) => {
    detail();
  })
  .onEventDefault("unrender", (_, { detail }) => {
    detail();
  })
  .onError(({ localName }, error) => {
    KitLogger.error(`${localName}:`, error);
  });
