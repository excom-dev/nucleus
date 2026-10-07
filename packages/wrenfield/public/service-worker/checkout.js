import { bag } from "./bag.js";
import { CHECKOUT_FIELDS, DELIVERY_OPTIONS, DELIVERY_ZONES, FIRST_ORDER_NUMBER, PAYMENT_OPTIONS } from "./config.js";
import { fail } from "./fail.js";
import { withText } from "./shop.js";

const zoneFor = (postcode) => DELIVERY_ZONES.find((zone) => zone.digits.includes(postcode[0])) ?? DELIVERY_ZONES.at(-1);

const deliveryOptionsFor = (postcode, summary) => {
  const { fees } = zoneFor(postcode);
  return DELIVERY_OPTIONS.map(({ id, name, blurb, eta, unavailableWhen, reason }) => {
    const isAvailable = !summary[unavailableWhen];
    return withText({ id, name, blurb, fee: fees[id], eta, isAvailable, reason: isAvailable ? null : reason }, ["fee"]);
  });
};

const effectiveDelivery = (options, id) =>
  options.find((option) => option.id === id && option.isAvailable) ?? options.find((option) => option.isAvailable);

const missingFields = (draft) =>
  Object.entries(CHECKOUT_FIELDS).flatMap(([section, fields]) =>
    Object.entries(fields)
      .filter(([field, message]) => message && !draft[section][field])
      .map(([field, message]) => ({ field: `${section}.${field}`, message })),
  );

const validate = (draft, deliveryOptions) => {
  const [missing] = missingFields(draft);
  if (missing) fail(422, missing.message, missing.field);
  const delivery = deliveryOptions.find((option) => option.id === draft.delivery);
  if (!delivery) fail(422, "Choose a delivery option.", "delivery");
  if (!delivery.isAvailable) fail(422, `${delivery.name} is not available. ${delivery.reason}`, "delivery");
  if (!PAYMENT_OPTIONS.some((option) => option.id === draft.payment)) fail(422, "Choose a payment method.", "payment");
};

const mergeFields = (fields, stored, patch) =>
  Object.fromEntries(Object.keys(fields).map((field) => [field, String(patch?.[field] ?? stored[field] ?? "").trim()]));

export const checkout = (ctx) => {
  const { contact, address, delivery, payment } = ctx.state.checkout;
  const summary = bag(ctx);
  const deliveryOptions = deliveryOptionsFor(address.postcode, summary);
  const chosen = effectiveDelivery(deliveryOptions, delivery);
  return {
    contact,
    address,
    delivery: chosen.id,
    payment,
    zone: zoneFor(address.postcode).name,
    deliveryOptions,
    paymentOptions: PAYMENT_OPTIONS.map(({ id, name, blurb }) => ({ id, name, blurb })),
    bag: bag(ctx, summary.count ? chosen.fee : 0),
  };
};

export const updateCheckout = (ctx) => {
  const { body, state } = ctx;
  const draft = {
    contact: mergeFields(CHECKOUT_FIELDS.contact, state.checkout.contact, body.contact),
    address: mergeFields(CHECKOUT_FIELDS.address, state.checkout.address, body.address),
    delivery: body.delivery ?? checkout(ctx).delivery,
    payment: body.payment ?? state.checkout.payment,
  };
  validate(draft, deliveryOptionsFor(draft.address.postcode, bag(ctx)));
  return { checkout: draft };
};

export const placeOrder = (ctx) => {
  const { bag: summary, ...draft } = checkout(ctx);
  if (!summary.count) fail(409, "Your bag is empty.");
  validate(draft, draft.deliveryOptions);
  const id = `WF-${FIRST_ORDER_NUMBER + ctx.state.orders.length}`;
  const delivery = draft.deliveryOptions.find((option) => option.id === draft.delivery);
  const payment = PAYMENT_OPTIONS.find((option) => option.id === draft.payment);
  const { items, subtotal, tradeDiscount, deliveryFee, total, dueToday, dueLater } = summary;
  const order = {
    id,
    createdAt: new Date(ctx.now).toISOString(),
    userId: ctx.state.session.userId ?? null,
    contact: draft.contact,
    address: draft.address,
    delivery: { id: delivery.id, name: delivery.name, fee: delivery.fee, eta: delivery.eta },
    payment: { id: payment.id, name: payment.name, instructions: payment.instructions.replace("{id}", id) },
    items: items.map(({ unitPriceText, lineTotalText, ...line }) => ({ ...line, heldUntil: null })),
    subtotal,
    tradeDiscount,
    deliveryFee,
    total,
    dueToday,
    dueLater,
  };
  return {
    orders: [order, ...ctx.state.orders],
    bag: [],
    sold: [...ctx.state.sold, ...items.filter((line) => line.isUnique).map((line) => line.sku)],
  };
};
