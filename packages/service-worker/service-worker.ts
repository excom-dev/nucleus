import {
  ConstructorType,
  Neutron,
  TEvent,
  TokenList,
} from "@excom/neutron";

const SW_EVENTS = ["message", "messageerror", "controllerchange"];

export type ServiceWorkerMessageEvent = TEvent & {
  type: "message";
  detail: unknown;
};

export type ServiceWorkerMessageErrorEvent = TEvent & {
  type: "messageerror";
  detail: unknown;
};

export type ServiceWorkerControllerChangeEvent = TEvent & {
  type: "controllerchange";
  detail: void;
};

/** What this element knows about `navigator.serviceWorker`. */
export interface ServiceWorkerProvision {
  /** The Service Worker API is available. */
  isSupported: boolean;
  /** `navigator.serviceWorker.ready` has resolved. */
  isReady: boolean;
  /** A worker currently controls this page (`navigator.serviceWorker.controller`). */
  hasController: boolean;
  /** The ready registration's scope; `null` until `ready` resolves. */
  scope: string | null;
}

const hasController = () => !!navigator.serviceWorker?.controller;

/**
 * Observes an already-registered Service Worker. This element does **not**
 * register a Service Worker itself — your app must call
 * `navigator.serviceWorker.register(...)` separately; this element only
 * reports on `navigator.serviceWorker` and, optionally, relays its events
 * onto itself as plain DOM events for Quark / `<event-handler>` to react
 * to.
 *
 * `.provision` holds `{ isSupported, isReady, hasController, scope }`, kept
 * current on connect, when `ready` resolves, and on every
 * `controllerchange` — whether or not that event is relayed.
 *
 * @summary Observes `navigator.serviceWorker` — does not register a SW.
 *
 * @fires message - Relayed verbatim from `navigator.serviceWorker`'s
 *   `message` event when `message` is included in `relay-events`. Not
 *   tag-prefixed. `event.detail` is `event.data` from the original
 *   message.
 * @type ServiceWorkerMessageEvent
 * @fires messageerror - Relayed verbatim from `navigator.serviceWorker`'s
 *   `messageerror` event when `messageerror` is included in
 *   `relay-events`. Not tag-prefixed.
 * @type ServiceWorkerMessageErrorEvent
 * @fires controllerchange - Relayed verbatim from
 *   `navigator.serviceWorker`'s `controllerchange` event when
 *   `controllerchange` is included in `relay-events`. Not tag-prefixed.
 * @type ServiceWorkerControllerChangeEvent
 */
export const ServiceWorker = Neutron({
  tag: "service-worker",
  reflectDefaultProps: ["isMounted"],
  props: {
    // options
    /**
     * @option
     * Space-separated `navigator.serviceWorker` events to relay onto this
     * element. Bare attribute (no value) relays all three. Event names
     * are relayed as-is — not prefixed with the tag.
     * @values message | messageerror | controllerchange
     */
    relayEvents: TokenList,
    // state
    /**
     * @state
     * `navigator.serviceWorker.ready` has resolved — an active worker is
     * controlling the page.
     */
    isReady: Boolean,
    /**
     * @state
     * The Service Worker API is available (`'serviceWorker' in
     * navigator`).
     */
    isSupported: Boolean,
    /**
     * @provision
     * `{ isSupported, isReady, hasController, scope }` — set on connect,
     * when `ready` resolves (`scope` comes from the registration), and on
     * every `controllerchange`. Not reflected as an attribute.
     * @type ServiceWorkerProvision
     */
    provision: Object as unknown as ConstructorType<ServiceWorkerProvision>,
    // private
    swContainer: Object as unknown as typeof ServiceWorkerContainer,
  },
})
  .defineMethods({
    messageCallback: (_, event: MessageEvent) => ({
      emit: [event.type, { detail: event.data }],
    }),
    // Method so it reads the element when `ready` settles, and no-ops if
    // the element has since left the document.
    readyCallback: (
      { isConnected, isSupported, provision },
      registration?: ServiceWorkerRegistration
    ) =>
      isConnected && {
        isReady: true,
        provision: {
          isSupported: !!isSupported,
          isReady: true,
          hasController: hasController(),
          scope: registration?.scope ?? provision?.scope ?? null,
        },
      },
    // Internal `controllerchange` listener, independent of `relay-events`
    _handleControllerChange: ({ isSupported, isReady, provision }) => ({
      provision: {
        isSupported: !!isSupported,
        isReady: !!isReady,
        hasController: hasController(),
        scope: provision?.scope ?? null,
      },
    }),
    /**
     * Apply `relay-events` to `navigator.serviceWorker`: drop the
     * `previous` names (or all three when relaying stops) and add the
     * current set. Also on a real reconnect, since `onDisconnected`
     * removes them.
     */
    // @ts-expect-error - TODO: method typing
    _applyRelay: ({ relayEvents, messageCallback }, previous?: string[]) => {
      if (!navigator.serviceWorker) return;
      previous?.forEach((eventName) =>
        navigator.serviceWorker.removeEventListener(eventName, messageCallback)
      );
      if (!relayEvents) {
        SW_EVENTS.forEach((eventName) =>
          navigator.serviceWorker.removeEventListener(
            eventName,
            messageCallback
          )
        );
      } else {
        // Add the current set. Bare `relay-events` (no value) means all.
        const events = relayEvents?.length > 0 ? relayEvents : SW_EVENTS;
        events.forEach((eventName) =>
          navigator.serviceWorker.addEventListener(eventName, messageCallback)
        );
      }
    },
  })
  .onConnected(
    ({
      readyCallback,
      _handleControllerChange,
      isMoving,
      wasMounted,
      isReady,
      provision,
    }) => {
      if (isMoving) return;
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.ready.then(readyCallback);
        return [
          {
            isSupported: true,
            swContainer: navigator.serviceWorker,
            // Tracked by Neutron: dropped on disconnect, restored on reconnect
            addListener: [
              "controllerchange",
              _handleControllerChange,
              { target: navigator.serviceWorker },
            ],
            provision: {
              isSupported: true,
              isReady: !!isReady,
              hasController: hasController(),
              scope: provision?.scope ?? null,
            },
          },
          /* Relay listeners are plain `navigator.serviceWorker` listeners,
             removed in `onDisconnected`. Re-apply after a real reconnect
             (first mount applies them via `relayEvents`). */
          ...(wasMounted ? [{ _applyRelay: [] }] : []),
        ];
      }
      return {
        provision: {
          isSupported: false,
          isReady: false,
          hasController: false,
          scope: null,
        },
      };
    }
  )
  .onPropChanged("relayEvents", (_, previous) => ({
    _applyRelay: [previous?.relayEvents],
  }))
  .onDisconnected(({ messageCallback, isMoving }) => {
    if (isMoving) return;
    // Drop relay listeners. Neutron removes the tracked `controllerchange`.
    if (navigator.serviceWorker) {
      SW_EVENTS.forEach((eventName) =>
        navigator.serviceWorker.removeEventListener(eventName, messageCallback)
      );
    }
  });
