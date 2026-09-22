import { attachDevtools } from "./devtools-hook";
import { NeutronElement } from "./neutron-element";
import { NeutronInternal } from "./neutron-internal";
import { ElementBuilder, OptsConfig } from "./types";
import { compose } from "./utils/element";
import * as DOM from "@excom/kit-utils";

// type RenderRootForConfig<Conf extends OptsConfig> =
//   PickRenderRootTag<Conf> extends HTMLElement ? PickRenderRootTag<Conf> : never;

/*
 * type NeutronStatics = {
 *   DOM: typeof DOM;
 *   compose: typeof compose;
 * };
 */

export function Neutron<CustomTypes, Conf extends OptsConfig>(
  optsConfig: Conf
) {
  // one Internal + one HTMLElement subclass per `Neutron()` call
  class CustomElement extends NeutronElement {}
  class CustomInternal extends NeutronInternal {}
  CustomInternal.setup(optsConfig, CustomElement);

  return CustomInternal as unknown as ElementBuilder<Conf, CustomTypes>;
}

Neutron.DOM = DOM;
Neutron.compose = compose;
Neutron.attachDevtools = attachDevtools;

if (import.meta.env.DEV) {
  // @ts-ignore drop once DevTools / UMD cover this
  window.Neutron = Neutron;
}
