import { bag, priceLine } from "./bag.js";
import { SUMMARY_AMOUNTS, TIMELINE } from "./config.js";
import { fail } from "./fail.js";
import { currentUser } from "./passkeys.js";
import { productsBySku, productWhere, withText } from "./shop.js";

export const saved = (ctx) => {
  const items = productsBySku(ctx, ctx.state.saved);
  return { count: items.length, items };
};

export const addSaved = (ctx) => {
  const { sku } = productWhere(ctx, "sku", ctx.params.sku);
  return { saved: ctx.state.saved.includes(sku) ? ctx.state.saved : [sku, ...ctx.state.saved] };
};

export const removeSaved = (ctx) => ({ saved: ctx.state.saved.filter((sku) => sku !== ctx.params.sku) });

const orderView = ({ userId, ...order }, now) => {
  const placedAt = Date.parse(order.createdAt);
  const stages = TIMELINE.map((stage) => ({
    ...stage,
    ...(order.delivery.id === "collect" && stage.collect),
    at: placedAt + stage.afterSeconds * 1000,
  }));
  const current = stages.findLast((stage) => stage.at <= now) ?? stages[0];
  return withText(
    {
      ...order,
      delivery: withText(order.delivery, ["fee"]),
      items: order.items.map(priceLine),
      status: current.id,
      statusLabel: current.label,
      timeline: stages.map(({ id, label, detail, at }) => ({
        id,
        label,
        detail,
        at: at <= now ? new Date(at).toISOString() : null,
        isDone: at <= now,
        isCurrent: id === current.id,
      })),
    },
    SUMMARY_AMOUNTS,
  );
};

// The signed-in user's orders, or the guest's (userId null) when signed out.
const ownOrders = ({ state }) =>
  state.orders.filter((order) => (order.userId ?? null) === (state.session.userId ?? null));
export const orders = (ctx) => ownOrders(ctx).map((order) => orderView(order, ctx.now));
export const latestOrder = (ctx) => orders(ctx)[0] ?? fail(404, "There are no orders yet.");
export const orderById = (ctx) =>
  orders(ctx).find((order) => order.id === ctx.params.id) ?? fail(404, "We could not find that order.");

export const me = (ctx) => ({
  isTrade: ctx.state.session.isTrade,
  user: currentUser(ctx),
  bag: bag(ctx),
  saved: saved(ctx),
  orderCount: ownOrders(ctx).length,
});

export const setTrade = ({ body, state }) => ({
  session: { ...state.session, isTrade: String(body.isTrade ?? state.session.isTrade) === "true" },
});
