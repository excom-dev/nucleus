// Golden master: runs the scenarios and a wide request sweep on a fixed clock and writes every response verbatim.
// node support/tests/backend/golden.mjs <out.txt> [root] (where the catalogue is read); record before and after a
// refactor, the two files must be identical.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorker, ORIGIN, ROOT } from "./worker.mjs";

const [out, root = ROOT] = process.argv.slice(2);
const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const { send, dispatch, travel, runScenario } = loadWorker({ root, now: T0 });
const log = [];

const r = async (method, path, body, raw) => {
  const response = await send(method, path, body, { raw });
  const text = await response.text();
  const sent = raw !== undefined ? `raw:${raw}` : (JSON.stringify(body) ?? "");
  log.push(`> ${method} ${path} ${sent}\n< ${response.status} ${response.headers.get("content-type")}\n${text}\n`);
  return { status: response.status, body: JSON.parse(text) };
};

const summary = await runScenario(r);
log.push(`scenario: ${summary.passed}/${summary.total}\n`);

const { products } = JSON.parse(readFileSync(join(root, "data/catalog.json"), "utf8"));
const categories = [...new Set(products.map((p) => p.category))];
const materials = [...new Set(products.flatMap((p) => p.materials))].toSorted();
const makers = [...new Set(products.map((p) => p.maker))];
const madeToOrder = products.filter((p) => p.era === "contemporary");
const antiques = products.filter((p) => p.era === "antique");
const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined)).toString();

// empty bag everywhere
await r("DELETE", "/demo");
for (const path of ["/me", "/bag", "/checkout", "/home", "/orders", "/orders/latest", "/orders/WF-24001", "/products/"])
  await r("GET", path);
await r("PATCH", "/checkout", { address: { postcode: "55555" } });
await r("PATCH", "/checkout", { delivery: "parcel" });
await r("PATCH", "/session", { isTrade: true });
await r("GET", "/checkout");
await r("PATCH", "/session", { isTrade: false });
await r("POST", "/orders", {});

// listings
for (const category of [undefined, "", ...categories, "spaceships", "constructor", "__proto__"])
  for (const era of [undefined, "", "contemporary", "antique", "medieval", "toString"])
    await r("GET", `/products?${qs({ category, era })}`);
for (const sort of ["featured", "price-asc", "price-desc", "newest", "bogus", "constructor", ""])
  for (const filter of [{}, { era: "antique" }, { category: "lighting" }])
    await r("GET", `/products?${qs({ ...filter, sort })}`);
for (const material of [...materials, "constructor", "unobtainium"]) {
  await r("GET", `/products?${qs({ material })}`);
  await r("GET", `/products?${qs({ material, era: "contemporary", category: "seating" })}`);
}
const queries = [
  "bergere",
  "BERGÈRE",
  "ÉTAGÈRE",
  "vautrin",
  "brass lighting",
  "oak chair",
  "  ",
  "zzz",
  "tresco-sofa",
  "-",
  "a",
  "É",
  "walnut   leather",
  "&",
  "“",
  " ",
  ...makers,
  ...makers.map((m) => m.split(" ")[0].toLowerCase()),
];
for (const q of queries) await r("GET", `/products?${qs({ q })}`);
for (const q of ["oak", "brass"])
  await r("GET", `/products?${qs({ q, category: "tables", era: "antique", sort: "price-desc", priceMax: "9000" })}`);
for (const priceMax of ["0", "-5", "abc", "", "1", "100", "999.5", "1000", "5000", "1e3", "Infinity", "0x10"]) {
  await r("GET", `/products?${qs({ priceMax })}`);
  await r("GET", `/products?${qs({ priceMax, material: "brass" })}`);
}
await r("GET", "/products?category=seating&category=tables&material=oak&material=brass");
await r("GET", "/products?category=%20seating");
await r("GET", "/products?q=%E2%80%9Coak%E2%80%9D&sort=newest");

// product pages and recent views
for (const product of products) await r("GET", `/products/${product.slug}`);
for (const path of [
  "/products/NOT",
  "/products/tresco%2Dsofa",
  "/products/tresco-sofa/",
  "/products/tresco-sofa/extra",
  "/products/%E0%A4%A",
  "/products/Tresco-Sofa",
])
  await r("GET", path);
await r("GET", "/home");

// saved
for (const product of products.slice(0, 12)) await r("PUT", `/saved/${product.sku}`);
for (const product of products.slice(3, 6)) await r("DELETE", `/saved/${product.sku}`);
await r("PUT", `/saved/${products[0].sku}`, { anything: true });
await r("PUT", "/saved/WF-0000");
await r("DELETE", "/saved/WF-0000");
await r("PUT", "/saved/wf-1001");
await r("GET", "/me");

// bag: every product, every finish, quantities, errors
for (const product of madeToOrder) {
  await r("POST", "/bag", { sku: product.sku });
  for (const finish of product.finishes) await r("POST", "/bag", { sku: product.sku, finish: finish.id, qty: 2 });
}
const [chair] = madeToOrder;
for (const qty of [0, -1, 1.5, "2", "abc", null, true, false, [], {}, 1000, "1e1", " 3 ", ""])
  await r("POST", "/bag", { sku: chair.sku, qty });
for (const finish of ["", null, 0, "unknown", madeToOrder[1].finishes[0].id])
  await r("POST", "/bag", { sku: chair.sku, finish });
await r("POST", "/bag", { sku: chair.sku, finish: "unknown", qty: 0 });
await r("POST", "/bag", { sku: "WF-0000", finish: "unknown", qty: 0 });
for (const product of antiques.slice(0, 6)) {
  await r("POST", "/bag", { sku: product.sku, qty: 3, finish: "x" });
  await r("POST", "/bag", { sku: product.sku });
}
const bagNow = (await r("GET", "/bag")).body;
for (const [index, line] of bagNow.items.entries()) {
  const qty = [0, 1, 5, "2", -1, 1.5, null, undefined, "abc", 3][index % 10];
  await r("PATCH", `/bag/${line.id}`, qty === undefined ? {} : { qty });
}
await r("PATCH", "/bag/WF-0000.nothing", { qty: 1 });
await r("PATCH", `/bag/${encodeURIComponent(bagNow.items.at(-1).id)}`, { qty: 2 });
for (const line of bagNow.items.slice(0, 4)) await r("DELETE", `/bag/${line.id}`);
await r("DELETE", "/bag/WF-0000");
for (const isTrade of [true, false, "true", "false", "TRUE", 1, 0, null, "yes", {}])
  await r("PATCH", "/session", { isTrade });
await r("PATCH", "/session", {});
await r("PATCH", "/session", { isTrade: true });
await r("GET", "/bag");
await r("GET", "/me");

// checkout
await r("GET", "/checkout");
for (const postcode of [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "A1B 2C3",
  " 4 ",
  "   ",
  "",
  "٣",
  55501,
  null,
])
  await r("PATCH", "/checkout", { address: { postcode } });
for (const patch of [
  { contact: { name: "  Sam  ", nickname: "x" }, extra: 1 },
  { contact: { name: 42, email: true, phone: 0 } },
  { contact: "a string" },
  { contact: null, address: [] },
  { address: { line2: "" } },
  { address: { line2: null, city: "  " } },
  { address: { region: "" } },
  { address: { country: "" } },
  { address: { line1: "" } },
  { contact: { phone: "" } },
  { contact: { email: "" }, address: { city: "" }, delivery: "teleport", payment: "card" },
  { delivery: "teleport" },
  { delivery: null },
  { delivery: "" },
  { delivery: 5 },
  { delivery: "parcel" },
  { delivery: "white-glove" },
  { delivery: "collect" },
  { payment: "card" },
  { payment: "" },
  { payment: null },
  { payment: "invoice" },
  { payment: "bank-transfer" },
  { delivery: "collect", payment: "invoice", address: { postcode: "80202" } },
])
  await r("PATCH", "/checkout", patch);
await r("GET", "/checkout");

// orders, from several bags and choices
await r("POST", "/orders", {});
const parcelOnly = madeToOrder.find((p) => p.delivery === "parcel");
const whiteGlove = madeToOrder.find((p) => p.delivery === "white-glove");
await r("POST", "/bag", { sku: parcelOnly.sku, qty: 3 });
await r("PATCH", "/checkout", { delivery: "parcel", payment: "invoice", address: { postcode: "30301" } });
await r("GET", "/checkout");
await r("POST", "/orders");
await r("POST", "/bag", { sku: whiteGlove.sku });
await r("POST", "/bag", { sku: antiques[10].sku });
await r("GET", "/checkout");
await r("PATCH", "/session", { isTrade: false });
await r("POST", "/orders", { ignored: true });
await r("POST", "/bag", { sku: antiques[10].sku });
await r("GET", `/products/${antiques[10].slug}`);
await r("GET", "/home");
await r("GET", "/products?era=antique");
await r("POST", "/bag", { sku: antiques[11].sku });
await r("PATCH", "/checkout", { delivery: "collect" });
await r("POST", "/orders");
await r("GET", "/orders");
for (const ms of [0, 19_999, 1, 39_999, 1, 39_999, 1, 49_999, 1, 1_000_000]) {
  await travel(ms);
  await r("GET", "/orders/latest");
  await r("GET", "/orders/WF-24003");
}
await travel(-5_000_000);
await r("GET", "/orders");
await travel(5_000_000);
for (const path of [
  "/orders/WF-24001",
  "/orders/WF-24004",
  "/orders/WF-24005",
  "/orders/wf-24001",
  "/orders/latest/",
  "/orders/",
])
  await r("GET", path);
await r("GET", "/me");

// holds
await r("DELETE", "/demo");
await r("POST", "/bag", { sku: antiques[0].sku });
await travel(15 * 60_000 - 1);
await r("GET", "/bag");
await travel(1);
await r("GET", "/bag");
await r("PATCH", `/bag/${antiques[0].sku}`, { qty: 1 });
await r("DELETE", `/bag/${antiques[0].sku}`);
await r("POST", "/bag", { sku: antiques[0].sku });
await r("POST", "/bag", { sku: chair.sku });
await travel(20 * 60_000);
await r("POST", "/bag", { sku: chair.sku });
await r("GET", "/me");

// routing and bodies
for (const [method, path] of [
  ["GET", "/nope"],
  ["POST", "/me"],
  ["GET", "/me/"],
  ["GET", "//me"],
  ["GET", "/ME"],
  ["HEAD", "/me"],
  ["OPTIONS", "/bag"],
  ["get", "/bag"],
  ["delete", "/saved/WF-1001"],
  ["PUT", "/bag"],
  ["GET", "/saved"],
  ["GET", "/demo"],
  ["GET", "/me?x=1"],
  ["GET", "/products/tresco-sofa?related=0"],
  ["GET", "/"],
  ["GET", "/orders/latest/extra"],
])
  await r(method, path);
for (const raw of ["{bad", "null", "[]", "\"str\"", "5", "true", "", "{\"sku\":\"WF-1001\",\"qty\":2}"])
  await r("POST", "/bag", undefined, raw);
for (const raw of ["{bad", "null", "[]", "\"str\""]) {
  await r("PATCH", "/checkout", undefined, raw);
  await r("PATCH", "/session", undefined, raw);
}
for (const url of [
  `${ORIGIN}/index.html`,
  `${ORIGIN}/api`,
  `${ORIGIN}/apix/me`,
  "https://example.com/api/me",
  `${ORIGIN}/data/catalog.json`,
])
  log.push(`> GET ${url}\n< ${(await dispatch(url, { method: "GET" })) ? "answered" : "left to the network"}\n`);
await r("DELETE", "/demo");
for (const path of ["/me", "/checkout", "/home"]) await r("GET", path);

// catalogue failure is a 503 and is retried on the next request
const outage = { down: true };
const flaky = loadWorker({
  root,
  now: T0,
  fetch: async (url) =>
    outage.down
      ? new Response("gone", { status: 404 })
      : new Response(readFileSync(join(root, new URL(url, ORIGIN).pathname))),
});
for (const down of [true, false]) {
  outage.down = down;
  const response = await flaky.send("GET", "/me");
  const type = response.headers.get("content-type");
  log.push(`> GET /me (catalogue ${down ? "down" : "up"})\n< ${response.status} ${type}\n${await response.text()}\n`);
}

writeFileSync(out, log.join("\n"));
const failures = summary.failed.map((f) => f.name).join("; ");
console.log(`${log.length} entries, scenario ${summary.passed}/${summary.total}${failures && ` FAILED: ${failures}`}`);
