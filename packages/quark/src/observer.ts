import { CHILD_REMOVED } from "./constants";
import type { QuarkListenerConfig } from "./rule";
import { deref, QuarkLogger } from "./utils";
type CB = (arg: {
  element: HTMLElement;
  attribute: string;
  /** `content` records: the inserted elements. */
  added?: Element[];
}) => any;

/** Attach the sheet's root event listeners (prop changes, binding changes). */
export const listen = (listenerConfig: QuarkListenerConfig) => {
  listenerConfig.forEach(([element, eventName, listener]) => {
    deref(element)?.addEventListener(eventName, listener);
  });
};

const isElement = (node: Node): node is Element =>
  node.nodeType === Node.ELEMENT_NODE;

const classTokens = (value: string | null) =>
  new Set(value ? value.split(/\s+/) : []);

/**
 * True when a token in `names` is in one class value but not the other.
 * Comparing each record's old value with the current one is enough: a
 * net change shows in the batch's first record for that element.
 */
const classNamesFlipped = (
  names: Set<string>,
  before: string | null,
  after: string | null
) => {
  if (before === after) return false;
  const a = classTokens(before);
  const b = classTokens(after);
  for (const token of a) if (!b.has(token) && names.has(token)) return true;
  for (const token of b) if (!a.has(token) && names.has(token)) return true;
  return false;
};

/**
 * Watch the host subtree. Attr records are filtered to names the sheet's
 * rules reference; with `classNames`, a `class` record counts only when
 * one of those tokens was added or removed (styling churn on other
 * classes is dropped here). childList records queue on the *parent*:
 * insertions as `content` with the inserted elements, element-only
 * removals as `CHILD_REMOVED` when `childRemovals` is set (a rule depends
 * on children / sibling position). Text-only records have nothing to
 * match; who changed the nodes does not matter, no render-event contract.
 */
export const observe = (
  host: HTMLElement | WeakRef<HTMLElement>,
  attributeFilter: string[],
  cb: CB,
  {
    childRemovals = false,
    classNames = null,
  }: { childRemovals?: boolean; classNames?: Set<string> | null } = {}
) => {
  const observer = new MutationObserver((mutationRecords: MutationRecord[]) => {
    mutationRecords.forEach((record) => {
      const { type, attributeName, target } = record;
      if (type === "attributes" && attributeName) {
        if (
          classNames &&
          attributeName === "class" &&
          !classNamesFlipped(
            classNames,
            record.oldValue,
            (target as Element).getAttribute("class")
          )
        ) {
          return;
        }
        cb({ element: target as HTMLElement, attribute: attributeName });
      } else if (type === "childList") {
        const added = [...record.addedNodes].filter(isElement);
        if (added.length) {
          cb({ element: target as HTMLElement, attribute: "content", added });
        } else if (childRemovals && [...record.removedNodes].some(isElement)) {
          cb({ element: target as HTMLElement, attribute: CHILD_REMOVED });
        }
      }
    });
  });
  const h = deref(host);
  if (!h) return QuarkLogger.error("Quark: Host not found");
  observer.observe(h, {
    childList: true,
    subtree: true,
    // `attributeFilter` with `attributes: false` is a TypeError
    ...(attributeFilter.length > 0
      ? { attributes: true, attributeFilter, attributeOldValue: !!classNames }
      : { attributes: false }),
    characterData: false,
  });
  return observer;
};

export const unobserve = (
  observer: MutationObserver | null,
  listenerConfig: QuarkListenerConfig
) => {
  listenerConfig.forEach(([element, eventName, listener]) => {
    deref(element)?.removeEventListener(eventName, listener);
  });
  observer?.disconnect?.();
};
