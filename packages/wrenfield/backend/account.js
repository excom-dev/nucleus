const saved = (ctx) => {
  const items = productsBySku(ctx, ctx.state.saved);
  return { count: items.length, items };
};

const addSaved = (ctx) => {
  const { sku } = productWhere(ctx, "sku", ctx.params.sku);
  return { saved: ctx.state.saved.includes(sku) ? ctx.state.saved : [sku, ...ctx.state.saved] };
};

const removeSaved = (ctx) => ({ saved: ctx.state.saved.filter((sku) => sku !== ctx.params.sku) });

const orderView = (order, now) => {
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

const orders = (ctx) => ctx.state.orders.map((order) => orderView(order, ctx.now));
const latestOrder = (ctx) => orders(ctx)[0] ?? fail(404, "There are no orders yet.");
const orderById = (ctx) =>
  orders(ctx).find((order) => order.id === ctx.params.id) ?? fail(404, "We could not find that order.");

const me = (ctx) => ({
  isTrade: ctx.state.session.isTrade,
  bag: bag(ctx),
  saved: saved(ctx),
  orderCount: ctx.state.orders.length,
});

const setTrade = ({ body, state }) => ({
  session: { ...state.session, isTrade: String(body.isTrade ?? state.session.isTrade) === "true" },
});
