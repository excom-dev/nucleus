import { SpaA } from "./spa-a";
import { SpaManager } from "./spa-manager";
import { SpaRoute } from "./spa-route";

SpaManager.define();
SpaRoute.define();
SpaA.define();

export { SpaA, SpaManager, SpaRoute };

type T_HTMLSpaManagerElement = typeof SpaManager.CustomElement;
type T_HTMLSpaRouteElement = typeof SpaRoute.CustomElement;
type T_HTMLSpaAElement = typeof SpaA.CustomElement;
declare global {
  interface HTMLSpaManagerElement extends T_HTMLSpaManagerElement {}
  interface HTMLSpaRouteElement extends T_HTMLSpaRouteElement {}
  interface HTMLSpaAElement extends T_HTMLSpaAElement {}
  interface Window {
    HTMLSpaManagerElement: HTMLSpaManagerElement;
    HTMLSpaRouteElement: HTMLSpaRouteElement;
    HTMLSpaAElement: HTMLSpaAElement;
  }
  interface HTMLElementTagNameMap {
    "spa-manager": HTMLSpaManagerElement;
    "spa-route": HTMLSpaRouteElement;
    "spa-a": HTMLSpaAElement;
  }
}
export type { HTMLSpaAElement, HTMLSpaManagerElement, HTMLSpaRouteElement };
