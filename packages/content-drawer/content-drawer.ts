import {
  ConstructorType,
  Neutron,
  NeutronElement,
  TEvent,
} from "@excom/neutron";

/**
 * Props the invoker of `--open` / `--toggle` may set through its `data-*`
 * attributes (`data-open-stage="1"` → `openStage`). Keys are whitelisted
 * against declared, non-private props; `isOpen` is always the command's.
 */
export type ContentDrawerCommandData = Partial<{
  openStage: number;
  fromSide: string;
  disappearAfter: number;
  singletonName: string;
}>;

export type ContentDrawerOpenedEvent = TEvent & {
  type: "content-drawer-opened";
  detail: HTMLElement;
};

export type ContentDrawerClosedEvent = TEvent & {
  type: "content-drawer-closed";
  detail: HTMLElement;
};

/**
 * Panel / sheet that slides in from an edge of its positioned parent —
 * bottom sheets, nav drawers, filter panels, toast-style confirmations.
 * Drive it with the `--open` / `--close` / `--toggle` commands (`<button
 * command="--toggle" commandfor="…">`). Pair with a sibling
 * `[role="presentation"]` / `.tag-backdrop` (Valence.css dialog dimmer) and
 * `<event-handler>` / `<dismiss-watcher>` for click / Escape dismissal.
 *
 * @summary Slide-in drawer / sheet — bottom, top, left, or right, with peek stages.
 *
 * @command --open - Opens the drawer (`is-open` set). `data-*` attributes on
 *   the invoker that name a declared prop (`data-open-stage`,
 *   `data-from-side`, …) are applied first; unknown, private and `isOpen`
 *   keys are ignored.
 * @command --close - Closes the drawer (`is-open` unset).
 * @command --toggle - Toggles open / closed. Reads the invoker's `data-*`
 *   like `--open`.
 *
 * @fires content-drawer-opened - After open (`is-open` set), `detail` is the
 *   drawer. When `singleton-name` is set it is also broadcast so drawers
 *   sharing that name close.
 * @type ContentDrawerOpenedEvent
 * @fires content-drawer-closed - After close (`is-open` unset), `detail` is
 *   the drawer.
 * @type ContentDrawerClosedEvent
 */
export const ContentDrawer = Neutron({
  tag: "content-drawer",
  props: {
    /**
     * @option
     * Edge the drawer slides from.
     * @values bottom | top | left | right
     * @default bottom
     */
    fromSide: String,
    /**
     * @option
     * Auto-close after this many seconds once opened — toast-style /
     * transient confirmations.
     */
    disappearAfter: Number,
    /**
     * @option
     * Shared group name. Opening one drawer closes others with the same
     * name (singleton coordination).
     */
    singletonName: String,
    /**
     * @option
     * @state
     * How far the drawer opens: `0` full, `1` half, `2` peek. Unset = full.
     * Set statically, or per open through `data-open-stage` on the
     * `--open` / `--toggle` invoker.
     * @values 0 | 1 | 2
     */
    openStage: {
      type: Number,
      isValid: (value: number) => value >= 0 && value <= 2,
    },
    /**
     * @option
     * @state
     * Open state. Toggle directly, or through the `--open` / `--close` /
     * `--toggle` commands. For Escape / outside-click dismissal pair with
     * `<dismiss-watcher command-name="--close">`.
     */
    isOpen: Boolean,
    // private state
    _timeoutId: Object as unknown as ConstructorType<
      ReturnType<typeof setTimeout>
    >,
  },
})
  .defineMethods({
    _timeoutCallback: () => ({
      isOpen: false,
    }),
    _emitClosed: (element) => ({
      emit: ["content-drawer-closed", { detail: element }],
    }),
    _singletonCallback: (element, { detail }: CustomEvent<typeof element>) => {
      if (
        element !== detail &&
        element.singletonName &&
        detail?.singletonName &&
        element.singletonName === detail.singletonName
      ) {
        return {
          isOpen: false,
        };
      }
    },
  })
  .onConnected(
    ({ singletonName, _singletonCallback }) =>
      // Re-register after a DOM move / reconnect so the drawer still coordinates
      !!singletonName && {
        toggleBroadcastListeners: [
          ["content-drawer-opened", _singletonCallback, true],
        ],
      }
  )
  .onDisconnected(({ isMoving, _timeoutId }) => {
    // A DOM move keeps the disappear timer running
    if (isMoving || !_timeoutId) {
      return;
    }
    clearTimeout(_timeoutId);
    return {
      _timeoutId: null,
    };
  })
  .onPropUnset("isOpen", ({ _timeoutId }) => {
    if (_timeoutId) {
      clearTimeout(_timeoutId);
    }
    return {
      _timeoutId: null,
      _emitClosed: [],
    };
  })
  .onPropSet(
    "isOpen",
    ({ disappearAfter, _timeoutId, _timeoutCallback }) =>
      !!disappearAfter &&
      !_timeoutId && {
        _timeoutId: setTimeout(_timeoutCallback, disappearAfter * 1000),
      }
  )
  .onPropSet("isOpen", (el) => ({
    emit: ["content-drawer-opened", { detail: el }],
    ...(el.singletonName
      ? { broadcast: ["content-drawer-opened", { detail: el }] }
      : {}),
  }))
  .onPropChanged("singletonName", ({ singletonName, _singletonCallback }) => ({
    toggleBroadcastListeners: [
      ["content-drawer-opened", _singletonCallback, !!singletonName],
    ],
  }))
  .onCommand("--close", () => ({
    isOpen: false,
  }))
  .onCommand("--open", (el, { source }) => ({
    ...propsFromSource(el, source),
    isOpen: true,
  }))
  .onCommand("--toggle", (el, { source }) => ({
    ...propsFromSource(el, source),
    isOpen: !el.isOpen,
  }));

/**
 * Props from the invoker's `data-*` attributes (`data-open-stage` →
 * `openStage`), keeping only keys that name a declared, non-`_` prop.
 * Spread the result *before* the command's own writes so an invoker
 * can't force those through its dataset.
 */
export function propsFromSource(
  element: HTMLElement,
  source: Element | null | undefined
): Record<string, unknown> {
  if (!(source instanceof HTMLElement)) {
    return {};
  }
  const config = (element.constructor as typeof NeutronElement).getConfig();
  const declared = new Set(
    Object.values(config?.props ?? {})
      .map((prop) => prop.prop)
      .filter((name) => !name.startsWith("_"))
  );
  return Object.fromEntries(
    Object.entries(source.dataset).filter(([key]) => declared.has(key))
  );
}
