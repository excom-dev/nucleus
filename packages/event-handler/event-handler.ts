import {
  attributesToEntries,
  attributesToObject,
  Converter,
  dashToCamel,
  selectOne,
  setAttr,
} from "@excom/kit-utils";
import { formToJson } from "@excom/kit-utils";
import { ListenableElement } from "@excom/listenable-element";
import { Neutron, TokenList } from "@excom/neutron";

const attrFormatters = {
  event: (attr: Attr): [string, string] => [
    dashToCamel(attr.name.replace("detail-", "")),
    attr.value,
  ],
  mutate: (attr: Attr): [string, string] => [
    attr.name.replace("attr-", ""),
    attr.value,
  ],
};

/**
 * Declarative bridge between DOM events and app actions. Listens (default
 * `click`) and either fires custom events or invokes commands — built-in
 * verbs (`show-modal`, `toggle-popover`) and the `--verb` commands elements
 * handle — on any `target-ref` selector, where a `<button commandfor>` needs
 * an id. Event payload comes from `detail-*` attributes and an optional
 * `<form>` via `form-ref`.
 *
 * @summary Rewire clicks / inputs into events or commands.
 *
 * @example
 * <event-handler fire-event="cart-add" detail-sku="sku-1">
 *   Add to cart
 * </event-handler>
 */
export const EventHandler = Neutron.compose([
  ListenableElement,
  Neutron({
    tag: "event-handler",
    props: {
      /**
       * @option
       * Where outgoing events / mutations / commands apply. Unset = this
       * element. Supports `:scope` for relative targeting (e.g.
       * `:scope ~ dialog`).
       * @values <CSS Selector>
       */
      targetRef: String,
      /**
       * @option
       * Space-separated event names to dispatch on the target. Each name
       * gets the same merged `detail`. Ignored when `mutate-target` is set.
       * Pair with `detail-*` attributes for static detail fields.
       * @values <EventName>…
       */
      fireEvent: TokenList,
      /**
       * @option
       * Space-separated commands to invoke on the target: custom `--verb`
       * commands (`--submit`, `--close`) dispatch a `command` event, as a
       * `<button command commandfor>` would; built-in verbs (`show-modal`,
       * `close`, `toggle-popover`) run through the platform.
       * @values <command>…
       */
      commandName: TokenList,
      /**
       * @option
       * Outgoing events use `bubbles: false` (default: bubble).
       */
      notBubbles: Boolean,
      /**
       * @option
       * Outgoing events use `cancelable: false` (default: cancelable).
       */
      notCancelable: Boolean,
      /**
       * @option
       * Outgoing events use `composed: false` (default: composed / cross
       * shadow roots).
       */
      notComposed: Boolean,
      /**
       * @option
       * `<form>` whose fields merge into event `detail`, or become
       * attributes when `mutate-target` is set.
       * @values <CSS Selector>
       */
      formRef: String,
      /**
       * @option
       * @deprecated Write attributes on the target instead of firing events
       * (sources: `attr-*` on this element plus `form-ref` fields). Use a
       * Quark `@on <event> { … }` block instead — it writes State from the
       * event without one element mutating another. Kept for
       * compatibility; will be removed in a future major.
       */
      mutateTarget: Boolean,
    },
  }),
])
  .defineMethods({
    actionHandler: (element) => {
      const target = (
        element.targetRef
          ? selectOne(element.targetRef, {
              scope: element,
            })
          : element
      ) as HTMLElement;
      /* `form-ref` → its values; `{}` unless it resolves to a `<form>` */
      const formValues = (): Record<string, unknown> => {
        const form = element.formRef
          ? selectOne(element.formRef, { scope: element })
          : null;
        return form instanceof HTMLFormElement ? formToJson(form) : {};
      };
      if (
        element.mutateTarget &&
        target instanceof HTMLElement &&
        target !== element
      ) {
        const formData = formValues();
        [
          ...Object.entries(formData || {}),
          ...attributesToEntries(
            element.attributes,
            "attr-",
            attrFormatters.mutate
          ),
        ].forEach(([key, value]) => {
          const v = Converter.type(typeof value)?.prop.convert(value);
          setAttr(target, key, v !== undefined ? v : value);
        });
      } else if (element.fireEvent?.length || element.commandName?.length) {
        const { detail, ...otherFormData }: Record<string, unknown> =
          formValues();
        const detailObj = {
          ...(detail || {}),
          ...attributesToObject(
            element.attributes,
            "detail-",
            attrFormatters.event
          ),
        };
        return [
          ...(element.commandName || [])?.map((commandName) => ({
            command: [commandName, { target }],
          })),
          ...(element.fireEvent || [])?.map((eventName) => ({
            emit: [
              eventName,
              {
                bubbles: !element.notBubbles,
                cancelable: !element.notCancelable,
                composed: !element.notComposed,
                ...(Object.keys(otherFormData || {}).length
                  ? otherFormData
                  : {}),
                ...(Object.keys(detailObj).length ? { detail: detailObj } : {}),
                target,
              },
            ],
          })),
        ];
      }
    },
  })
  .onConnected(
    ({ listenFor, listenForLifecycle, handleEvent, isMoving }) =>
      !isMoving &&
      !listenFor?.length &&
      !listenForLifecycle?.length && {
        addListener: ["click", handleEvent],
      }
  );
