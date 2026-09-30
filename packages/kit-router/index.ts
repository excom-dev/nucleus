import { KitLogger } from "@excom/kit-logger";
import { requestIdleCb } from "@excom/kit-shims";

// Not `__spa_router_data__`: 0.1.3 sessions (content-hash ids) are ignored
const SESSION_KEY = "__kit_router_history__";

export interface KitRouteState {
  id: string;
  url: string;
  title?: string;
  isInit?: boolean;
  /** Saved whenever the entry is left, `pagehide` included. */
  scrollX?: number;
  scrollY?: number;
  ttypes?: string[];
}

export interface KitChangeStateOptions {
  url: string;
  ttypes?: string[];
  title?: string;
  scrollY?: number;
  scrollX?: number;
}

export interface KitRouteData {
  previous: KitRouteState | null;
  active: KitRouteState;
  next: KitRouteState | null;
  all: KitRouteState[];
  /**
   * Path pattern placeholders and named groups (unmatched ones left out). Read
   * unnamed groups from `match`.
   */
  params: Record<string, string> | null;
  /** `location.search` as an object. */
  query: Record<string, string>;
  match: Array<any> | null;
  /**
   * How `active` was entered. `null`: page load (not back / forward), or an
   * entry the router did not create (fragment link).
   */
  move: null | "push" | "replace" | "back" | "forward";
  event?: {
    hasUAVisualTransition: boolean;
  };
  route: KitRoute;
}

export interface KitRouteOpts {
  matchNested?: boolean;
}

export type KitRouteHandler = (data: KitRouteData) => void;

/**
 * Resolves a relative `href` against `document.baseURI` (honours `<base>`) to
 * path + query + hash. Absolute paths and full URLs pass through.
 */
export const resolveHref = (href: string) => {
  if (href.startsWith("/") || URL.canParse(href)) return href;
  const { pathname, search, hash } = new URL(href, document.baseURI);
  return pathname + search + hash;
};

/** Like the pathname `locationChanged` matches; a bare `%` stays as is. */
const decodePath = (path: string) => {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
};

// `:name` compiles to a group `${PARAM_GROUP}<position>`: valid for any name,
// unique when repeated. Unlikely prefix, so no clash with an author's groups.
const PARAM_GROUP = "__kit_param_";

export class KitRoute {
  key: string | RegExp;
  regex: RegExp;
  paramNames: string[];
  handler: KitRouteHandler;
  opts: KitRouteOpts;
  constructor(
    key: string | RegExp,
    handler: KitRouteHandler,
    opts: KitRouteOpts = {}
  ) {
    if (!key || !handler) throw new Error("Invalid route or handler");
    this.key = key;
    this.handler = handler;
    this.opts = opts;
    this.paramNames = [];
    if (typeof key === "string") {
      const expression = decodePath(resolveHref(key))
        .replace(
          // Not after `?`: `(?:x)` is a group
          /(?<!\?)[:*](\w+)/g,
          (_match, name) =>
            `(?<${PARAM_GROUP}${this.paramNames.push(name) - 1}>[^/]+)`
        )
        .replace(/\*/g, "(?:.*)");
      const base = expression.replace(/\/$/, "");
      this.regex = new RegExp(
        opts.matchNested
          ? // The base path or a child path, never `/basex`; `/` matches all
            base
            ? `^${base}(?=/|$)`
            : "^/"
          : `^${expression}$`
      );
    } else if (key instanceof RegExp) {
      // `g` drops the groups from a match, `y` reads `lastIndex`
      this.regex = new RegExp(key, key.flags.replace(/[gy]/g, ""));
    } else {
      throw new Error("Invalid route key type. Must be string or RegExp.");
    }
  }
  public match(pathname: string) {
    const match = pathname.match(this.regex);
    return { match, params: match && this.collectRouteParams(match) };
  }
  private collectRouteParams({ groups = {} }: RegExpMatchArray) {
    try {
      return Object.fromEntries(
        Object.entries(groups)
          .filter(([, value]) => value !== undefined)
          .map(([group, value]) => [
            group.startsWith(PARAM_GROUP)
              ? this.paramNames[+group.slice(PARAM_GROUP.length)]
              : group,
            decodeURIComponent(value),
          ])
      );
    } catch (_) {
      return {};
    }
  }
}

/**
 * History-backed router. Caps retained states so sessionStorage stays bounded.
 */
export class KitRouter {
  // ~0.2kb per data-heavy state → ~5mb at this cap in sessionStorage
  public DEFAULT_MAX_STATES = 25000;
  public MAX_STATES = 25000;
  protected routes: KitRoute[] = [];
  protected states: KitRouteState[];
  protected currentTempData: {
    move: KitRouteData["move"];
    event?: KitRouteData["event"];
  };
  protected currentStateId: string | null;
  // Same-origin frames share the page's sessionStorage: one key per frame
  private sessionKey =
    window === window.top
      ? SESSION_KEY
      : `${SESSION_KEY}:${window.name || location.pathname}`;
  private handlePopState: (e: PopStateEvent) => void;
  private handlePageHide: () => void;

  constructor() {
    const { states, currentStateId } = this.getInitSessionData();
    this.states = states;
    this.currentStateId = currentStateId;
    this.currentTempData = { move: null };
    const from = this.getStateIndex(currentStateId);
    const to = this.getStateIndex(history.state?.id);
    if (to < 0) {
      // New entry: first visit, typed URL, link from another page
      this.track(true);
    } else {
      // Reload, or back / forward from another document
      this.setSessionData({
        currentStateId: this.states[to].id,
        currentTempData: {
          move: from < 0 || from === to ? null : from < to ? "forward" : "back",
        },
      });
    }
    this.handlePopState = (e: PopStateEvent) => {
      const from = this.getStateIndex(this.currentStateId);
      const to = this.getStateIndex(history.state?.id);
      if (from > -1 && from !== to) this.setScrollData(this.states[from]);
      if (to < 0) {
        // Entry the router did not create: fragment link, foreign pushState
        this.track();
      } else if (from !== to) {
        this.setSessionData({
          currentStateId: this.states[to].id,
          currentTempData: {
            move: from < to ? "forward" : "back",
            event: {
              hasUAVisualTransition: e.hasUAVisualTransition,
            },
          },
        });
      }
      this.locationChanged();
    };
    this.handlePageHide = () => {
      const index = this.currentIndex();
      if (index > -1) this.setScrollData(this.states[index]);
      this.writeSession();
    };
    window.addEventListener("popstate", this.handlePopState);
    window.addEventListener("pagehide", this.handlePageHide);
  }

  public destroy() {
    window.removeEventListener("popstate", this.handlePopState);
    window.removeEventListener("pagehide", this.handlePageHide);
  }

  public pushState(changeStateOptions: KitChangeStateOptions) {
    const index = this.activeIndex();
    this.setScrollData(this.states[index]);
    const state = buildState({
      ...changeStateOptions,
      url: resolveHref(changeStateOptions.url),
    });
    this.setSessionData({
      // Drops states after the current one (went back, then pushed)
      states: [...this.states.slice(0, index + 1), state],
      currentStateId: state.id,
      currentTempData: { move: "push" },
    });
    history.pushState(
      { id: state.id },
      changeStateOptions.title ?? document.title,
      state.url
    );
    this.locationChanged();
  }
  public replaceState(changeStateOptions: KitChangeStateOptions) {
    const index = this.activeIndex();
    const state = buildState({
      ...changeStateOptions,
      url: resolveHref(changeStateOptions.url),
      // Replacing the init entry leaves nothing to go back to
      isInit: this.states[index].isInit,
    });
    this.setSessionData({
      // Forward states stay, as they do in the browser
      states: this.states.toSpliced(index, 1, state),
      currentStateId: state.id,
      currentTempData: { move: "replace" },
    });
    this._replaceState(state.url, changeStateOptions.title, {
      id: state.id,
    });
  }
  private _replaceState(url, title?, historyState = history.state) {
    history.replaceState(historyState, title ?? document.title, url);
    this.locationChanged();
  }
  public canGoBack() {
    const index = this.currentIndex();
    // Past `MAX_STATES` the oldest (init) state is gone; back still works, just without metadata.
    return index > 0 || (index === 0 && !this.states[0].isInit);
  }
  public canGoForward() {
    const index = this.currentIndex();
    return index > -1 && index < this.states.length - 1;
  }
  public back(stateIndex = -1) {
    history.go(stateIndex);
  }
  public forward(stateIndex = 1) {
    history.go(stateIndex);
  }

  private locationChanged(routes = this.routes) {
    const pathname = decodeURI(location.pathname);
    const search = location.search;
    const hash = location.hash;

    if (this.shouldStripSlash(pathname)) {
      // Private `_replaceState` so we don't track this slash-strip replace
      this._replaceState(
        pathname.slice(0, pathname.length - 1) + search + hash
      );
    } else {
      const index = this.activeIndex();
      const query = Object.fromEntries(new URLSearchParams(search));
      routes.forEach((route) => {
        const { match, params } = route.match(pathname);
        const data: KitRouteData = {
          previous: this.states[index - 1] ?? null,
          active: this.states[index],
          next: this.states[index + 1] ?? null,
          all: this.states,
          params,
          query,
          match,
          move: this.currentTempData.move,
          event: this.currentTempData.event,
          route,
        };
        route.handler(data);
      });
    }
  }

  public on(route: KitRoute) {
    if (
      !this.routes.some(
        (r) => r.key === route.key && r.handler === route.handler
      )
    ) {
      this.routes.push(route);
      // Call the handler now so it gets current info
      this.locationChanged([route]);
    } else {
      throw new Error("Route already registered");
    }

    return route;
  }

  public off(route: KitRoute) {
    this.routes = this.routes.filter((r) => r !== route);

    return null;
  }

  public get previousStates() {
    const index = this.currentIndex();
    return index < 0 ? [] : this.states.slice(0, index);
  }

  public get nextStates() {
    const index = this.currentIndex();
    return index < 0 ? [] : this.states.slice(index + 1);
  }

  /**
   * Index of the entry the browser is on. Outside `popstate`, a missing id
   * means foreign code replaced the current entry.
   */
  private currentIndex() {
    const index = this.getStateIndex(history.state?.id);
    return index < 0 ? this.getStateIndex(this.currentStateId) : index;
  }

  /** `currentIndex`, stamping a lost id and the new URL back onto the entry. */
  private activeIndex() {
    // No current entry either (trimmed by `MAX_STATES`)
    if (this.currentIndex() < 0) this.track();
    const index = this.currentIndex();
    const state = this.states[index];
    if (history.state?.id !== state.id) {
      state.url = getUrl();
      history.replaceState({ ...history.state, id: state.id }, "");
      this.setSessionData({});
    }
    return index;
  }

  /**
   * Adds the entry the browser is on after the current one, dropping later
   * ones as the browser did, and stamps its id.
   */
  private track(isInit = false) {
    const state = buildState({ isInit });
    this.setSessionData({
      states: [
        ...this.states.slice(0, this.getStateIndex(this.currentStateId) + 1),
        state,
      ],
      currentStateId: state.id,
      currentTempData: { move: null },
    });
    history.replaceState({ ...history.state, id: state.id }, "");
  }

  private setScrollData(state: KitRouteState) {
    state.scrollX = window.scrollX;
    state.scrollY = window.scrollY;
  }

  /** `-1` when the id is missing or unknown. */
  private getStateIndex(id?: string | null) {
    return id ? this.states.findIndex((s) => s.id === id) : -1;
  }

  private shouldStripSlash(pathname) {
    return (
      pathname !== "/" &&
      pathname?.endsWith?.("/") &&
      // No trailing-slash route matches this path exactly
      !this.routes.find((route) => {
        const { match } = route.match(pathname);
        return (
          match?.[0] &&
          typeof route.key === "string" &&
          !route.key?.endsWith?.("/")
        );
      })
    );
  }
  private setSessionData({
    states,
    currentStateId,
    currentTempData,
  }: {
    states?: KitRouteState[];
    currentStateId?: string | null;
    currentTempData?: KitRouter["currentTempData"];
  }) {
    this.states = (states ?? this.states).slice(-this.MAX_STATES);
    this.currentStateId = currentStateId ?? this.currentStateId;
    this.currentTempData = currentTempData ?? this.currentTempData;
    // Idle write is enough: `pagehide` flushes
    requestIdleCb(() => this.writeSession(), 0);
  }
  private writeSession() {
    try {
      sessionStorage.setItem(
        this.sessionKey,
        JSON.stringify({
          states: this.states,
          currentStateId: this.currentStateId,
        })
      );
    } catch (e) {
      KitLogger.error("Error setting session data", e);
    }
  }
  private getInitSessionData(): {
    states: KitRouteState[];
    currentStateId: string | null;
  } {
    try {
      const stored = JSON.parse(
        sessionStorage.getItem(this.sessionKey) || "null"
      );
      if (
        Array.isArray(stored?.states) &&
        stored.states.every((state) => state?.id)
      ) {
        return stored;
      }
    } catch (e) {
      KitLogger.error("Error getting session data", e);
    }
    return { states: [], currentStateId: null };
  }
}

/**
 * Unique in the tab, across page loads. `randomUUID` is missing in insecure
 * contexts.
 */
const newId = () =>
  crypto.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function buildState(obj: Partial<KitRouteState> = {}): KitRouteState {
  return Object.assign(
    { id: newId(), url: obj.url ?? getUrl() },
    obj.title && { title: obj.title },
    obj.isInit && { isInit: obj.isInit },
    obj.scrollX != null && { scrollX: obj.scrollX },
    obj.scrollY != null && { scrollY: obj.scrollY },
    obj.ttypes && obj.ttypes.length > 0 && { ttypes: obj.ttypes }
  );
}

function getUrl() {
  return location.pathname + location.search + location.hash;
}

export const kitRouter = new KitRouter();
