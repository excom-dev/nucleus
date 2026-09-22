import { selectOne } from "@excom/kit-utils";
import { ListenableElement } from "@excom/listenable-element";
import { Neutron } from "@excom/neutron";

/**
 * Click target that opens or closes a `<dialog>` without any JavaScript.
 * Wrap a button (or any clickable content) in `<dialog-anchor>` and point
 * it at a `<dialog>` via `target-ref`, or let it find the nearest ancestor
 * `<dialog>` automatically — the common case for a close button living
 * inside the dialog it closes.
 *
 * By default it listens for `click`; set `listen-for` (from
 * `ListenableElement`) to toggle on another event instead — e.g. auto-close
 * a dialog when a nested `<super-form>` succeeds.
 *
 * @summary Open/close a `<dialog>` — by selector or nearest ancestor.
 *
 * @example
 * <dialog-anchor target-ref="#confirm" is-modal>
 *   <button>Delete</button>
 * </dialog-anchor>
 * <dialog id="confirm">...</dialog>
 */
export const DialogAnchor = Neutron.compose([
  ListenableElement,
  Neutron({
    tag: "dialog-anchor",
    props: {
      /**
       * @option
       * CSS selector for the `<dialog>` to toggle. If omitted, the
       * element toggles the nearest ancestor `<dialog>`.
       * @values <CSS Selector>
       */
      targetRef: String,
      /**
       * @option
       * Open the dialog as a modal (blocks the rest of the page) instead
       * of a non-modal popover.
       */
      isModal: Boolean,
    },
  }),
])
  .defineMethods({
    actionHandler: (element) => {
      let dialog =
        element.targetRef &&
        selectOne(element.targetRef, {
          scope: element,
        });
      if (!(dialog instanceof HTMLDialogElement)) {
        dialog = element.closest("dialog");
      }
      if (dialog instanceof HTMLDialogElement) {
        const isOpen = dialog.open;
        const isModal = element.isModal;
        if (isOpen) {
          dialog.close();
        } else {
          dialog[isModal ? "showModal" : "show"]();
        }
      }
    },
  })
  .onConnected(
    ({ listenFor, listenForLifecycle, handleEvent, isMoving }) =>
      !isMoving &&
      !listenFor?.length &&
      !listenForLifecycle?.length && {
        addListener: ["click", handleEvent],
      }
  );
