import { hashObject } from "@excom/hash-object";
import { KitLogger } from "@excom/kit-logger";
import { requestIdleCb } from "@excom/kit-shims";

export interface KitRouteState {
  id: string;
  url: string;
  title?: string;
  isInit?: boolean;
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
  params: Record<string, string> | null;
  match: Array<any> | null;
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
      const expression = key
        .replace(/([:*])(\w+)/g, (_full, _dots, name) => {
          // `_full` and `_dots` are unused
          this.paramNames.push(name);
          return "([^/]+)";
        })
        .replace(/\*/g, "(?:.*)");
      const endOfPath = opts.matchNested ? "/" : "$";
      this.regex = new RegExp(`^${expression}${endOfPath}`);
    } else if (key instanceof RegExp) {
      this.regex = key;
    } else {
      throw new Error("Invalid route key type. Must be string or RegExp.");
    }
  }
  public match(pathname: string) {
    const { regex, paramNames } = this;
    const match = pathname.match(regex);
    return {
      match,
      params:
        match && match.length > 0
          ? this.collectRouteParams(match, paramNames)
          : null,
    };
  }
  private collectRouteParams(match: string[], paramNames: string[]) {
    try {
      return match.slice(1, match.length).reduce((params, value, index) => {
        params[paramNames[index]] = decodeURIComponent(value);

        return params;
      }, {});
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
  private handlePopState: (e: PopStateEvent) => void;

  constructor() {
    const sessionData = this.getInitSessionData();
    this.states = sessionData.states;
    this.currentTempData = sessionData.currentTempData;
    this.currentStateId = sessionData.currentStateId;
    this.routes = [];
    this.handlePopState = (e: PopStateEvent) => {
      if (this.currentStateId) {
        const lastPopStateIndex = this.getStateIndex(this.currentStateId);
        const currentStateIndex = this.getStateIndex(history.state?.id);
        if (lastPopStateIndex < currentStateIndex) {
          this.setScrollData(this.states[lastPopStateIndex]);
          this.setSessionData({
            currentTempData: {
              move: "forward",
              event: {
                hasUAVisualTransition: e.hasUAVisualTransition,
              },
            },
          });
        } else if (lastPopStateIndex > currentStateIndex) {
          this.setScrollData(this.states[lastPopStateIndex]);
          this.setSessionData({
            currentTempData: {
              move: "back",
              event: {
                hasUAVisualTransition: e.hasUAVisualTransition,
              },
            },
          });
        }
      } else {
        // TODO: set scroll data here?
        this.setSessionData({
          currentTempData: {
            move: "back",
            event: {
              hasUAVisualTransition: e.hasUAVisualTransition,
            },
          },
        });
      }
      this.setSessionData({
        // Falls back to the initial state id when history has no recognized id
        currentStateId: this.getActiveState(
          this.getStateIndex(history.state?.id)
        ).id,
      });
      this.locationChanged();
    };
    window.addEventListener("popstate", this.handlePopState);
  }

  public destroy() {
    window.removeEventListener("popstate", this.handlePopState);
  }

  public pushState(changeStateOptions: KitChangeStateOptions) {
    this.beforePushState();
    const state = buildState(changeStateOptions);
    this.setSessionData({
      states: [...this.states, state],
      currentStateId: state.id,
      currentTempData: {
        move: "push",
        event: undefined,
      },
    });
    history.pushState(
      { id: state.id },
      changeStateOptions.title ?? document.title,
      changeStateOptions.url
    );
    this.locationChanged();
  }
  public replaceState(changeStateOptions: KitChangeStateOptions) {
    this.beforePushState();
    const state = buildState(changeStateOptions);
    this.setSessionData({
      states: [...this.states.slice(0, -1), state],
      currentStateId: state.id,
      currentTempData: {
        move: "replace",
        event: undefined,
      },
    });
    this._replaceState(changeStateOptions.url, changeStateOptions.title, {
      id: state.id,
    });
  }
  private _replaceState(url, title?, historyState = history.state) {
    history.replaceState(historyState, title ?? document.title, url);
    this.locationChanged();
  }
  public canGoBack() {
    const activeStateIndex = this.getStateIndex(history.state?.id);
    if (activeStateIndex > 0) {
      return true;
    } else {
      const activeState = this.getActiveState(activeStateIndex);
      // Past `MAX_STATES` the oldest (init) state is gone; back still works, just without metadata.
      return !activeState.isInit;
    }
  }
  public canGoForward() {
    const activeStateIndex = this.getStateIndex(history.state?.id);
    const nextState = this.getNextState(activeStateIndex);
    return !!nextState;
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
      const activeStateIndex = this.getStateIndex(history.state?.id);
      const previous = this.getPreviousState(activeStateIndex);
      const active = this.getActiveState(activeStateIndex);
      const next = this.getNextState(activeStateIndex);
      routes.forEach((route) => {
        const { match, params } = route.match(pathname);
        const data: KitRouteData = {
          previous,
          active,
          next,
          all: this.states,
          params,
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

  private beforePushState() {
    const index = this.getStateIndex(history.state?.id);
    const currentState = this.getActiveState(index);
    this.setScrollData(currentState);
    // Drop states after the current one (went back, then pushed a new one)
    this.setSessionData({
      states: this.states.slice(0, index + 1),
    });
  }

  private setScrollData(state: KitRouteState) {
    if (window.scrollY) {
      // Non-zero: keep `scrollY`
      state.scrollY = window.scrollY;
    }
    if (window.scrollX) {
      // Non-zero: keep `scrollX`
      state.scrollX = window.scrollX;
    }
  }

  private getStateIndex(id) {
    if (!id) return 0;
    else {
      // Search from the end in case two states share an id
      const foundState = this.states
        .slice()
        .reverse()
        .find((s) => s.id === id);
      const foundIndex = this.states.findIndex((s) => s === foundState);
      return foundIndex > -1 ? foundIndex : 0;
    }
  }

  private getPreviousState(activeStateIndex) {
    if (activeStateIndex < 1) return null;
    else return this.states[activeStateIndex - 1];
  }

  private getActiveState(activeStateIndex) {
    return this.states[activeStateIndex]!;
  }

  private getNextState(activeStateIndex) {
    if (activeStateIndex >= this.states.length - 1) return null;
    else return this.states[activeStateIndex + 1];
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
    currentTempData?: {
      move: null | "push" | "replace" | "back" | "forward";
      event?: {
        hasUAVisualTransition: boolean;
      };
    };
  }) {
    this.states = (states ?? this.states).slice(-this.MAX_STATES);
    this.currentStateId = currentStateId ?? this.currentStateId;
    this.currentTempData = currentTempData ?? this.currentTempData;
    requestIdleCb(() => {
      // Idle write is enough; no need to block here
      try {
        sessionStorage.setItem(
          "__spa_router_data__",
          JSON.stringify({
            states: this.states,
            currentStateId: this.currentStateId,
            currentTempData: this.currentTempData,
          })
        );
      } catch (e) {
        KitLogger.error("Error setting session data", e);
      }
    }, 0);
  }
  private getInitSessionData() {
    let sessionStorageData;
    try {
      sessionStorageData = JSON.parse(
        sessionStorage.getItem("__spa_router_data__") || "null"
      );
    } catch (e) {
      KitLogger.error("Error getting session data", e);
    }
    return (
      // Restore session data, or start fresh
      sessionStorageData || {
        states: [buildState({ isInit: true })],
        currentStateId: null,
        currentTempData: {
          move: null,
        },
      }
    );
  }
}

function buildState(obj: Partial<KitRouteState> = {}): KitRouteState {
  const newState: Partial<KitRouteState> = Object.assign(
    {},
    { url: obj.url ?? getUrl() },
    obj.title && { title: obj.title },
    obj.scrollY && { scrollY: obj.scrollY },
    obj.scrollX && { scrollX: obj.scrollX },
    obj.isInit && { isInit: obj.isInit },
    obj.ttypes && obj.ttypes?.length > 0 && { ttypes: obj.ttypes }
  );
  newState.id = hashObject(newState);
  return newState as KitRouteState;
}

function getUrl() {
  return location.pathname + location.search + location.hash;
}

export const kitRouter = new KitRouter();
