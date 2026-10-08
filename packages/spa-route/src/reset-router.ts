import { kitRouter } from "@excom/kit-router";

type RouterInternals = {
  states: object[];
  currentStateId: string | null;
  currentTempData: { move: null };
};

/**
 * Puts the `kit-router` singleton back to a cold load of `url`. `state`
 * extras go on the initial history entry (a saved scroll offset = a reload).
 * `beforeEach(() => resetRouter())`: passed bare, it gets the test context as `url`.
 */
export const resetRouter = (url = "/", state: object = {}): void => {
  const router = kitRouter as unknown as RouterInternals;
  history.replaceState({ id: "init" }, "", url);
  router.states = [{ id: "init", url, isInit: true, ...state }];
  router.currentStateId = "init";
  router.currentTempData = { move: null };
  kitRouter.MAX_STATES = kitRouter.DEFAULT_MAX_STATES;
};
