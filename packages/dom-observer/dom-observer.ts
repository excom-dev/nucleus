import { LoopGuard, selectOne } from "@excom/kit-utils";
import { Neutron, TEvent } from "@excom/neutron";

export type DomObserverChangeDetail = {
  target: Element;
  mutations: MutationRecord[];
};

export type DomObserverChangeEvent = TEvent & {
  type: "dom-observer-change";
  detail: DomObserverChangeDetail;
};

/**
 * Resolves a target element via a CSS selector and fires a
 * `dom-observer-change` event whenever that element mutates. Renders
 * nothing of its own — pair it with `<event-handler>` (or Quark) to
 * react to the changes.
 *
 * If `target-ref` does not match anything when the element connects,
 * a document-level `MutationObserver` waits for a matching element to
 * appear and then switches over to observing it.
 *
 * When the target is an `HTMLTemplateElement`, the `<template>` itself
 * is observed (attribute/child mutations on the element), AND so is the
 * template's `.content` `DocumentFragment` — otherwise mutations to the
 * authored template children would be invisible (they don't live as
 * descendants of the `<template>` element in the DOM tree).
 *
 * @fires dom-observer-change - Fires whenever the resolved target mutates,
 *   and once immediately (with `mutations: []`) as soon as the target is
 *   resolved so listeners can seed from current state. `mutations` is
 *   the `MutationRecord[]` from the underlying `MutationObserver`
 *   callback (empty on that first fire).
 * @type DomObserverChangeEvent
 *
 * @example Log every mutation on a specific element
 * <event-handler listen-for="dom-observer-change" target-ref="window">
 *   <dom-observer target-ref="#watched"></dom-observer>
 * </event-handler>
 */
export const DomObserver = Neutron({
  tag: "dom-observer",
  events: {
    change: { prefixWithTag: true },
  },
  props: {
    /**
     * @option
     * CSS selector used to resolve the element to observe. Resolved
     * against `document`. If no element matches at connect time, the
     * element waits for one to appear.
     */
    targetRef: String,
    /**
     * @state
     * The currently observed target element (if any).
     */
    targetElement: HTMLElement,
    /**
     * @state
     * Document-level observer used to wait for a target matching
     * `target-ref` to appear. Disconnected as soon as the target is
     * found.
     */
    targetFindingObserver: MutationObserver,
    /**
     * @state
     * Observer attached to the resolved `targetElement` (and to its
     * `.content` fragment when the target is a `<template>`).
     */
    targetChangeObserver: MutationObserver,
  },
})
  .defineMethods({
    findTargetElement: (element) => {
      // @ts-ignore TODO defineMethods
      const { targetRef, setTargetElement } = element;
      if (!targetRef) return;
      const targetElement = selectOne(targetRef, {
        scope: element,
      });
      if (targetElement) {
        return { targetElement };
      }
      /* Wait for a match. `MutationRecord.target` on a childList mutation
         is the *parent*, not the inserted child, so scan the added nodes
         (and their descendants). */
      const targetFindingObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;
            const match = node.matches(targetRef)
              ? node
              : node.querySelector(targetRef);
            if (match) {
              setTargetElement(match);
              return;
            }
          }
        }
      });
      targetFindingObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
      return { targetFindingObserver };
    },
    setTargetElement: ({ targetFindingObserver }, targetElement) => {
      targetFindingObserver?.disconnect();
      return {
        targetElement,
        targetFindingObserver: null,
      };
    },
    notifyChange: ({ targetElement }, mutations: MutationRecord[] = []) => ({
      emit: ["change", { detail: { target: targetElement, mutations } }],
    }),
  })
  .onPropChanged(
    "targetRef",
    ({ targetRef, targetFindingObserver }, previous) => {
      const shouldDisconnect = previous.targetRef && targetFindingObserver;
      if (shouldDisconnect) {
        targetFindingObserver.disconnect();
      }
      return [
        shouldDisconnect && { targetFindingObserver: null },
        targetRef && { findTargetElement: [] },
      ];
    }
  )
  .onPropChanged(
    "targetElement",
    ({ targetElement, targetChangeObserver, notifyChange }, previous) => {
      if (previous.targetElement && targetChangeObserver) {
        targetChangeObserver.disconnect();
        if (!targetElement) return { targetChangeObserver: null };
      }
      if (targetElement) {
        /* The change event continues the chain that made the mutation
           (a Quark rule writing an attribute, an effect inserting
           children): inherit the loop-guard depth on those addresses. */
        const observer = new MutationObserver((mutations) =>
          LoopGuard.run(
            Math.max(
              0,
              ...mutations.map((m) =>
                LoopGuard.depthOf(m.target, m.attributeName ?? "content")
              )
            ),
            () => notifyChange(mutations)
          )
        );
        const init: MutationObserverInit = {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true,
        };
        observer.observe(targetElement, init);
        /* A `<template>`'s authored content lives on `.content`, not as
           DOM descendants. Observe both so either mutation is one stream. */
        if (targetElement instanceof HTMLTemplateElement) {
          observer.observe(targetElement.content, init);
        }
        return [{ targetChangeObserver: observer }, { notifyChange: [] }];
      }
    }
  )
  .onDisconnected(
    ({ isMoving, targetChangeObserver, targetFindingObserver }) => {
      if (isMoving) return;
      targetChangeObserver?.disconnect();
      targetFindingObserver?.disconnect();
      return {
        targetElement: null,
        targetChangeObserver: null,
        targetFindingObserver: null,
      };
    }
  )
  .onConnected(({ isMoving, wasMounted, findTargetElement }) => {
    if (isMoving || !wasMounted) return;
    findTargetElement();
  });
