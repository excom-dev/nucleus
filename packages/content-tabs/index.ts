import { ContentTabs } from "./content-tabs";
import { ContentTabsBody } from "./content-tabs-body";
import { ContentTabsHeader } from "./content-tabs-header";

ContentTabs.define();
ContentTabsBody.define();
ContentTabsHeader.define();

export { ContentTabs, ContentTabsBody, ContentTabsHeader };

type T_HTMLContentTabsElement = typeof ContentTabs.CustomElement;
type T_HTMLContentTabsBodyElement = typeof ContentTabsBody.CustomElement;
type T_HTMLContentTabsHeaderElement = typeof ContentTabsHeader.CustomElement;
declare global {
  interface HTMLContentTabsElement extends T_HTMLContentTabsElement {}
  interface HTMLContentTabsBodyElement extends T_HTMLContentTabsBodyElement {}
  interface HTMLContentTabsHeaderElement extends T_HTMLContentTabsHeaderElement {}
  interface Window {
    HTMLContentTabsElement: HTMLContentTabsElement;
    HTMLContentTabsBodyElement: HTMLContentTabsBodyElement;
    HTMLContentTabsHeaderElement: HTMLContentTabsHeaderElement;
  }
  interface HTMLElementTagNameMap {
    "content-tabs": HTMLContentTabsElement;
    "content-tabs-body": HTMLContentTabsBodyElement;
    "content-tabs-header": HTMLContentTabsHeaderElement;
  }
}
export type {
  HTMLContentTabsBodyElement,
  HTMLContentTabsElement,
  HTMLContentTabsHeaderElement,
};
