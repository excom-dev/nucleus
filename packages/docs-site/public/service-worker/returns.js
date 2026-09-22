/*
 * Mock order for the /nucleus/examples/returns app. Flat item shapes on purpose: the
 * view stamps each item onto its row with `dataset: item`, so every field
 * becomes a data-* fact. The POST re-applies the same rules and answers with
 * a return number.
 */
const ORDER = {
  id: "#48213",
  today: "2026-09-11",
  deliveredDaysAgo: 21,
  items: [
    {
      sku: "SOFA-3S-OAT",
      name: "Linen 3-seater sofa",
      category: "sofa",
      price: 1290,
      memberPrice: 1161,
      weightKg: 68,
      returnWindowDays: 30,
      warrantyDays: 365,
      isFinalSale: false,
      isAssembled: true,
      restockingFeePct: 10,
      refundMember: 1161,
      refundGuest: 1161,
      feeMember: 0,
      feeGuest: 129,
      components: [
        { sku: "SOFA-3S-OAT-BASE", name: "Base frame", weightKg: 40, isAssembled: true, feeMember: 0, feeGuest: 79 },
        { sku: "SOFA-3S-OAT-BACK", name: "Back cushions", weightKg: 9, isAssembled: false, feeMember: 0, feeGuest: 39 },
        { sku: "SOFA-3S-OAT-LEGS", name: "Oak legs, set of 4", weightKg: 3, isAssembled: false, feeMember: 0, feeGuest: 19 },
      ],
    },
    {
      sku: "TABLE-DIN-WAL",
      name: "Walnut dining table",
      category: "table",
      price: 840,
      memberPrice: 756,
      weightKg: 42,
      returnWindowDays: 30,
      warrantyDays: 365,
      isFinalSale: false,
      isAssembled: false,
      restockingFeePct: 10,
      refundMember: 756,
      refundGuest: 756,
      feeMember: 0,
      feeGuest: 84,
      components: [
        { sku: "TABLE-DIN-WAL-TOP", name: "Walnut top", weightKg: 34, isAssembled: false, feeMember: 0, feeGuest: 59 },
        { sku: "TABLE-DIN-WAL-LEG", name: "Leg", weightKg: 2, isAssembled: false, feeMember: 0, feeGuest: 15 },
      ],
    },
    {
      sku: "LAMP-FLR-BRS",
      name: "Brass floor lamp",
      category: "lamp",
      price: 160,
      memberPrice: 144,
      weightKg: 6,
      returnWindowDays: 30,
      warrantyDays: 180,
      isFinalSale: false,
      isAssembled: false,
      restockingFeePct: 0,
      refundMember: 144,
      refundGuest: 160,
      feeMember: 0,
      feeGuest: 16,
    },
    {
      sku: "SHELF-5T-BLK",
      name: "Five-tier bookshelf",
      category: "shelf",
      price: 310,
      memberPrice: 279,
      weightKg: 24,
      returnWindowDays: 14,
      warrantyDays: 365,
      isFinalSale: false,
      isAssembled: true,
      restockingFeePct: 15,
      refundMember: 279,
      refundGuest: 264,
      feeMember: 0,
      feeGuest: 31,
      components: [
        { sku: "SHELF-5T-BLK-SIDE", name: "Side panel", weightKg: 8, isAssembled: false, feeMember: 0, feeGuest: 22 },
        { sku: "SHELF-5T-BLK-TIER", name: "Tier board", weightKg: 2, isAssembled: false, feeMember: 0, feeGuest: 9 },
      ],
    },
    {
      sku: "MATT-Q-FRM",
      name: "Queen foam mattress",
      category: "mattress",
      price: 620,
      memberPrice: 558,
      weightKg: 29,
      returnWindowDays: 100,
      warrantyDays: 3650,
      isFinalSale: true,
      isAssembled: false,
      restockingFeePct: 0,
      refundMember: 558,
      refundGuest: 620,
      feeMember: 0,
      feeGuest: 62,
    },
    {
      sku: "RUG-8X10-IND",
      name: "Hand-knotted rug 8×10",
      category: "rug",
      price: 990,
      memberPrice: 891,
      weightKg: 18,
      returnWindowDays: 30,
      warrantyDays: 14,
      isFinalSale: false,
      isAssembled: false,
      restockingFeePct: 20,
      refundMember: 891,
      refundGuest: 792,
      feeMember: 0,
      feeGuest: 99,
    },
    {
      sku: "CHAIR-DIN-X4",
      name: "Dining chairs, set of 4",
      category: "chair",
      price: 520,
      memberPrice: 468,
      weightKg: 34,
      returnWindowDays: 30,
      warrantyDays: 365,
      isFinalSale: false,
      isAssembled: false,
      restockingFeePct: 10,
      refundMember: 468,
      refundGuest: 468,
      feeMember: 0,
      feeGuest: 52,
    },
  ],
};

const WEEKEND = new Set([0, 6]);
const isWeekend = (isoDate) => WEEKEND.has(new Date(`${isoDate}T00:00:00Z`).getUTCDay());

// Every pickable line, flattened: items plus their components.
const lines = () =>
  ORDER.items.flatMap((item) => [
    { ...item, isBundle: Boolean(item.components), isComponent: false },
    ...(item.components ?? []).map((part) => ({ ...part, isBundle: false, isComponent: true })),
  ]);

/* Re-apply the view's fact rules to the picked lines, then sum the
 * refund (return) or fee (replace). */
export async function handleReturns(request) {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  if (method === "GET" && path === "/api/returns/order") return json(ORDER);
  if (method === "POST" && path === "/api/returns") {
    const body = await request.json().catch(() => ({}));
    const membership = body.membership === "member" ? "member" : "guest";
    const mode = body.mode === "replace" ? "replace" : "return";
    const returnMethod = String(body["return-method"] ?? "home-pickup");
    const date = String(body["pickup-date"] ?? "");
    const picked = lines().filter((line) => body[line.sku]);
    if (!picked.length) return json({ message: "no items selected" }, 400);
    if (mode === "return" && picked.some((line) => line.isComponent)) {
      return json({ message: "components can only be replaced" }, 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ message: "pick a date" }, 400);
    if (returnMethod !== "ups-dropoff" && isWeekend(date)) {
      return json({ message: `${returnMethod.replace("-", " ")} is not available on weekends` }, 400);
    }
    const hasBundle = picked.some((line) => line.isBundle || line.isComponent);
    if (returnMethod === "home-pickup" && membership !== "member" && !hasBundle) {
      return json({ message: "home pickup is for members, or for large items and their parts" }, 400);
    }
    const key = (mode === "replace" ? "fee" : "refund") + (membership === "member" ? "Member" : "Guest");
    const amount = picked.reduce((sum, line) => sum + line[key], 0);
    return json(
      {
        rma: `RMA-${String(Date.now()).slice(-6)}`,
        mode,
        itemCount: picked.length,
        amount,
        method: returnMethod.replace("-", " "),
        date,
      },
      201,
    );
  }
  return json({ message: "not found" }, 404);
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
