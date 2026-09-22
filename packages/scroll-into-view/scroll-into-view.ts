import { scrollElementIntoView } from "@excom/kit-scroller";
import { selectOne } from "@excom/kit-utils";
import { isNumber } from "@excom/kit-utils";
import { ListenableElement } from "@excom/listenable-element";
import { Neutron, TokenList } from "@excom/neutron";

/**
 * Scrolls an element into view, based on configuration. By default it
 * scrolls itself into view as soon as it connects to the DOM; combine with
 * the inherited `listen-for` attribute to scroll on clicks, custom events,
 * or lifecycles instead.
 *
 * @summary Scroll an element into view — on connect, click, or any event.
 *
 * @example
 * <!-- Jump to a section on click -->
 * <scroll-into-view target-ref="#pricing" listen-for="click">
 *   See pricing
 * </scroll-into-view>
 */
export const ScrollIntoView = Neutron.compose([
  ListenableElement,
  Neutron({
    tag: "scroll-into-view",
    props: {
      /**
       * @option
       * CSS selector of the element to scroll to. Unset scrolls this
       * element itself.
       * @values <CSS Selector>
       */
      targetRef: String,
      /**
       * @option
       * Two tokens `<inline> <block>` (x and y, respectively) controlling
       * how the target aligns inside the scrollport. Each token is
       * `start`, `center`, `end`, `nearest`, or `none` (skip alignment on
       * that axis).
       * @default nearest start
       * @values start | center | end | nearest | none
       */
      scrollAlign: {
        type: TokenList,
        isValid: (value: string) =>
          ["start", "center", "end", "nearest", "none"].includes(value),
        defaultValue: () => ["nearest", "start"],
      },
      /**
       * @option
       * Two pixel offsets `<x> <y>` applied after alignment — e.g. leave
       * room for a sticky header by using a negative `<y>`.
       * @default 0 0
       * @values <px> <px>
       */
      scrollOffset: { type: TokenList, defaultValue: () => ["0", "0"] },
      /**
       * @option
       * Scroll animation.
       * @default auto
       * @values auto | smooth | instant
       */
      scrollBehavior: { type: String, defaultValue: () => "auto" },
      /**
       * @option
       * Only scroll if the target isn't already fully visible.
       */
      ifNeeded: Boolean,
    },
  }),
])
  .defineMethods({
    actionHandler: (element) => {
      const target = (
        element.targetRef
          ? selectOne(element.targetRef, {
              scope: element,
            })
          : element
      ) as HTMLElement;
      requestAnimationFrame(() => {
        // wait until after next paint to scroll
        setTimeout(() => {
          const scrollInline = element.scrollAlign[0] || "nearest";
          const scrollBlock = element.scrollAlign[1] || "start";
          const offsetX = Number(element.scrollOffset[0]);
          const offsetY = Number(element.scrollOffset[1]);
          scrollElementIntoView(target, {
            block:
              scrollBlock && scrollBlock !== "none"
                ? (scrollBlock as ScrollLogicalPosition)
                : undefined,
            inline:
              scrollInline && scrollInline !== "none"
                ? (scrollInline as ScrollLogicalPosition)
                : undefined,
            offsetInline: isNumber(offsetX) ? offsetX : undefined,
            offsetBlock: isNumber(offsetY) ? offsetY : undefined,
            behavior: element.scrollBehavior as ScrollBehavior,
            onlyIfNeeded: element.ifNeeded,
          });
        }, 0);
      });
    },
  })
  .onConnected(
    ({ listenFor, listenForLifecycle, isMoving }) =>
      !isMoving &&
      !listenFor?.length &&
      !listenForLifecycle?.length && {
        handleEvent: ["connected"],
      }
  );
