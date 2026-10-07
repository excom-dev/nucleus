import { DEPOSIT_SHARE, HOLD_MINUTES, SUMMARY_AMOUNTS, TRADE_DISCOUNT } from "./config.js";
import { fail } from "./fail.js";
import { allProducts, cents, productWhere, withText } from "./shop.js";

const sum = (numbers) => numbers.reduce((total, n) => total + n, 0);
const holdEnd = (addedAt) => Date.parse(addedAt) + HOLD_MINUTES * 60_000;
export const priceLine = (line) => withText(line, ["unitPrice", "lineTotal"]);

const bagLine = ({ id, sku, finish: finishId, qty, addedAt }, ctx) => {
  const product = allProducts(ctx).find((candidate) => candidate.sku === sku);
  const finish = product?.finishes.find((candidate) => candidate.id === finishId);
  const isLive = product?.isUnique ? !product.isSold && holdEnd(addedAt) > ctx.now : Boolean(finish);
  if (!isLive) return null;
  const { slug, href, name, image, isUnique, delivery } = product;
  const unitPrice = finish?.prices.price ?? product.price;
  return priceLine({
    id,
    sku,
    slug,
    href,
    name,
    image,
    isUnique,
    finish: finish ? { id: finish.id, name: finish.name, swatch: finish.swatch } : null,
    qty,
    unitPrice,
    lineTotal: unitPrice * qty,
    leadWeeks: finish?.leadWeeks ?? null,
    heldUntil: isUnique ? new Date(holdEnd(addedAt)).toISOString() : null,
    delivery,
  });
};

const liveLines = (ctx) => ctx.state.bag.filter((line) => bagLine(line, ctx));

export const bag = (ctx, deliveryFee = null) => {
  const items = ctx.state.bag.map((line) => bagLine(line, ctx)).filter(Boolean);
  const discount = ctx.state.session.isTrade ? TRADE_DISCOUNT : 0;
  const subtotal = sum(items.map((line) => line.lineTotal));
  const madeToOrder = sum(items.filter((line) => !line.isUnique).map((line) => line.lineTotal));
  const tradeDiscount = cents(subtotal * discount);
  const total = cents(subtotal - tradeDiscount + (deliveryFee ?? 0));
  const dueLater = cents(madeToOrder * (1 - discount) * (1 - DEPOSIT_SHARE));
  const leads = items.map((line) => line.leadWeeks).filter(Boolean);
  return withText(
    {
      count: sum(items.map((line) => line.qty)),
      items,
      subtotal,
      tradeDiscount,
      deliveryFee,
      total,
      dueToday: cents(total - dueLater),
      dueLater,
      needsWhiteGlove: items.some((line) => line.delivery === "white-glove"),
      leadWeeks: leads.length ? Math.max(...leads) : null,
    },
    SUMMARY_AMOUNTS,
  );
};

const quantity = (value, min) => {
  const qty = Number(value);
  return Number.isInteger(qty) && qty >= min ? qty : fail(422, `Enter a quantity of ${min} or more.`, "qty");
};

const finishFor = (product, id) =>
  product.finishes.find((finish) => finish.id === (id || product.finishes[0]?.id)) ??
  fail(422, "Choose one of the finishes on offer.", "finish");

const withQty = (lines, target, qty) =>
  lines.map((line) => (line === target ? { ...line, qty } : line)).filter((line) => line.qty > 0);

export const addLine = (ctx) => {
  const product = productWhere(ctx, "sku", ctx.body.sku);
  const finish = product.isUnique ? null : finishFor(product, ctx.body.finish);
  const id = finish ? `${product.sku}.${finish.id}` : product.sku;
  const lines = liveLines(ctx);
  const existing = lines.find((line) => line.id === id);
  if (product.isSold) fail(409, "Sorry, this piece has been sold.");
  if (product.isUnique && existing) fail(409, "This piece is already in your bag.");
  const qty = product.isUnique ? 1 : quantity(ctx.body.qty ?? 1, 1);
  const added = { id, sku: product.sku, finish: finish?.id ?? null, qty, addedAt: new Date(ctx.now).toISOString() };
  return { bag: existing ? withQty(lines, existing, existing.qty + qty) : [...lines, added] };
};

export const setQty = (ctx) => {
  const lines = liveLines(ctx);
  const line = lines.find(({ id }) => id === ctx.params.lineId) ?? fail(404, "That piece is no longer in your bag.");
  const qty = quantity(ctx.body.qty, 0);
  return { bag: withQty(lines, line, productWhere(ctx, "sku", line.sku).isUnique ? Math.min(qty, 1) : qty) };
};

export const removeLine = (ctx) => ({ bag: liveLines(ctx).filter((line) => line.id !== ctx.params.lineId) });
