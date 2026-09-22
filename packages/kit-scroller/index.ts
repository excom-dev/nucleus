// TODO replace with a battle-tested library; most of this was vibecoded

type Axis = "y" | "x";
type ScrollBehaviorOption = "auto" | "smooth" | "instant";
type Align = "start" | "center" | "end" | "nearest";

interface ScrollAdvancedOptions {
  behavior?: ScrollBehaviorOption; // default: 'smooth'
  block?: Align; // default: 'start'
  inline?: Align; // default: 'nearest'
  offsetBlock?: number; // default: 0 (applies along Y axis)
  offsetInline?: number; // default: 0 (applies along X axis)
  onlyIfNeeded?: boolean; // default true: skip if already fully visible
  padInView?: number; // default 0: extra slack when testing visibility
}

type ScrollContainer = Element | Document;

function isViewportContainer(c: ScrollContainer | null): c is Document {
  return !c || c === document || c === document.scrollingElement;
}

function getAxisProps(axis: Axis) {
  return axis === "y"
    ? {
        overflowProp: "overflowY" as const,
        scrollSize: "scrollHeight" as const,
        clientSize: "clientHeight" as const,
        scrollPos: "scrollTop" as const,
      }
    : {
        overflowProp: "overflowX" as const,
        scrollSize: "scrollWidth" as const,
        clientSize: "clientWidth" as const,
        scrollPos: "scrollLeft" as const,
      };
}

/** Nearest scrollable ancestor on this axis (walks through shadow roots). */
export function getNearestScrollableContainer(
  node: Node,
  axis: Axis = "y"
): Element | Document | null {
  const props = getAxisProps(axis);

  const isScrollableElement = (el: Element) => {
    const cs = getComputedStyle(el);
    const val = cs[props.overflowProp];
    if (!/(auto|scroll|overlay)/.test(val)) return false;
    const canScroll =
      (el as any)[props.scrollSize] > (el as any)[props.clientSize];
    // Still a candidate when overflow isn't `visible`, even if not overflowing now
    return canScroll && !["hidden", "visible"].includes(val);
  };

  let cur: Node | null = node;

  while (cur) {
    if (cur instanceof Element) {
      // `position: fixed` descendants scroll with the viewport
      const cs = getComputedStyle(cur);
      if (cs.position === "fixed") break;

      if (isScrollableElement(cur)) return cur;
    }

    if (cur.parentNode) {
      cur = cur.parentNode;
      continue;
    }

    // Hop out of shadow root to host
    const root = (cur as any).getRootNode?.();
    if (root && (root as ShadowRoot).host) {
      cur = (root as ShadowRoot).host;
      continue;
    }

    break;
  }

  return document.scrollingElement ? document : document; // Viewport is always `Document`
}

/** Fully visible on this axis inside the container (or viewport)? */
function isFullyInViewOnAxis(
  container: ScrollContainer | null,
  el: Element,
  axis: Axis,
  pad = 0
): boolean {
  const r = el.getBoundingClientRect();

  if (isViewportContainer(container)) {
    if (axis === "y")
      return r.top >= pad && r.bottom <= window.innerHeight - pad;
    else return r.left >= pad && r.right <= window.innerWidth - pad;
  }

  const cRect = (container as Element).getBoundingClientRect();
  if (axis === "y") {
    const top = cRect.top + pad;
    const bottom = cRect.bottom - pad;
    return r.top >= top && r.bottom <= bottom;
  } else {
    const left = cRect.left + pad;
    const right = cRect.right - pad;
    return r.left >= left && r.right <= right;
  }
}

/** Target scroll position for one axis, given alignment and offset. */
function computeTargetForAxis(params: {
  container: ScrollContainer | null;
  el: Element;
  axis: Axis;
  align: Align; // 'start' | 'center' | 'end' | 'nearest'
  offset: number; // additional px offset along that axis
  padInView: number; // visibility pad used for 'onlyIfNeeded' and 'nearest'
}) {
  const { container, el, axis, align, offset, padInView } = params;
  const props = getAxisProps(axis);
  const elRect = el.getBoundingClientRect();

  // Current scroll position and sizes
  if (isViewportContainer(container)) {
    const current = axis === "y" ? window.scrollY : window.scrollX;
    const vpSize = axis === "y" ? window.innerHeight : window.innerWidth;

    // Positions relative to the viewport origin
    const startPos = current + (axis === "y" ? elRect.top : elRect.left);
    const endPos = current + (axis === "y" ? elRect.bottom : elRect.right);
    const elSize = axis === "y" ? elRect.height : elRect.width;
    const centerEl = startPos + elSize / 2;
    const vpStart = current;
    const vpEnd = current + vpSize;
    // const centerVp = vpStart + vpSize / 2;

    let target: number;

    switch (align) {
      case "start":
        target = startPos + offset;
        break;
      case "end":
        target = endPos - vpSize + offset;
        break;
      case "center":
        target = centerEl - vpSize / 2 + offset;
        break;
      case "nearest": {
        // Already fully visible (with pad): keep current
        const fully = isFullyInViewOnAxis(document, el, axis, padInView);
        if (fully) return { needed: false, target: current };
        // Smaller move to bring into view (start vs end)
        const toStart = startPos - (vpStart + padInView);
        const toEnd = endPos - (vpEnd - padInView);
        // Extends past both edges: pick the larger magnitude
        if (toStart < 0 && toEnd > 0) {
          // Larger than the viewport: prefer start unless end is closer
          target =
            Math.abs(toStart) < Math.abs(toEnd)
              ? current + toStart + offset
              : current + toEnd + offset;
        } else if (toStart < 0) {
          target = current + toStart + offset; // up / left
        } else {
          target = current + toEnd + offset; // down / right
        }
        break;
      }
      default:
        target = startPos + offset;
    }

    return { needed: true, target };
  }

  // Element container
  const c = container as Element;
  const cRect = c.getBoundingClientRect();
  const current = (c as any)[props.scrollPos] as number;
  const cSize = (c as any)[props.clientSize] as number;

  const elStart =
    (axis === "y" ? elRect.top : elRect.left) -
    (axis === "y" ? cRect.top : cRect.left) +
    current;
  const elEnd = elStart + (axis === "y" ? elRect.height : elRect.width);
  const cStart = current;
  const cEnd = current + cSize;
  const elCenter = (elStart + elEnd) / 2;
  // const cCenter = (cStart + cEnd) / 2;

  let target: number;

  switch (align) {
    case "start":
      target = elStart + offset;
      break;
    case "end":
      target = elEnd - cSize + offset;
      break;
    case "center":
      target = elCenter - cSize / 2 + offset;
      break;
    case "nearest": {
      const fully = isFullyInViewOnAxis(c, el, axis, padInView);
      if (fully) return { needed: false, target: current };
      const toStart = elStart - (cStart + padInView);
      const toEnd = elEnd - (cEnd - padInView);
      if (toStart < 0 && toEnd > 0) {
        target =
          Math.abs(toStart) < Math.abs(toEnd)
            ? current + toStart + offset
            : current + toEnd + offset;
      } else if (toStart < 0) {
        target = current + toStart + offset;
      } else {
        target = current + toEnd + offset;
      }
      break;
    }
    default:
      target = elStart + offset;
  }

  return { needed: true, target };
}

/**
 * Scroll an element into view. Picks the nearest scrollable ancestor
 * per axis, can do Y, X, or both, and honors start / center / end /
 * nearest like native `scrollIntoView`.
 */
export function scrollElementIntoView(
  el: Element,
  {
    behavior = "smooth",
    block,
    inline,
    offsetBlock = 0,
    offsetInline = 0,
    onlyIfNeeded = true,
    padInView = 0,
  }: ScrollAdvancedOptions = {}
): { y?: ScrollContainer; x?: ScrollContainer } {
  if (!el || !el.getBoundingClientRect) return {};

  const result: { y?: ScrollContainer; x?: ScrollContainer } = {};
  const axes = [inline && "x", block && "y"];

  if (el.checkVisibility() === false) {
    // No box to scroll to (`display: none` or `display: contents`).
    throw new Error(
      "scrollElementIntoView: element.checkVisibility() failed. Cannot scroll element into view."
    );
  }
  // Y axis
  if (axes.includes("y")) {
    const cy = getNearestScrollableContainer(el, "y");
    const fullyY = onlyIfNeeded
      ? isFullyInViewOnAxis(
          cy,
          el,
          "y",
          Math.max(padInView, Math.abs(offsetBlock))
        )
      : false;

    if (!(onlyIfNeeded && fullyY)) {
      const { needed, target } = computeTargetForAxis({
        container: cy,
        el,
        axis: "y",
        align: block ?? "start",
        offset: offsetBlock,
        padInView,
      });

      if (!onlyIfNeeded || needed) {
        if (isViewportContainer(cy)) {
          window.scrollTo({ top: Math.round(target), behavior });
        } else {
          (cy as Element).scrollTo({ top: Math.round(target), behavior });
        }
        result.y = cy || document;
      }
    } else {
      result.y = cy || document;
    }
  }

  // X axis
  if (axes.includes("x")) {
    const cx = getNearestScrollableContainer(el, "x");
    const fullyX = onlyIfNeeded
      ? isFullyInViewOnAxis(
          cx,
          el,
          "x",
          Math.max(padInView, Math.abs(offsetInline))
        )
      : false;

    if (!(onlyIfNeeded && fullyX)) {
      const { needed, target } = computeTargetForAxis({
        container: cx,
        el,
        axis: "x",
        align: inline ?? "nearest",
        offset: offsetInline,
        padInView,
      });

      if (!onlyIfNeeded || needed) {
        if (isViewportContainer(cx)) {
          window.scrollTo({ left: Math.round(target), behavior });
        } else {
          (cx as Element).scrollTo({ left: Math.round(target), behavior });
        }
        result.x = cx || document;
      }
    } else {
      result.x = cx || document;
    }
  }

  return result;
}
