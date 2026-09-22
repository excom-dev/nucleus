import { CloseWatcher } from "@excom/kit-shims";
import { selectOne } from "@excom/kit-utils";
import {
  ConstructorType,
  Neutron,
  TEvent,
  TokenList,
} from "@excom/neutron";

export type DismissWatcherReason = "escape" | "outside-click";

export type DismissWatcherDismissEvent = TEvent & {
  type: "dismiss-watcher-dismiss";
  detail: { reason: DismissWatcherReason };
};

const DISMISS_EVENT = "dismiss-watcher-dismiss";
const OUTSIDE_EVENT = "mouseup";

/**
 * Dismissal-request Adapter for drawers, menus, dialogs and popovers. While
 * `is-active` it watches for Escape / the platform back gesture (through a
 * `CloseWatcher`) and for a `mouseup` outside its target, then fires
 * `dismiss-watcher-dismiss`. The default action invokes each `command-name`
 * (`--close`) and dispatches each `fire-event` name at the target;
 * `preventDefault()` keeps the panel open. Renders nothing — drop it inside
 * the element being dismissed, or point `target-ref` at it.
 *
 * @summary Escape / back-gesture and outside-click dismissal for any panel.
 *
 * @fires dismiss-watcher-dismiss - A dismissal was requested; `detail.reason`
 *   is `"escape"` or `"outside-click"`. Default action: invoke each
 *   `command-name` on the target and dispatch each `fire-event` name at it
 *   as a bubbling `CustomEvent`. `preventDefault()` skips both.
 * @type DismissWatcherDismissEvent
 */
export const DismissWatcher = Neutron({
  tag: "dismiss-watcher",
  props: {
    /**
     * @option
     * @state
     * Watchers are live while set. Gate it from Quark on the panel's open
     * state, and write the inverse rule.
     */
    isActive: Boolean,
    /**
     * @option
     * Watch Escape / the back gesture through a `CloseWatcher`. When neither
     * `watch-*` attribute is present both watchers are on.
     */
    watchEscape: Boolean,
    /**
     * @option
     * Watch for a `mouseup` on the document outside the target. When neither
     * `watch-*` attribute is present both watchers are on.
     */
    watchOutsideClick: Boolean,
    /**
     * @option
     * Selector for the element being dismissed, `:scope`-relative
     * (`:scope ~ nav`). Unset = the parent element.
     */
    targetRef: String,
    /**
     * @option
     * Commands invoked on the target as the default action of
     * `dismiss-watcher-dismiss` — `--close` for a `<content-drawer>`, or any
     * `--verb` the panel handles.
     * @values <command>…
     */
    commandName: TokenList,
    /**
     * @option
     * Event names dispatched at the target (bubbling `CustomEvent`s) as the
     * default action of `dismiss-watcher-dismiss`, for panels driven by
     * events rather than commands (`menu-close`).
     */
    fireEvent: TokenList,
    // private state
    _closeWatcher: Object as unknown as ConstructorType<CloseWatcher>,
  },
})
  .defineMethods({
    _handleOutsideMouseup: (element, e: MouseEvent) => {
      const target = resolveTarget(element);
      if (!target || !(e.target instanceof Node) || target.contains(e.target)) {
        return;
      }
      return {
        emit: [DISMISS_EVENT, { detail: { reason: "outside-click" } }],
      };
    },
    _handleClose: () => [
      /* CloseWatcher deactivates after `close`: drop it and re-arm before
         emitting, so a cancelled dismissal (`preventDefault()`) keeps Escape. */
      { _closeWatcher: null },
      { _apply: [] },
      { emit: [DISMISS_EVENT, { detail: { reason: "escape" } }] },
    ],
  })
  // Second `defineMethods` so the handlers above are typed on the element
  .defineMethods({
    _apply: ({
      watchEscape,
      watchOutsideClick,
      _closeWatcher,
      _handleClose,
      _handleOutsideMouseup,
    }) => {
      // Neither `watch-*` set → both
      const wantsEscape = !!watchEscape || !watchOutsideClick;
      const wantsOutsideClick = !!watchOutsideClick || !watchEscape;
      return [
        wantsOutsideClick
          ? {
              addListener: [
                OUTSIDE_EVENT,
                _handleOutsideMouseup,
                { target: document },
              ],
            }
          : {
              removeListener: [
                OUTSIDE_EVENT,
                _handleOutsideMouseup,
                { target: document },
              ],
            },
        wantsEscape
          ? !_closeWatcher && {
              _closeWatcher: createCloseWatcher(_handleClose),
            }
          : !!_closeWatcher && {
              _closeWatcher: destroyCloseWatcher(_closeWatcher, _handleClose),
            },
      ].filter(Boolean);
    },
    _teardown: ({ _closeWatcher, _handleClose, _handleOutsideMouseup }) =>
      [
        {
          removeListener: [
            OUTSIDE_EVENT,
            _handleOutsideMouseup,
            { target: document },
          ],
        },
        !!_closeWatcher && {
          _closeWatcher: destroyCloseWatcher(_closeWatcher, _handleClose),
        },
      ].filter(Boolean),
  })
  .onPropSet("isActive", () => ({ _apply: [] }))
  .onPropUnset("isActive", () => ({ _teardown: [] }))
  .onPropChanged(
    ["watchEscape", "watchOutsideClick", "targetRef"],
    ({ isActive }) => !!isActive && { _apply: [] }
  )
  .onConnected(
    ({ wasMounted, isActive, isMoving }) =>
      // Real reconnect rebuilds; first mount is the prop flush
      wasMounted && !!isActive && !isMoving && { _apply: [] }
  )
  .onDisconnected(
    ({ isMoving }) =>
      // Neutron restores tracked listeners on a move; keep the watcher too
      !isMoving && { _teardown: [] }
  )
  .onEventDefault(DISMISS_EVENT, (element) => {
    const target = resolveTarget(element);
    const commands = element.commandName || [];
    const names = element.fireEvent || [];
    return (
      !!target && [
        commands.length > 0 && {
          commands: commands.map((name) => [name, { target }]),
        },
        names.length > 0 && {
          emits: names.map((type) => [type, { target }]),
        },
      ]
    );
  });

/** `target-ref`, `:scope`-relative to the watcher; default = parent. */
function resolveTarget(
  element: HTMLElement & { targetRef?: string | null }
): HTMLElement | null {
  return element.targetRef
    ? selectOne(element.targetRef, { scope: element })
    : element.parentElement;
}

function createCloseWatcher(onClose: EventListener) {
  const watcher = new CloseWatcher();
  watcher.addEventListener("close", onClose);
  return watcher;
}

function destroyCloseWatcher(
  watcher: CloseWatcher | null | undefined,
  onClose: EventListener
) {
  if (watcher) {
    watcher.removeEventListener("close", onClose);
    watcher.destroy();
  }
  return null;
}
