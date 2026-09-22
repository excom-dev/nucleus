import { selectAll, selectOne } from "@excom/kit-utils";
import {
  ConstructorType,
  Neutron,
  TEvent,
  TokenList,
} from "@excom/neutron";

export type GestureType =
  | "pan"
  | "pan-x"
  | "pan-y"
  | "pinch"
  | "rotate"
  | "swipe"
  | "tap"
  | "double-tap"
  | "long-press";

export type GestureDirection = "left" | "right" | "up" | "down";

/**
 * One gesture frame, written every frame as `--gesture-<kebab key>` on the
 * element (`dx` → `--gesture-dx`). Everything derivable from these
 * (`--gesture-distance`, `-angle`, `-progress-px`, `-x-ratio`, `-y-ratio`)
 * is a CSS declaration, not a JS write.
 */
export interface GestureHandlerValues {
  /** Pointer centroid vs element box (px) */
  x: number;
  y: number;
  /** Travel since start (px) */
  dx: number;
  dy: number;
  /** Velocity (px/ms) last ~100 ms */
  vx: number;
  vy: number;
  /** Along `progress-axis`: fraction of range (`progress-min`..`progress-max`) */
  progress: number;
  /** Pinch ratio (`1` = unchanged) + rotation (deg) */
  scale: number;
  rotate: number;
  pointers: number;
}

/** `provision` and `-start` / `-move` / `-end` / `-cancel` detail. */
export interface GestureHandlerProvision extends GestureHandlerValues {
  type: GestureType | null;
  /** Pointer type that opened the gesture — `touch` / `pen` / `mouse` */
  pointerType: string;
  /** Travel length (px) — what `threshold-px` is measured against */
  distance: number;
  /** Measured range along `progress-axis` (px), constant per gesture */
  rangePx: number;
  durationMs: number;
  /** `snap-points` target (`-end` only) */
  snap: number | null;
  /** Swipe direction (`-end` only) */
  swipe: GestureDirection | null;
}

/**
 * Each event's `type` / `detail`, spelled out rather than through one
 * generic: the manifest analyzer expands aliases textually, and a generic
 * would leave `GestureHandlerEvent<…>` in the docs instead of the shape.
 */
export type GestureHandlerStartEvent = TEvent & {
  type: "gesture-handler-start";
  detail: GestureHandlerProvision;
};
export type GestureHandlerMoveEvent = TEvent & {
  type: "gesture-handler-move";
  detail: GestureHandlerProvision;
};
export type GestureHandlerEndEvent = TEvent & {
  type: "gesture-handler-end";
  detail: GestureHandlerProvision;
};
export type GestureHandlerCancelEvent = TEvent & {
  type: "gesture-handler-cancel";
  detail: GestureHandlerProvision;
};
export type GestureHandlerSwipeEvent = TEvent & {
  type: "gesture-handler-swipe" | `gesture-handler-swipe-${GestureDirection}`;
  detail: { direction: GestureDirection; velocity: number };
};
export type GestureHandlerPointEvent = TEvent & {
  type:
    | "gesture-handler-tap"
    | "gesture-handler-double-tap"
    | "gesture-handler-long-press";
  detail: { x: number; y: number };
};
export type GestureHandlerSnapEvent = TEvent & {
  type: "gesture-handler-snap";
  detail: { value: number; index: number };
};

type Vec = [number, number];
type Pointer = { x: number; y: number };

/** Private state of one gesture, pointerdown → release. */
interface Session {
  pointerType: string;
  pointers: Map<number, Pointer>;
  rect: DOMRect;
  t0: number;
  /** Centroid travel across pointer-count changes */
  acc: Vec;
  /** Centroid at last pointer-count change */
  base: Vec;
  baseDist: number;
  baseAngle: number;
  scaleBase: number;
  rotateBase: number;
  /** `[t, x, y]` centroid samples in velocity window */
  samples: [number, number, number][];
  /** Travel length of the last frame — the `threshold-px` measure */
  distance: number;
  moved: boolean;
  armed: boolean;
  rejected: boolean;
  /** Pointer ids captured since recognition */
  captured: Set<number>;
  longPressed: boolean;
  type: GestureType | null;
  axis: Vec;
  rangePx: number;
  offsetPx: number;
  values: GestureHandlerValues;
}

/** Pointerdown inside a `handoff-ref` container, held until first move decides scroll vs handoff. */
interface Handoff {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  container: Element;
}

type Handle = ReturnType<typeof setTimeout>;

/** Release (`"end"`) or abort (`"cancel"`) — a `_flush` that also tears down. */
type Phase = "end" | "cancel";

/**
 * Methods as the element exposes them (bound, element argument stripped).
 * Declared up front through `withTypes` so one `defineMethods` can define
 * them all and each can reach its siblings through `element`.
 */
interface Methods {
  _handleHold: () => void;
  _flush: (phase?: Phase) => void;
  _emitSnap: (detail: GestureHandlerSnapEvent["detail"]) => void;
  _handleMove: (e: PointerEvent) => void;
  _handleUp: (e: PointerEvent) => void;
  _handleHandoff: EventListener;
}

/**
 * Every event the element emits, by short name — the config prefixes each
 * with the tag for `emit`, `emits`, `onEventDefault` and `addListener` alike.
 */
const EVENTS = Object.fromEntries(
  [
    "start",
    "move",
    "end",
    "cancel",
    "swipe",
    "swipe-left",
    "swipe-right",
    "swipe-up",
    "swipe-down",
    "tap",
    "double-tap",
    "long-press",
    "snap",
  ].map((name) => [name, { prefixWithTag: true }])
);
const AXES: Record<GestureDirection, Vec> = {
  right: [1, 0],
  left: [-1, 0],
  down: [0, 1],
  up: [0, -1],
};
const OPPOSITE: Record<GestureDirection, GestureDirection> = {
  right: "left",
  left: "right",
  down: "up",
  up: "down",
};
const PAN_TYPES = ["pan", "pan-x", "pan-y"];
const MULTI_TYPES: GestureType[] = ["pinch", "rotate"];
const VELOCITY_WINDOW_MS = 100;
/** Travel (px) before a `handoff-ref` move is judged */
const HANDOFF_MIN_PX = 3;
/** Slack (px) still counted as at scroll limit */
const LIMIT_EPSILON = 1;
/** Extra travel time (ms) when projecting snap target */
const PROJECTION_MS = 120;
const WINDOW_EVENTS = ["pointermove", "pointerup", "pointercancel"];
/**
 * The window listeners one session lives on: `addListener` while it is open,
 * the same arguments as `removeListener` when it ends.
 */
const windowListeners = (
  { _handleMove, _handleUp }: El,
  effect: "addListener" | "removeListener"
) =>
  WINDOW_EVENTS.map((name) => ({
    [effect]: [
      name,
      name === "pointermove" ? _handleMove : _handleUp,
      { target: window },
    ],
  }));
/** On the element while `handoff-ref` is set */
const HANDOFF_EVENTS = [
  "touchmove",
  "pointermove",
  "pointerup",
  "pointercancel",
];

/** Number → CSS value; `digits` is what a frame is worth reading. */
const unit =
  (suffix: string, digits = 2) =>
  (v: number) =>
    `${round(v, digits)}${suffix}`;
const px = unit("px");
const deg = unit("deg");
const num = unit("", 4);

/** Formatter per frame value (`--gesture-<kebab key>`), written every frame. */
const VAR_FORMAT: Record<keyof GestureHandlerValues, (v: number) => string> = {
  x: px,
  y: px,
  dx: px,
  dy: px,
  vx: num,
  vy: num,
  progress: num,
  scale: num,
  rotate: deg,
  pointers: num,
};
/** Constant for the whole gesture: written once, when the session begins. */
const SESSION_FORMAT = { rangePx: px, width: px, height: px };
type SessionValues = Record<keyof typeof SESSION_FORMAT, number>;

/**
 * Pointer gestures as tag-prefixed events; each frame as `--gesture-*` on
 * the element so CSS descendants follow via `var()` — no per-frame script.
 * Wrap the touched surface. Scope starts with `from-ref` (handle),
 * `from-edge` (edge swipe), `handoff-ref` (scroll container hands over at
 * its limit).
 *
 * @summary Swipe / pan / pinch / tap recognition as events + CSS variables.
 *
 * @example
 * <gesture-handler gesture-types="pan-y swipe" progress-axis="up" range-ref=":scope > content-drawer" snap-points="0 1">
 *   <quark-sheet>
 *     @on gesture-handler-start { content-drawer { is-scrubbing: ""; } }
 *     @on gesture-handler-end { content-drawer { is-open: event.detail.snap == 1; is-scrubbing: none; } }
 *   </quark-sheet>
 *   <content-drawer>…</content-drawer>
 * </gesture-handler>
 *
 * @fires gesture-handler-start - Gesture recognized: pan passed `threshold-px`
 *   (after `arm-after` if set), or a second finger for `pinch` / `rotate`.
 *   After `gesture-type` + `provision` set. `detail` = provision. Not
 *   cancelable — gate with `is-disabled`.
 * @type GestureHandlerStartEvent
 * @fires gesture-handler-move - Once per frame while a recognized gesture
 *   moves, only with `should-emit-move`. `detail` = provision. `--gesture-*`
 *   always updates, event or not.
 * @type GestureHandlerMoveEvent
 * @fires gesture-handler-end - Last pointer up after a recognized gesture.
 *   After `is-active` unset, `last-gesture` + `provision` set, and after
 *   `gesture-handler-swipe` if one was recognized. `detail.snap` =
 *   `snap-points` target from position / velocity / swipe (`null` without
 *   `snap-points`); `detail.swipe` = swipe direction. Default action: write
 *   `--gesture-progress` = `detail.snap`, which settles with a CSS
 *   transition (`--gesture-snap-duration` / `--gesture-snap-ease`), then
 *   `gesture-handler-snap`. `preventDefault()` leaves values where the
 *   finger left them. Persist until next gesture.
 * @type GestureHandlerEndEvent
 * @fires gesture-handler-snap - The settle transition reached the snap
 *   point (at once when there is nothing to animate; never when a new
 *   gesture interrupts it). `detail` = `{ value, index }` into
 *   `snap-points`. Commit here when consumer CSS follows
 *   `--gesture-progress` until the end.
 * @type GestureHandlerSnapEvent
 * @fires gesture-handler-cancel - Recognized gesture cut short: browser
 *   took pointer (`pointercancel`, usually native scroll), `is-disabled`
 *   set, or element left the document. `detail` = provision. No `-end`, no
 *   glide.
 * @type GestureHandlerCancelEvent
 * @fires gesture-handler-swipe - On release, velocity along dominant axis
 *   ≥ `swipe-min-velocity` and direction allowed by `swipe-directions`.
 *   `detail` = `{ direction, velocity }` (px/ms). Direction twin fires next
 *   (`gesture-handler-swipe-left` / `-right` / `-up` / `-down`).
 * @type GestureHandlerSwipeEvent
 * @fires gesture-handler-tap - Down and up without moving past
 *   `threshold-px`, within `long-press-ms`. `detail` = `{ x, y }` relative
 *   to the element.
 * @type GestureHandlerPointEvent
 * @fires gesture-handler-double-tap - Second tap within `double-tap-ms` of
 *   the previous (after its `gesture-handler-tap`). `detail` = `{ x, y }`.
 *   Pair consumed; a third tap starts over.
 * @type GestureHandlerPointEvent
 * @fires gesture-handler-long-press - Pointer stayed down without moving
 *   for `long-press-ms`. `detail` = `{ x, y }`.
 * @type GestureHandlerPointEvent
 */
export const GestureHandler = Neutron({
  tag: "gesture-handler",
  events: EVENTS,
  props: {
    // options
    /**
     * @option
     * Gestures to recognize. `pan-x` / `pan-y` one axis (other stays native
     * scroll); `pan` both; `pinch` / `rotate` need two fingers; `swipe`
     * velocity on release; `tap` / `double-tap` / `long-press` fire events.
     * @values pan | pan-x | pan-y | pinch | rotate | swipe | tap | double-tap | long-press
     * @default pan
     */
    gestureTypes: {
      type: TokenList,
      defaultValue: () => ["pan"] as string[],
    },
    /**
     * @option
     * Only start when pointerdown is inside this descendant (`:scope`-relative
     * selector) — a drag handle, the sheet itself. Combined with `from-edge`,
     * either qualifies.
     * @values <CSS Selector>
     */
    fromRef: String,
    /**
     * @option
     * Only start within `edge-px` of these edges — edge swipes (back nav,
     * pulling a closed sheet up).
     * @values left | right | top | bottom
     */
    fromEdge: TokenList,
    /**
     * @option
     * Width of `from-edge` start zone (px).
     * @default 40
     */
    edgePx: { type: Number, defaultValue: () => 40 },
    /**
     * @option
     * Scroll containers that hand overscroll to the gesture (`:scope`-relative
     * selector, comma list matches several) — e.g. a sheet closed by pulling
     * its own content down.
     *
     * Pointerdown inside one scrolls natively; gesture takes over only when
     * first move runs along `progress-axis`, container is at that scroll
     * limit, and `progress-offset` still has room that way. Additive to
     * `from-ref` / `from-edge`.
     * @values <CSS Selector>
     */
    handoffRef: String,
    /**
     * @option
     * Pointer types that can start a gesture. Add `mouse` for desktop drag.
     * @values touch | pen | mouse
     * @default touch pen
     */
    pointerTypes: {
      type: TokenList,
      defaultValue: () => ["touch", "pen"] as string[],
    },
    /**
     * @option
     * Extra pointers beyond this many are ignored. Unset = `2` when `pinch`
     * / `rotate` listed, else `1`.
     */
    maxPointers: Number,
    /**
     * @option
     * Movement (px) before a pan is recognized. Taps / native scroll stay
     * untouched below it.
     * @default 8
     */
    thresholdPx: { type: Number, defaultValue: () => 8 },
    /**
     * @option
     * A free `pan` locks to its dominant axis once recognized (`gesture-type`
     * becomes `pan-x` / `pan-y`).
     */
    lockAxis: Boolean,
    /**
     * @option
     * Pans only arm after this gesture — `long-press` for hold-then-drag.
     * @values long-press
     */
    armAfter: String,
    /**
     * @option
     * Hold time (ms) for `long-press`; also tap time limit.
     * @default 500
     */
    longPressMs: { type: Number, defaultValue: () => 500 },
    /**
     * @option
     * Max gap (ms) between taps for `double-tap`.
     * @default 300
     */
    doubleTapMs: { type: Number, defaultValue: () => 300 },
    /**
     * @option
     * Release velocity (px/ms) that counts as a swipe.
     * @default 0.5
     */
    swipeMinVelocity: { type: Number, defaultValue: () => 0.5 },
    /**
     * @option
     * Swipe directions to report. Unset = all four.
     * @values left | right | up | down
     */
    swipeDirections: TokenList,
    /**
     * @option
     * Direction `--gesture-progress` grows. Unset = `down` for a `pan-y`-only
     * element, else `right`.
     * @values up | down | left | right
     */
    progressAxis: String,
    /**
     * @option
     * Element whose size along `progress-axis` is the range of `progress`
     * `0`..`1` (`:scope`-relative, read once per gesture) — sheet being
     * dragged, slide being swiped.
     * @values <CSS Selector>
     */
    rangeRef: String,
    /**
     * @option
     * Literal range (px) instead of `range-ref`.
     */
    rangePx: Number,
    /**
     * @option
     * Lower bound of `progress`.
     * @default 0
     */
    progressMin: { type: Number, defaultValue: () => 0 },
    /**
     * @option
     * Upper bound of `progress`.
     * @default 1
     */
    progressMax: { type: Number, defaultValue: () => 1 },
    /**
     * @option
     * Progress the gesture starts from. Set from a rule that reads the driven
     * element's state (`1` while a sheet is open) so dragging it closed
     * starts full.
     * @default 0
     */
    progressOffset: { type: Number, defaultValue: () => 0 },
    /**
     * @option
     * Rubber-band past `progress-min` / `progress-max`: `0` clamps, `0.3`
     * overshoots at a third of travel.
     * @default 0
     */
    overshootResistance: { type: Number, defaultValue: () => 0 },
    /**
     * @option
     * Progress values to settle on after release (`0 0.5 1`). Target picked
     * from position, fling velocity and swipe direction, reported as
     * `detail.snap` on `-end`, settled on by the default action (a CSS
     * transition, `--gesture-snap-duration` / `--gesture-snap-ease`).
     * @values <number>…
     */
    snapPoints: TokenList,
    /**
     * @option
     * Fire `gesture-handler-move` every frame. Off by default; `--gesture-*`
     * is enough for CSS.
     */
    shouldEmitMove: Boolean,
    /**
     * @option
     * @state
     * Ignore new pointers; a gesture in progress is cancelled. State-driven
     * veto.
     */
    isDisabled: Boolean,
    // state
    /**
     * @state
     * A pointer is down on the surface. Set from first pointer until release,
     * so it also covers taps and pre-threshold phase.
     */
    isActive: Boolean,
    /**
     * @state
     * Recognized gesture in progress, unset before recognition and after
     * release.
     * @values pan | pan-x | pan-y | pinch | rotate
     */
    gestureType: String,
    /**
     * @state
     * Pointers currently down.
     */
    pointerCount: Number,
    /**
     * @state
     * Dominant travel direction of gesture in progress.
     * @values left | right | up | down
     */
    gestureDirection: String,
    /**
     * @state
     * What last gesture turned out to be — style a "just swiped" state from it.
     * @values pan | pan-x | pan-y | pinch | rotate | swipe-left | swipe-right | swipe-up | swipe-down | tap | double-tap | long-press
     */
    lastGesture: String,
    /**
     * @provision
     * Last `-start` / `-end` / `-cancel` snapshot (`type`, travel, velocity,
     * progress, `snap`, `swipe`, …). Not an attribute; per-frame values live
     * in `--gesture-*`.
     * @type GestureHandlerProvision
     */
    provision: Object as unknown as ConstructorType<GestureHandlerProvision>,
    // private
    _session: {
      type: Object as unknown as ConstructorType<Session>,
      attr: false,
    },
    _handoff: {
      type: Object as unknown as ConstructorType<Handoff>,
      attr: false,
    },
    _raf: { type: Object as unknown as ConstructorType<Handle>, attr: false },
    _holdTimer: {
      type: Object as unknown as ConstructorType<Handle>,
      attr: false,
    },
    _lastTapAt: { type: Number, attr: false },
  },
}).withTypes<Methods>();

type El = typeof GestureHandler.CustomElement;

GestureHandler.defineMethods({
  /** Long-press timer: fire event and/or arm the pan. */
  _handleHold: ({ _session, gestureTypes, armAfter }) => {
    if (!_session || _session.moved) return;
    _session.longPressed = true;
    _session.armed = _session.armed || armAfter === "long-press";
    return (
      gestureTypes.includes("long-press") && {
        lastGesture: "long-press",
        emit: ["long-press", { detail: point(_session) }],
      }
    );
  },
  /**
   * One frame: recompute, write `--gesture-*`, recognize, announce. With a
   * `phase` it is also the last frame — the release or abort that tears the
   * session down (a flick that never got a frame is recognized here, so
   * `-start` and `-end` both fire).
   */
  _flush: (element, phase?: Phase) => {
    const { _session: s, _raf, _holdTimer } = element;
    if (!s) return { _raf: null };
    compute(s, element);
    writeVars(element, VAR_FORMAT, s.values);
    const recognized =
      !s.type &&
      phase !== "cancel" &&
      (!s.rejected || s.pointers.size >= 2) &&
      recognize(element, s);
    if (recognized) {
      s.type = recognized;
      capturePointers(element, s);
    } else if (s.moved && !s.type) {
      s.rejected = true;
    }
    const { dx, dy } = s.values;
    const gestureDirection = s.moved ? dominantDirection(dx, dy) : null;
    const provision = snapshot(s);
    const frame: unknown[] = [
      { _raf: null },
      gestureDirection !== element.gestureDirection && { gestureDirection },
      !!recognized && {
        gestureType: recognized,
        provision,
        emit: ["start", { detail: provision }],
      },
    ];
    if (!phase) {
      return [
        ...frame,
        !recognized &&
          !!s.type &&
          !!element.shouldEmitMove && {
            emit: ["move", { detail: provision }],
          },
      ];
    }
    cancelAnimationFrame(_raf as number);
    clearTimeout(_holdTimer ?? undefined);
    const effects: unknown[] = [
      ...frame,
      {
        _session: null,
        _raf: null,
        _holdTimer: null,
        isActive: false,
        gestureType: null,
        pointerCount: null,
      },
      ...windowListeners(element, "removeListener"),
    ];
    if (phase === "cancel") {
      return [
        ...effects,
        !!s.type && {
          provision,
          emit: ["cancel", { detail: provision }],
        },
      ];
    }
    if (!s.type) {
      return [...effects, ...tapEffects(element, s)];
    }
    const swipe = detectSwipe(element, s);
    const snap = pickSnap(element, s, swipe);
    const detail = { ...provision, snap, swipe };
    return [
      ...effects,
      { lastGesture: swipe ? `swipe-${swipe}` : s.type, provision: detail },
      !!swipe && {
        emits: ["swipe", `swipe-${swipe}`].map((type) => [
          type,
          { detail: { direction: swipe, velocity: speed(s.values) } },
        ]),
      },
      { emit: ["end", { detail }] },
    ];
  },
  /** The settle transition landed (or there was none). */
  _emitSnap: (_element, detail: GestureHandlerSnapEvent["detail"]) => ({
    emit: ["snap", { detail }],
  }),
  /** Window `pointermove`: track the pointer, schedule a frame. */
  _handleMove: (element, e: PointerEvent) => {
    const { _session: s, _raf } = element;
    const pointer = s?.pointers.get(e.pointerId);
    if (!s || !pointer) return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    return !_raf && { _raf: scheduleFrame(element) };
  },
  /** Release / cancel of one pointer; last one settles. */
  _handleUp: (element, e: PointerEvent) => {
    const { _session: s, _raf } = element;
    const pointer = s?.pointers.get(e.pointerId);
    if (!s || !pointer) return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    // Last pointer settles with release still in session so fling velocity survives.
    if (s.pointers.size === 1) {
      return { _flush: [e.type === "pointercancel" ? "cancel" : "end"] };
    }
    rebase(s, () => s.pointers.delete(e.pointerId));
    return [
      { pointerCount: s.pointers.size },
      !_raf && { _raf: scheduleFrame(element) },
    ];
  },
  /**
   * `handoff-ref`: first move leaves container scrolling or cancels it and
   * opens a session.
   */
  _handleHandoff: (element, event: Event) => handoffEffects(element, event),
})
  .onPropSet("handoffRef", ({ _handleHandoff }) => ({
    addListeners: HANDOFF_EVENTS.map((name) => [
      name,
      _handleHandoff,
      // Only `touchmove` can cancel: browser scroll stops only on first move
      { passive: name !== "touchmove" },
    ]),
  }))
  .onPropUnset("handoffRef", ({ _handleHandoff }) => ({
    removeListeners: HANDOFF_EVENTS.map((name) => [name, _handleHandoff]),
  }))
  .onEvent("pointerdown", (element, event) => {
    const e = event as unknown as PointerEvent;
    if (!accepts(element, e)) {
      // Inside `handoff-ref` container, browser scrolls first; first move decides handoff.
      return { _handoff: pendingHandoff(element, e) };
    }
    const { _session, _raf } = element;
    const session = _session || createSession(element, e.pointerType);
    rebase(session, () =>
      session.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    );
    if (session.type) capturePointers(element, session);
    return [
      ...(_session ? [] : beginEffects(element, session)),
      { _handoff: null, pointerCount: session.pointers.size },
      !_raf && { _raf: scheduleFrame(element) },
    ];
  })
  /**
   * Settle on the snap point. One write, then CSS eases it (the element's
   * own `transition` on `--gesture-progress`, off while `is-active`). The
   * running transition tells us when it lands, and by rejecting, that a
   * new gesture took over; nothing to animate means it already landed.
   */
  .onEventDefault("end", (element, e) => {
    const { snap } = e.detail as GestureHandlerProvision;
    const points = snapPoints(element);
    if (snap === null || !points.length) return;
    const detail = {
      value: snap,
      index: (element.snapPoints || []).map(Number).indexOf(snap),
    };
    element.style.setProperty("--gesture-progress", num(snap));
    const settle = (element.getAnimations?.() ?? []).find(
      (animation) =>
        (animation as Animation & { transitionProperty?: string })
          .transitionProperty === "--gesture-progress"
    );
    if (!settle) return { _emitSnap: [detail] };
    settle.finished.then(
      () => element._emitSnap(detail),
      () => {} // cancelled by the next gesture
    );
  })
  .onPropSet("isDisabled", ({ _session, _handoff }) => [
    !!_handoff && { _handoff: null },
    !!_session && { _flush: ["cancel"] },
  ])
  .onDisconnected(
    // DOM move keeps tracked window listeners; real removal cancels
    ({ isMoving, _session }) =>
      !isMoving && !!_session && { _flush: ["cancel"] }
  );

const now = () => performance.now();
const round = (v: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f || 0;
};
/** `requestAnimationFrame` passes a timestamp; `_flush`'s argument is a phase. */
const scheduleFrame = (element: El) =>
  requestAnimationFrame(() => element._flush());
const kebab = (key: string) =>
  key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const speed = ({ vx, vy }: GestureHandlerValues) =>
  round(Math.hypot(vx, vy), 4);

/** `snap-points` inside `progress-min`..`progress-max` (a rule may narrow bounds per state). */
const snapPoints = ({ snapPoints: points, progressMin, progressMax }: El) =>
  (points || [])
    .map(Number)
    .filter((n) => n >= progressMin && n <= progressMax);

const maxPointers = ({ maxPointers: max, gestureTypes }: El) =>
  max ?? (MULTI_TYPES.some((t) => gestureTypes.includes(t)) ? 2 : 1);

function accepts(element: El, e: PointerEvent): boolean {
  const { isDisabled, pointerTypes, _session } = element;
  if (isDisabled || e.button > 0 || !pointerTypes.includes(e.pointerType)) {
    return false;
  }
  if (_session) {
    return (
      _session.pointerType === e.pointerType &&
      _session.pointers.size < maxPointers(element)
    );
  }
  return originAllowed(element, e);
}

/**
 * `from-ref` / `from-edge`: neither set = anywhere; both set = either.
 * Start inside a `handoff-ref` container is never immediate — waits for
 * first move, unless `from-ref` / `from-edge` already claimed it.
 */
function originAllowed(element: El, e: PointerEvent): boolean {
  const { fromRef, fromEdge, edgePx, handoffRef } = element;
  if (!fromRef && !fromEdge?.length && !handoffRef) return true;
  if (
    fromRef &&
    selectOne(fromRef, { scope: element })?.contains(e.target as Node)
  ) {
    return true;
  }
  if (fromEdge?.length) {
    const r = element.getBoundingClientRect();
    const insets: Record<string, number> = {
      left: e.clientX - r.left,
      right: r.right - e.clientX,
      top: e.clientY - r.top,
      bottom: r.bottom - e.clientY,
    };
    if (fromEdge.some((edge) => insets[edge] <= edgePx)) return true;
  }
  if (handoffContainer(element, e.target)) return false;
  return !fromRef && !fromEdge?.length;
}

/** Innermost `handoff-ref` container this node sits in, if any (matches
 *  in document order; last containing match is nearest — a scrolling editor
 *  inside a non-scrolling sheet must be judged by its own scroll, not the sheet's). */
function handoffContainer(element: El, node: EventTarget | null) {
  const { handoffRef } = element;
  if (!handoffRef || !node) return null;
  const containers = (selectAll(handoffRef, { scope: element }) || []).filter(
    (container) => container.contains(node as Node)
  );
  return containers[containers.length - 1] || null;
}

function pendingHandoff(element: El, e: PointerEvent): Handoff | null {
  const { isDisabled, pointerTypes, _session } = element;
  if (_session || isDisabled || e.button > 0) return null;
  if (!pointerTypes.includes(e.pointerType)) return null;
  const container = handoffContainer(element, e.target);
  return (
    container && {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      x: e.clientX,
      y: e.clientY,
      container,
    }
  );
}

/** Direction `--gesture-progress` grows, as `createSession` reads it. */
function progressDirection({
  gestureTypes,
  progressAxis,
}: El): GestureDirection {
  const yOnly =
    gestureTypes.includes("pan-y") && !gestureTypes.includes("pan-x");
  const named = (progressAxis ||
    (yOnly ? "down" : "right")) as GestureDirection;
  return AXES[named] ? named : "right";
}

/** Is container scrolled as far as a finger moving `direction` can take it? */
function atScrollLimit(container: Element, direction: GestureDirection) {
  const { scrollTop, scrollLeft, scrollHeight, scrollWidth } = container;
  const { clientHeight, clientWidth } = container;
  switch (direction) {
    case "down":
      return scrollTop <= LIMIT_EPSILON;
    case "up":
      return scrollTop >= scrollHeight - clientHeight - LIMIT_EPSILON;
    case "right":
      return scrollLeft <= LIMIT_EPSILON;
    default:
      return scrollLeft >= scrollWidth - clientWidth - LIMIT_EPSILON;
  }
}

/**
 * Does this first move hand over? Must run along `progress-axis`, find
 * container at its limit that way, and have progress left to travel.
 */
function handsOver(element: El, container: Element, dx: number, dy: number) {
  const forward = progressDirection(element);
  const [ax, ay] = AXES[forward];
  const along = dx * ax + dy * ay;
  const across = Math.abs(dx * ay - dy * ax);
  if (Math.abs(along) < HANDOFF_MIN_PX || Math.abs(along) <= across) {
    return false;
  }
  const { progressOffset, progressMin, progressMax } = element;
  const headroom =
    along > 0 ? progressOffset < progressMax : progressOffset > progressMin;
  return (
    headroom &&
    atScrollLimit(container, along > 0 ? forward : OPPOSITE[forward])
  );
}

function handoffEffects(element: El, event: Event): unknown[] | undefined {
  const { _handoff: h, _session } = element;
  if (!h || _session) return;
  if (event.type !== "touchmove" && event.type !== "pointermove") {
    return [{ _handoff: null }]; // released or taken by browser
  }
  const touch = (event as TouchEvent).touches?.[0];
  // Touches judged on `touchmove` (scroll still cancellable); mouse has no native drag-scroll
  const pointer = touch || (event as PointerEvent);
  if (!touch) {
    const e = event as PointerEvent;
    if (e.pointerType !== "mouse" || e.pointerId !== h.pointerId) return;
  }
  const dx = pointer.clientX - h.x;
  const dy = pointer.clientY - h.y;
  if (Math.hypot(dx, dy) < HANDOFF_MIN_PX) return; // too early to tell
  if (!handsOver(element, h.container, dx, dy)) {
    return [{ _handoff: null }]; // container scrolls; leave it
  }
  if (touch) event.preventDefault(); // no native scroll for this sequence
  const session = createSession(element, h.pointerType);
  rebase(session, () => session.pointers.set(h.pointerId, { x: h.x, y: h.y }));
  return [
    ...beginEffects(element, session),
    { _handoff: null, pointerCount: 1 },
    {
      _handleMove: [
        {
          pointerId: h.pointerId,
          clientX: pointer.clientX,
          clientY: pointer.clientY,
        },
      ],
    },
  ];
}

/** Range, axis, start offset — read once when gesture begins. */
function createSession(element: El, pointerType: string): Session {
  const { rangeRef, rangePx, progressOffset } = element;
  const axis = AXES[progressDirection(element)];
  const target = rangeRef ? selectOne(rangeRef, { scope: element }) : null;
  const range =
    rangePx ??
    (target ? (axis[0] ? target.offsetWidth : target.offsetHeight) : 0);
  const rect = element.getBoundingClientRect();
  return {
    pointerType,
    pointers: new Map(),
    rect,
    t0: now(),
    acc: [0, 0],
    base: [0, 0],
    baseDist: 0,
    baseAngle: 0,
    scaleBase: 1,
    rotateBase: 0,
    samples: [],
    distance: 0,
    moved: false,
    armed: !element.armAfter,
    rejected: false,
    captured: new Set(),
    longPressed: false,
    type: null,
    axis,
    rangePx: range,
    offsetPx: progressOffset * range,
    values: {
      ...restingValues(),
      progress: range ? progressOffset : 0,
    },
  };
}

/** Every frame value at rest — the write table is the list of them. */
const restingValues = () =>
  ({
    ...Object.keys(VAR_FORMAT).reduce((all, key) => ({ ...all, [key]: 0 }), {}),
    scale: 1,
  }) as GestureHandlerValues;

/** Open-session effects: the per-gesture constants, state, hold timer, window listeners. */
function beginEffects(element: El, session: Session): unknown[] {
  const { _handleHold, longPressMs } = element;
  const { width, height } = session.rect;
  writeVars(element, SESSION_FORMAT, {
    rangePx: session.rangePx,
    width,
    height,
  } satisfies SessionValues);
  return [
    {
      _session: session,
      isActive: true,
      _holdTimer: setTimeout(_handleHold, longPressMs),
    },
    ...windowListeners(element, "addListener"),
  ];
}

function centroid(s: Session): Vec {
  const pts = [...s.pointers.values()];
  // Empty only in the `rebase` that seats the first pointer, where `base` is still the identity.
  if (!pts.length) return s.base;
  return [
    pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
    pts.reduce((sum, p) => sum + p.y, 0) / pts.length,
  ];
}

/** Keep travel / scale / rotation continuous across a pointer join or leave. */
function rebase(s: Session, change: () => void) {
  const [cx, cy] = centroid(s);
  s.acc = [s.acc[0] + cx - s.base[0], s.acc[1] + cy - s.base[1]];
  s.scaleBase = s.values.scale;
  s.rotateBase = s.values.rotate;
  change();
  s.base = centroid(s);
  const [a, b] = [...s.pointers.values()];
  s.baseDist = b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  s.baseAngle = b ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
  // Seed velocity window at new base so a flick before first frame still has speed
  s.samples = [[now(), s.base[0], s.base[1]]];
}

/** Capture after recognition so taps / clicks below stay native. */
function capturePointers(element: El, s: Session) {
  s.pointers.forEach((_, id) => {
    if (s.captured.has(id)) return;
    s.captured.add(id);
    try {
      element.setPointerCapture(id);
    } catch {
      /* pointer already gone */
    }
  });
}

function compute(
  s: Session,
  { progressMin, progressMax, overshootResistance, thresholdPx }: El
) {
  const [cx, cy] = centroid(s);
  const t = now();
  s.samples = [
    ...s.samples.filter(([st]) => t - st <= VELOCITY_WINDOW_MS),
    [t, cx, cy],
  ];
  const [t0, x0, y0] = s.samples[0];
  const dt = t - t0;
  const dx = s.acc[0] + cx - s.base[0];
  const dy = s.acc[1] + cy - s.base[1];
  const [a, b] = [...s.pointers.values()];
  const dist = b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  const along = dx * s.axis[0] + dy * s.axis[1];
  const range = s.rangePx;
  const progressPx = range
    ? soft(
        s.offsetPx + along,
        progressMin * range,
        progressMax * range,
        overshootResistance
      )
    : s.offsetPx + along;
  const { left, top } = s.rect;
  s.distance = Math.hypot(dx, dy);
  s.moved ||= s.distance >= thresholdPx;
  s.values = {
    x: cx - left,
    y: cy - top,
    dx,
    dy,
    vx: dt ? (cx - x0) / dt : 0,
    vy: dt ? (cy - y0) / dt : 0,
    progress: range ? progressPx / range : 0,
    scale: b && s.baseDist ? s.scaleBase * (dist / s.baseDist) : s.scaleBase,
    rotate: b
      ? s.rotateBase +
        ((Math.atan2(b.y - a.y, b.x - a.x) - s.baseAngle) * 180) / Math.PI
      : s.rotateBase,
    pointers: s.pointers.size,
  };
}

/** Clamp with rubber-banding past bounds. */
const soft = (v: number, lo: number, hi: number, k: number) =>
  v < lo ? lo + (v - lo) * k : v > hi ? hi + (v - hi) * k : v;

function recognize(
  { gestureTypes: types, lockAxis }: El,
  s: Session
): GestureType | null {
  if (s.pointers.size >= 2) {
    return MULTI_TYPES.find((t) => types.includes(t)) || null;
  }
  if (!s.moved || !s.armed) return null;
  const { dx, dy } = s.values;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const pans = types.filter((t) => PAN_TYPES.includes(t));
  const free =
    pans.includes("pan") || (!pans.length && types.includes("swipe"));
  if (free) return lockAxis ? (horizontal ? "pan-x" : "pan-y") : "pan";
  if (pans.includes("pan-x") && horizontal) return "pan-x";
  if (pans.includes("pan-y") && !horizontal) return "pan-y";
  return null;
}

const dominantDirection = (dx: number, dy: number): GestureDirection =>
  Math.abs(dx) >= Math.abs(dy)
    ? dx < 0
      ? "left"
      : "right"
    : dy < 0
      ? "up"
      : "down";

function detectSwipe(
  { gestureTypes, swipeMinVelocity, swipeDirections }: El,
  s: Session
): GestureDirection | null {
  if (!gestureTypes.includes("swipe")) return null;
  const { vx, vy } = s.values;
  const horizontal = Math.abs(vx) >= Math.abs(vy);
  if (Math.abs(horizontal ? vx : vy) < swipeMinVelocity) return null;
  if (
    (s.type === "pan-x" && !horizontal) ||
    (s.type === "pan-y" && horizontal)
  ) {
    return null;
  }
  const direction = dominantDirection(vx, vy);
  return swipeDirections?.length && !swipeDirections.includes(direction)
    ? null
    : direction;
}

/** Snap target: next point in swipe direction, else nearest to fling projection. */
function pickSnap(
  element: El,
  s: Session,
  swipe: GestureDirection | null
): number | null {
  const points = snapPoints(element);
  if (!points.length) return null;
  const { progress, vx, vy } = s.values;
  const { rangePx } = s;
  const swipeAlong = swipe
    ? AXES[swipe][0] * s.axis[0] + AXES[swipe][1] * s.axis[1]
    : 0;
  const ahead = points.filter((p) =>
    swipeAlong > 0 ? p > progress : p < progress
  );
  if (swipeAlong && ahead.length) {
    return swipeAlong > 0 ? Math.min(...ahead) : Math.max(...ahead);
  }
  const vAlong = vx * s.axis[0] + vy * s.axis[1];
  const projected = rangePx
    ? progress + (vAlong * PROJECTION_MS) / rangePx
    : progress;
  return points.reduce((best, p) =>
    Math.abs(p - projected) < Math.abs(best - projected) ? p : best
  );
}

/** Tap / double-tap on a release that never moved nor long-pressed. */
function tapEffects(
  { gestureTypes, doubleTapMs, _lastTapAt }: El,
  s: Session
): unknown[] {
  if (s.moved || s.longPressed) return [];
  const t = now();
  const isDouble =
    gestureTypes.includes("double-tap") &&
    !!_lastTapAt &&
    t - _lastTapAt <= doubleTapMs;
  const detail = point(s);
  return [
    { _lastTapAt: isDouble ? null : t },
    gestureTypes.includes("tap") && {
      lastGesture: "tap",
      emit: ["tap", { detail }],
    },
    isDouble && {
      lastGesture: "double-tap",
      emit: ["double-tap", { detail }],
    },
  ];
}

const point = (s: Session) => ({ x: round(s.values.x), y: round(s.values.y) });

const snapshot = (s: Session): GestureHandlerProvision => ({
  ...s.values,
  type: s.type,
  pointerType: s.pointerType,
  distance: s.distance,
  rangePx: s.rangePx,
  durationMs: round(now() - s.t0),
  snap: null,
  swipe: null,
});

/** One table's values onto the element as `--gesture-<kebab key>`. */
function writeVars<K extends string>(
  element: El,
  table: Record<K, (v: number) => string>,
  values: Record<K, number>
) {
  (Object.keys(table) as K[]).forEach((key) =>
    element.style.setProperty(
      `--gesture-${kebab(key)}`,
      table[key](values[key])
    )
  );
}
