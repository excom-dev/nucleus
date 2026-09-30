// Catalog-agnostic end-to-end checks for the Wrenfield mock API.
// api(method, path, body) -> { status, body, ms }; travel(ms) moves every hold and order ms into the past.
async function scenario(api, travel) {
  const results = [];
  const check = (name, ok, info) => results.push(ok ? { name, ok: true } : { name, ok: false, info });
  const near = (a, b) => Math.abs(a - b) < 0.005;
  const round2 = (n) => Math.round(n * 100) / 100;
  const sumOf = (list, key) => list.reduce((t, x) => t + x[key], 0);
  const isError = (r, status) =>
    r.status === status && typeof r.body?.message === "string" && r.body.message.length > 0;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const usd = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    trailingZeroDisplay: "stripIfInteger",
  });
  const fmt = (n) => (n === null ? null : usd.format(n));
  const textOk = (o, keys) => keys.every((k) => o[`${k}Text`] === fmt(o[k]));
  const SUMMARY_KEYS = ["subtotal", "tradeDiscount", "deliveryFee", "total", "dueToday", "dueLater"];
  const summaryTextOk = (b) =>
    textOk(b, SUMMARY_KEYS) &&
    b.items.every((l) => textOk(l, ["unitPrice", "lineTotal"])) &&
    SUMMARY_KEYS.every((k) => b[k] === null || Number.isInteger(b[k]) === !b[`${k}Text`].includes("."));

  let r = await api("DELETE", "/demo");
  check("DELETE /demo returns {ok:true}", r.status === 200 && same(r.body, { ok: true }), r);

  r = await api("GET", "/me");
  check(
    "GET /me initial state",
    r.status === 200 &&
      r.body.isTrade === false &&
      r.body.bag.count === 0 &&
      r.body.bag.items.length === 0 &&
      r.body.saved.count === 0 &&
      r.body.orderCount === 0,
    r.body,
  );
  check(
    "Money formatter: whole dollars drop the cents, others keep two places",
    fmt(1200) === "$1,200" && fmt(12.5) === "$12.50" && fmt(0) === "$0",
    [fmt(1200), fmt(12.5), fmt(0)],
  );
  check(
    "GET /me bag has contract keys",
    same(Object.keys(r.body.bag), [
      "count",
      "items",
      "subtotal",
      "subtotalText",
      "tradeDiscount",
      "tradeDiscountText",
      "deliveryFee",
      "deliveryFeeText",
      "total",
      "totalText",
      "dueToday",
      "dueTodayText",
      "dueLater",
      "dueLaterText",
      "needsWhiteGlove",
      "leadWeeks",
    ]),
    Object.keys(r.body.bag),
  );
  check(
    "GET /me empty bag deliveryFee null, leadWeeks null",
    r.body.bag.deliveryFee === null && r.body.bag.leadWeeks === null,
    r.body.bag,
  );
  check(
    "Empty bag: deliveryFeeText null (null amount), other amounts $0",
    r.body.bag.deliveryFeeText === null &&
      r.body.bag.subtotalText === "$0" &&
      r.body.bag.totalText === "$0" &&
      r.body.bag.tradeDiscountText === "$0" &&
      r.body.bag.dueTodayText === "$0" &&
      r.body.bag.dueLaterText === "$0",
    r.body.bag,
  );
  r = await api("GET", "/checkout");
  check(
    "GET /checkout empty bag charges no delivery (fee and total 0), options keep their fees",
    r.status === 200 &&
      r.body.bag.count === 0 &&
      r.body.bag.deliveryFee === 0 &&
      r.body.bag.total === 0 &&
      r.body.bag.dueToday === 0 &&
      r.body.bag.dueLater === 0 &&
      r.body.deliveryOptions.find((o) => o.id === r.body.delivery).fee > 0,
    r.body.bag,
  );
  check(
    "Empty checkout: deliveryFeeText and totalText are $0 (zero amount, not null)",
    r.body.bag.deliveryFeeText === "$0" && r.body.bag.totalText === "$0" && summaryTextOk(r.body.bag),
    r.body.bag,
  );

  // ---------------------------------------------------------------- listing
  const all = (await api("GET", "/products")).body;
  const products = all.items;
  check("GET /products all", all.total === products.length && products.length > 0 && all.title === "All pieces", {
    title: all.title,
    total: all.total,
  });
  const derivedOk = products.every(
    (p) =>
      p.href === `/shop/${p.category}/${p.slug}` &&
      typeof p.categoryName === "string" &&
      typeof p.eraName === "string" &&
      p.isUnique === (p.era === "antique") &&
      p.isSold === false &&
      near(p.tradePrice, round2(p.price * 0.85)),
  );
  check(
    "Every product has priceText and tradePriceText next to its amounts",
    products.every(
      (p) =>
        textOk(p, ["price", "tradePrice"]) &&
        Object.keys(p).indexOf("priceText") === Object.keys(p).indexOf("price") + 1 &&
        Object.keys(p).indexOf("tradePriceText") === Object.keys(p).indexOf("tradePrice") + 1,
    ),
    products.map((p) => [p.sku, p.priceText, p.tradePriceText]),
  );
  const pricedFinishes = products.flatMap((p) => p.finishes.map((f) => [p, f]));
  check(
    "Each finish has priceDeltaText and prices { price, priceText, tradePrice, tradePriceText } " +
      "for the piece in that finish",
    pricedFinishes.length > 0 &&
      pricedFinishes.some(([, f]) => f.priceDelta > 0) &&
      pricedFinishes.every(
        ([p, f]) =>
          f.priceDeltaText === fmt(f.priceDelta) &&
          same(Object.keys(f.prices), ["price", "priceText", "tradePrice", "tradePriceText"]) &&
          f.prices.price === p.price + f.priceDelta &&
          near(f.prices.tradePrice, round2(f.prices.price * 0.85)) &&
          textOk(f.prices, ["price", "tradePrice"]),
      ),
    pricedFinishes.map(([p, f]) => [p.sku, f.id, f.priceDelta, f.prices]),
  );
  check(
    "Antiques have no finishes, made-to-order pieces have some",
    products.every((p) => (p.isUnique ? p.finishes.length === 0 : p.finishes.length > 0)),
    products.map((p) => [p.sku, p.finishes.length]),
  );
  check(
    "Product derived fields (href, categoryName, eraName, isUnique, isSold, tradePrice)",
    derivedOk,
    products.map((p) => [p.sku, p.href, p.categoryName, p.eraName, p.isUnique, p.isSold, p.tradePrice]),
  );
  const featuredSorted = products.every((p, i) => i === 0 || !(p.isFeatured && !products[i - 1].isFeatured));
  check("Default sort is featured first", featuredSorted, products.map((p) => p.isFeatured));

  const categories = [...new Set(products.map((p) => p.category))];
  for (const category of categories) {
    r = await api("GET", `/products?category=${category}`);
    check(
      `?category=${category} filters and titles`,
      r.status === 200 &&
        r.body.items.length > 0 &&
        r.body.items.every((p) => p.category === category) &&
        r.body.title === r.body.items[0].categoryName &&
        r.body.total === products.filter((p) => p.category === category).length,
      { title: r.body.title, total: r.body.total },
    );
  }
  r = await api("GET", "/products?category=spaceships");
  check("Unknown category -> 404 {message}", isError(r, 404), r);
  r = await api("GET", "/products?category=");
  check("Empty category means all", r.status === 200 && r.body.total === products.length, r.body.total);
  r = await api("GET", "/products?era=antique");
  check(
    "?era=antique filters and titles Antiques",
    r.status === 200 &&
      r.body.items.every((p) => p.era === "antique") &&
      r.body.title === "Antiques" &&
      r.body.total === products.filter((p) => p.era === "antique").length,
    { title: r.body.title, total: r.body.total },
  );
  r = await api("GET", "/products?era=contemporary");
  check(
    "?era=contemporary",
    r.status === 200 && r.body.items.every((p) => p.era === "contemporary") && r.body.title === "Contemporary",
    r.body.title,
  );
  r = await api("GET", "/products?era=medieval");
  check("Unknown era -> 404", isError(r, 404), r);
  const antiqueSample = products.find((p) => p.era === "antique");
  if (antiqueSample) {
    r = await api("GET", `/products?category=${antiqueSample.category}&era=antique`);
    check("category+era title", r.body.title === `Antique ${antiqueSample.categoryName.toLowerCase()}`, r.body.title);
  }

  const material = products[0].materials[0];
  r = await api("GET", `/products?material=${material}`);
  check(
    `?material=${material}`,
    r.status === 200 &&
      r.body.items.length > 0 &&
      r.body.items.every((p) => p.materials.includes(material)) &&
      r.body.total === products.filter((p) => p.materials.includes(material)).length,
    r.body.total,
  );
  const facetMaterial = all.facets.materials.find((m) => m.slug === material);
  check("Facet count matches material filter", facetMaterial?.count === r.body.total, {
    facetMaterial,
    total: r.body.total,
  });
  check(
    "Facet materials have slug/name/count, sorted by name",
    all.facets.materials.every((m) => m.slug && m.name && m.count > 0) &&
      all.facets.materials.every((m, i, list) => i === 0 || list[i - 1].name.localeCompare(m.name) <= 0),
    all.facets.materials,
  );
  check(
    "Facet eras cover every product",
    sumOf(all.facets.eras, "count") === products.length &&
      same(all.facets.eras.map((e) => e.slug), ["contemporary", "antique"]),
    all.facets.eras,
  );
  r = await api("GET", "/products?era=antique");
  const antiqueEraFacet = r.body.facets.eras.find((e) => e.slug === "contemporary");
  check(
    "Era facet is disjunctive (other era still counted)",
    antiqueEraFacet?.count === products.filter((p) => p.era === "contemporary").length,
    r.body.facets.eras,
  );
  r = await api("GET", `/products?material=${material}`);
  check(
    "Material facet is disjunctive (other materials still listed)",
    r.body.facets.materials.length === all.facets.materials.length,
    r.body.facets.materials.length,
  );

  const maker = products[0].maker;
  r = await api("GET", `/products?q=${encodeURIComponent(maker.toUpperCase())}`);
  check(
    "q matches maker case-insensitively",
    r.body.items.some((p) => p.sku === products[0].sku) && r.body.title === `Results for “${maker.toUpperCase()}”`,
    { title: r.body.title, total: r.body.total },
  );
  r = await api("GET", `/products?q=${encodeURIComponent(material.toUpperCase())}`);
  check("q matches material", r.body.items.some((p) => p.materials.includes(material)), r.body.total);
  const nameWord = products[0].name.split(" ").at(-1);
  r = await api("GET", `/products?q=${encodeURIComponent(nameWord.toLowerCase())}`);
  check("q matches name", r.body.items.some((p) => p.sku === products[0].sku), r.body.total);
  r = await api("GET", `/products?q=${encodeURIComponent(products[0].categoryName.toLowerCase())}`);
  check("q matches category", r.body.items.some((p) => p.sku === products[0].sku), r.body.total);
  r = await api("GET", `/products?q=${encodeURIComponent(`${nameWord} ${material}`)}`);
  check("q with two terms matches across fields", r.body.items.some((p) => p.sku === products[0].sku), r.body.total);
  const fold = (text) => text.normalize("NFD").replace(/\p{M}/gu, "");
  const accented = products.find((p) => fold(p.name) !== p.name);
  if (accented) {
    const word = accented.name.split(" ").find((w) => fold(w) !== w);
    r = await api("GET", `/products?q=${encodeURIComponent(fold(word).toLowerCase())}`);
    check(
      `q is accent-insensitive: "${fold(word).toLowerCase()}" finds ${accented.name}`,
      r.body.items.some((p) => p.sku === accented.sku),
      r.body.items.map((p) => p.name),
    );
    r = await api("GET", `/products?q=${encodeURIComponent(word.toUpperCase())}`);
    check(
      `q with accents: "${word.toUpperCase()}" finds ${accented.name}`,
      r.body.items.some((p) => p.sku === accented.sku),
      r.body.items.map((p) => p.name),
    );
  }
  const accentedMaterial = material.replace(/[aeiou]/, (v) => ({ a: "à", e: "é", i: "î", o: "ô", u: "ü" })[v]);
  r = await api("GET", `/products?q=${encodeURIComponent(accentedMaterial)}`);
  check(
    "accented query matches plain haystack",
    r.body.items.some((p) => p.materials.includes(material)),
    r.body.total,
  );
  r = await api("GET", "/products?q=zzzqqq");
  check("q with no match -> 0", r.status === 200 && r.body.total === 0 && r.body.items.length === 0, r.body.total);
  r = await api("GET", "/products?q=%20%20");
  check("blank q means all", r.body.total === products.length && r.body.title === "All pieces", r.body.title);

  const asc = (await api("GET", "/products?sort=price-asc")).body.items;
  check("sort=price-asc", asc.every((p, i) => i === 0 || asc[i - 1].price <= p.price), asc.map((p) => p.price));
  const desc = (await api("GET", "/products?sort=price-desc")).body.items;
  check("sort=price-desc", desc.every((p, i) => i === 0 || desc[i - 1].price >= p.price), desc.map((p) => p.price));
  const newest = (await api("GET", "/products?sort=newest")).body.items;
  check(
    "sort=newest puts isNew first",
    newest.every((p, i) => i === 0 || !(p.isNew && !newest[i - 1].isNew)),
    newest.map((p) => p.isNew),
  );
  r = await api("GET", "/products?sort=bogus");
  check("unknown sort falls back to featured", same(r.body.items.map((p) => p.sku), products.map((p) => p.sku)), null);
  const prices = products.map((p) => p.price).toSorted((a, b) => a - b);
  const cap = prices[Math.floor(prices.length / 2)];
  r = await api("GET", `/products?priceMax=${cap}`);
  check(
    "priceMax caps list price",
    r.body.items.every((p) => p.price <= cap) && r.body.total === products.filter((p) => p.price <= cap).length,
    { cap, total: r.body.total },
  );
  r = await api("GET", "/products?priceMax=0");
  check("priceMax=0 means no cap", r.body.total === products.length, r.body.total);
  r = await api("GET", "/products?priceMax=abc");
  check("priceMax=abc means no cap", r.body.total === products.length, r.body.total);

  // ---------------------------------------------------------------- product page + recent
  const [first, second] = products;
  r = await api("GET", `/products/${first.slug}`);
  check(
    "GET /products/:slug returns Product + related",
    r.status === 200 &&
      r.body.sku === first.sku &&
      Array.isArray(r.body.related) &&
      r.body.related.length <= 4 &&
      r.body.related.every((p) => p.sku !== first.sku && p.href),
    { related: r.body.related?.map((p) => p.sku) },
  );
  check(
    "Product page and its related pieces carry the same priced fields as the listing",
    same(r.body.finishes, first.finishes) &&
      textOk(r.body, ["price", "tradePrice"]) &&
      r.body.related.every((p) => textOk(p, ["price", "tradePrice"])),
    r.body,
  );
  r = await api("GET", "/products/not-a-real-piece");
  check("Unknown slug -> 404", isError(r, 404), r);
  await api("GET", `/products/${second.slug}`);
  await api("GET", `/products/${first.slug}`);
  r = await api("GET", "/home");
  check(
    "Recently viewed: most recent first, deduped",
    same(r.body.recent.map((p) => p.sku), [first.sku, second.sku]),
    r.body.recent.map((p) => p.sku),
  );

  // ---------------------------------------------------------------- home
  const homeBody = r.body;
  check(
    "home.hero is a featured, available product",
    homeBody.hero && homeBody.hero.isFeatured && !homeBody.hero.isSold,
    homeBody.hero?.sku,
  );
  check(
    "Every home product has priceText and tradePriceText",
    [homeBody.hero, ...homeBody.featured, ...homeBody.arrivals, ...homeBody.antiques, ...homeBody.recent].every((p) =>
      textOk(p, ["price", "tradePrice"]),
    ),
    null,
  );
  check(
    "home.featured excludes hero",
    homeBody.featured.every((p) => p.isFeatured && p.sku !== homeBody.hero.sku),
    homeBody.featured.map((p) => p.sku),
  );
  check("home.arrivals are isNew", homeBody.arrivals.every((p) => p.isNew), homeBody.arrivals.map((p) => p.sku));
  check(
    "home.antiques are unique",
    homeBody.antiques.every((p) => p.isUnique && !p.isSold),
    homeBody.antiques.map((p) => p.sku),
  );
  const railSkus = [homeBody.hero, ...homeBody.featured, ...homeBody.arrivals, ...homeBody.antiques].map((p) => p.sku);
  check(
    "home rails never repeat a piece and hold at most 8",
    new Set(railSkus).size === railSkus.length &&
      [homeBody.featured, homeBody.arrivals, homeBody.antiques].every((rail) => rail.length <= 8),
    railSkus,
  );
  const leadCategories = homeBody.antiques.slice(0, 3).map((p) => p.category);
  const antiqueCategories = new Set(
    products
      .filter((p) => p.isUnique && !railSkus.slice(0, -homeBody.antiques.length || undefined).includes(p.sku))
      .map((p) => p.category),
  );
  check(
    "home rails mix categories",
    antiqueCategories.size < 2 || new Set(leadCategories).size === Math.min(3, antiqueCategories.size),
    leadCategories,
  );
  for (const collection of homeBody.collections) {
    const hasKeys = ["slug", "name", "blurb", "image", "href", "count"].every((k) => k in collection);
    const [pathPart, queryPart] = collection.href.split("?");
    const listingUrl = pathPart.startsWith("/shop/")
      ? `/products?category=${pathPart.slice(6)}`
      : `/products?${queryPart ?? ""}`;
    const listed = (await api("GET", listingUrl)).body;
    check(`collection ${collection.slug} href/count match listing`, hasKeys && listed.total === collection.count, {
      collection,
      listed: listed.total,
      listingUrl,
    });
  }

  // ---------------------------------------------------------------- saved
  r = await api("PUT", `/saved/${first.sku}`, {});
  check("PUT /saved/:sku", r.status === 200 && r.body.count === 1 && r.body.items[0].sku === first.sku, r.body);
  r = await api("PUT", `/saved/${first.sku}`);
  check("PUT /saved idempotent (no body)", r.body.count === 1, r.body.count);
  r = await api("PUT", `/saved/${second.sku}`, {});
  check(
    "Saved newest first",
    same(r.body.items.map((p) => p.sku), [second.sku, first.sku]) && r.body.count === 2,
    r.body.items.map((p) => p.sku),
  );
  r = await api("DELETE", `/saved/${second.sku}`);
  check("DELETE /saved/:sku", r.body.count === 1 && r.body.items[0].sku === first.sku, r.body);
  r = await api("DELETE", `/saved/${second.sku}`);
  check("DELETE /saved idempotent", r.status === 200 && r.body.count === 1, r);
  r = await api("PUT", "/saved/WF-0000");
  check("PUT unknown sku -> 404", isError(r, 404), r);
  const savedNow = r = await api("GET", "/me");
  check(
    "/me.saved composes the saved view",
    savedNow.body.saved.count === 1 && savedNow.body.saved.items[0].sku === first.sku,
    savedNow.body.saved,
  );
  check(
    "Saved products carry priceText and tradePriceText",
    savedNow.body.saved.items.every((p) => textOk(p, ["price", "tradePrice"])),
    savedNow.body.saved,
  );

  // ---------------------------------------------------------------- bag
  const madeToOrder =
    products.find((p) => p.era === "contemporary" && p.finishes.length > 1 && p.delivery === "white-glove") ??
    products.find((p) => p.era === "contemporary" && p.finishes.length > 1);
  const parcelPiece = products.find(
    (p) => p.era === "contemporary" && p.delivery === "parcel" && p.sku !== madeToOrder.sku,
  );
  const antique = products.find((p) => p.era === "antique");
  const [finishA, finishB] = madeToOrder.finishes;

  r = await api("POST", "/bag", { sku: madeToOrder.sku });
  const lineA = r.body.items?.[0];
  check(
    "POST /bag made-to-order -> 201 default finish",
    r.status === 201 &&
      r.body.count === 1 &&
      lineA.id === `${madeToOrder.sku}.${finishA.id}` &&
      lineA.unitPrice === madeToOrder.price + finishA.priceDelta &&
      lineA.leadWeeks === finishA.leadWeeks &&
      lineA.heldUntil === null &&
      lineA.isUnique === false &&
      lineA.delivery === madeToOrder.delivery &&
      lineA.finish.id === finishA.id &&
      lineA.finish.swatch === finishA.swatch &&
      lineA.href === madeToOrder.href &&
      lineA.slug === madeToOrder.slug &&
      lineA.name === madeToOrder.name &&
      lineA.image === madeToOrder.image,
    r,
  );
  check(
    "BagLine has contract keys",
    same(Object.keys(lineA), [
      "id",
      "sku",
      "slug",
      "href",
      "name",
      "image",
      "isUnique",
      "finish",
      "qty",
      "unitPrice",
      "unitPriceText",
      "lineTotal",
      "lineTotalText",
      "leadWeeks",
      "heldUntil",
      "delivery",
    ]),
    Object.keys(lineA),
  );
  check(
    "Bag line unit price is the finish's prices.price, with its text",
    lineA.unitPrice === finishA.prices.price &&
      lineA.unitPriceText === finishA.prices.priceText &&
      textOk(lineA, ["unitPrice", "lineTotal"]),
    { lineA, prices: finishA.prices },
  );
  r = await api("POST", "/bag", { sku: madeToOrder.sku, finish: finishA.id, qty: 2 });
  check(
    "POST same line increments qty",
    r.status === 201 &&
      r.body.items.length === 1 &&
      r.body.items[0].qty === 3 &&
      r.body.items[0].lineTotal === 3 * (madeToOrder.price + finishA.priceDelta),
    r.body.items,
  );
  r = await api("POST", "/bag", { sku: madeToOrder.sku, finish: finishB.id });
  const lineB = r.body.items?.find((l) => l.id === `${madeToOrder.sku}.${finishB.id}`);
  check(
    "POST other finish is a separate line with its price and lead",
    r.status === 201 &&
      r.body.items.length === 2 &&
      lineB &&
      lineB.unitPrice === madeToOrder.price + finishB.priceDelta &&
      lineB.leadWeeks === finishB.leadWeeks,
    r.body.items,
  );
  check(
    "Bag leadWeeks is the longest lead",
    r.body.leadWeeks === Math.max(finishA.leadWeeks, finishB.leadWeeks),
    r.body.leadWeeks,
  );
  check(
    "Other finish: line unit price is that finish's prices.price, texts follow",
    lineB.unitPrice === finishB.prices.price &&
      lineB.unitPriceText === finishB.prices.priceText &&
      summaryTextOk(r.body),
    { lineB, prices: finishB.prices },
  );
  r = await api("POST", "/bag", { sku: madeToOrder.sku, finish: "unobtainium" });
  check("POST unknown finish -> 422 field finish", isError(r, 422) && r.body.field === "finish", r);
  r = await api("POST", "/bag", { sku: madeToOrder.sku, qty: 0 });
  check("POST qty 0 -> 422", isError(r, 422) && r.body.field === "qty", r);
  r = await api("POST", "/bag", { sku: madeToOrder.sku, qty: 1.5 });
  check("POST qty 1.5 -> 422", isError(r, 422), r);
  r = await api("POST", "/bag", { sku: "WF-0000" });
  check("POST unknown sku -> 404", isError(r, 404), r);
  r = await api("POST", "/bag", {});
  check("POST without sku -> 404", isError(r, 404), r);

  const beforeAntique = Date.now();
  r = await api("POST", "/bag", { sku: antique.sku, qty: 3, finish: "whatever" });
  const antiqueLine = r.body.items?.find((l) => l.sku === antique.sku);
  const heldFor = antiqueLine ? Date.parse(antiqueLine.heldUntil) - beforeAntique : null;
  check(
    "POST unique piece -> qty 1, no finish, held 15 minutes",
    r.status === 201 &&
      antiqueLine.id === antique.sku &&
      antiqueLine.qty === 1 &&
      antiqueLine.finish === null &&
      antiqueLine.leadWeeks === null &&
      antiqueLine.isUnique === true &&
      heldFor > 14.9 * 60000 &&
      heldFor <= 15 * 60000 + 5000,
    { antiqueLine, heldFor },
  );
  r = await api("POST", "/bag", { sku: antique.sku });
  check("POST unique piece twice -> 409", isError(r, 409), r);

  r = await api("PATCH", `/bag/${antique.sku}`, { qty: 5 });
  check(
    "PATCH unique qty stays 1",
    r.status === 200 && r.body.items.find((l) => l.sku === antique.sku).qty === 1,
    r.body.items,
  );
  r = await api("PATCH", `/bag/${lineA.id}`, { qty: 4 });
  check("PATCH made-to-order qty 4", r.body.items.find((l) => l.id === lineA.id).qty === 4, r.body.items);
  r = await api("patch", `/bag/${lineA.id}`, { qty: -1 });
  check("PATCH qty -1 -> 422 (lowercase method routed)", isError(r, 422), r);
  r = await api("PATCH", "/bag/WF-0000.nothing", { qty: 1 });
  check("PATCH unknown line -> 404", isError(r, 404), r);
  r = await api("PATCH", `/bag/${lineB.id}`, { qty: 0 });
  check("PATCH qty 0 removes the line", r.body.items.every((l) => l.id !== lineB.id), r.body.items.map((l) => l.id));

  if (parcelPiece) await api("POST", "/bag", { sku: parcelPiece.sku });
  r = await api("GET", "/bag");
  let summary = r.body;
  const mto = summary.items.filter((l) => !l.isUnique);
  check(
    "Bag subtotal and count",
    summary.subtotal === sumOf(summary.items, "lineTotal") && summary.count === sumOf(summary.items, "qty"),
    summary,
  );
  check(
    "Bag without delivery: deliveryFee null, total = subtotal",
    summary.deliveryFee === null && summary.tradeDiscount === 0 && near(summary.total, summary.subtotal),
    summary,
  );
  check(
    "Bag without delivery: deliveryFeeText null, totalText and every amount text match",
    summary.deliveryFeeText === null && summary.totalText === fmt(summary.total) && summaryTextOk(summary),
    summary,
  );
  check(
    "Deposit: dueLater = 50% of made-to-order",
    near(summary.dueLater, round2(sumOf(mto, "lineTotal") * 0.5)) &&
      near(summary.dueToday + summary.dueLater, summary.total),
    summary,
  );
  check(
    "needsWhiteGlove reflects lines",
    summary.needsWhiteGlove === summary.items.some((l) => l.delivery === "white-glove"),
    summary.needsWhiteGlove,
  );
  const meNow = (await api("GET", "/me")).body;
  check("/me.bag equals GET /bag", same(meNow.bag, summary), null);

  r = await api("PATCH", "/session", { isTrade: true });
  check(
    "PATCH /session returns /me shape with isTrade",
    r.status === 200 && r.body.isTrade === true && "bag" in r.body && "saved" in r.body && "orderCount" in r.body,
    r.body,
  );
  summary = r.body.bag;
  check(
    "Trade: 15% off subtotal",
    near(summary.tradeDiscount, round2(summary.subtotal * 0.15)) &&
      near(summary.total, summary.subtotal - summary.tradeDiscount),
    summary,
  );
  check(
    "Trade: discount and total texts follow the amounts",
    summary.tradeDiscount > 0 &&
      summary.tradeDiscountText === fmt(summary.tradeDiscount) &&
      summary.totalText === fmt(summary.total) &&
      summaryTextOk(summary),
    summary,
  );
  check(
    "Trade: deposit on discounted made-to-order",
    near(summary.dueLater, round2(sumOf(mto, "lineTotal") * 0.85 * 0.5)) &&
      near(summary.dueToday + summary.dueLater, summary.total),
    summary,
  );
  r = await api("PATCH", "/session", {});
  check("PATCH /session {} keeps trade", r.body.isTrade === true, r.body.isTrade);
  r = await api("PATCH", "/session", { isTrade: "false" });
  check("PATCH /session 'false' string turns trade off", r.body.isTrade === false, r.body.isTrade);
  await api("PATCH", "/session", { isTrade: true });

  // ---------------------------------------------------------------- checkout
  r = await api("GET", "/checkout");
  let co = r.body;
  check(
    "Checkout seeded with fictional demo details",
    r.status === 200 &&
      co.contact.email.endsWith("@example.com") &&
      /555-01\d\d/.test(co.contact.phone) &&
      co.contact.name &&
      co.address.line1 &&
      co.address.city &&
      co.address.region &&
      co.address.postcode &&
      co.address.country,
    co,
  );
  check(
    "Checkout keys",
    same(Object.keys(co), [
      "contact",
      "address",
      "delivery",
      "payment",
      "zone",
      "deliveryOptions",
      "paymentOptions",
      "bag",
    ]),
    Object.keys(co),
  );
  check(
    "Checkout defaults delivery white-glove, payment bank-transfer",
    co.delivery === "white-glove" && co.payment === "bank-transfer",
    co,
  );
  check(
    "Delivery options ids and shape",
    same(co.deliveryOptions.map((o) => o.id), ["parcel", "white-glove", "collect"]) &&
      co.deliveryOptions.every((o) =>
        same(Object.keys(o), ["id", "name", "blurb", "fee", "feeText", "eta", "isAvailable", "reason"]),
      ),
    co.deliveryOptions,
  );
  check(
    "Delivery option feeText: paid fees formatted, collect is $0",
    co.deliveryOptions.every((o) => textOk(o, ["fee"])) &&
      same(co.deliveryOptions.map((o) => o.feeText), ["$35", "$250", "$0"]),
    co.deliveryOptions.map((o) => o.feeText),
  );
  check(
    "Zone from postcode 1xxxx is East",
    co.zone === "East" && same(co.deliveryOptions.map((o) => o.fee), [35, 250, 0]),
    co.deliveryOptions.map((o) => o.fee),
  );
  const parcel = co.deliveryOptions[0];
  check(
    "Parcel unavailable when bag needs white-glove",
    co.bag.needsWhiteGlove
      ? parcel.isAvailable === false && parcel.reason
      : parcel.isAvailable && parcel.reason === null,
    parcel,
  );
  check(
    "Payment options have id/name/blurb only",
    same(co.paymentOptions.map((o) => Object.keys(o)), [
      ["id", "name", "blurb"],
      ["id", "name", "blurb"],
    ]) &&
      same(co.paymentOptions.map((o) => o.id), ["bank-transfer", "invoice"]),
    co.paymentOptions,
  );
  check(
    "Checkout bag carries chosen delivery fee",
    co.bag.deliveryFee === 250 &&
      near(co.bag.total, co.bag.subtotal - co.bag.tradeDiscount + 250) &&
      near(co.bag.dueToday + co.bag.dueLater, co.bag.total),
    co.bag,
  );
  check(
    "Checkout bag: deliveryFeeText $250, totalText follows total",
    co.bag.deliveryFeeText === "$250" && co.bag.totalText === fmt(co.bag.total) && summaryTextOk(co.bag),
    co.bag,
  );

  r = await api("PATCH", "/checkout", { address: { postcode: "94110" } });
  check(
    "PATCH postcode 9xxxx -> West fees, other fields kept",
    r.status === 200 &&
      r.body.zone === "West" &&
      same(r.body.deliveryOptions.map((o) => o.fee), [75, 650, 0]) &&
      r.body.bag.deliveryFee === 650 &&
      r.body.address.city === co.address.city &&
      r.body.address.postcode === "94110",
    r.body,
  );
  r = await api("PATCH", "/checkout", { address: { postcode: "60601" } });
  check("PATCH postcode 6xxxx -> Central", r.body.zone === "Central" && r.body.bag.deliveryFee === 450, r.body.zone);
  r = await api("PATCH", "/checkout", { address: { postcode: "" } });
  check(
    "PATCH empty postcode -> 422 field address.postcode",
    isError(r, 422) && r.body.field === "address.postcode",
    r,
  );
  r = await api("GET", "/checkout");
  check("Rejected PATCH did not change the draft", r.body.address.postcode === "60601", r.body.address);
  r = await api("PATCH", "/checkout", { contact: { name: "   " } });
  check("PATCH blank name -> 422 field contact.name", isError(r, 422) && r.body.field === "contact.name", r);
  r = await api("PATCH", "/checkout", { contact: { email: "" } });
  check("PATCH empty email -> 422", isError(r, 422) && r.body.field === "contact.email", r);
  r = await api("PATCH", "/checkout", { address: { line2: "" } });
  check("PATCH empty line2 is allowed", r.status === 200 && r.body.address.line2 === "", r);
  r = await api("PATCH", "/checkout", {
    contact: { name: "  Sam Rivers  ", nickname: "x" },
    address: { line1: "3 Birch Row" },
    extra: 1,
  });
  check(
    "PATCH trims, merges partial sections, drops unknown fields",
    r.status === 200 &&
      r.body.contact.name === "Sam Rivers" &&
      !("nickname" in r.body.contact) &&
      r.body.contact.email === co.contact.email &&
      r.body.address.line1 === "3 Birch Row",
    r.body.contact,
  );
  if (co.bag.needsWhiteGlove) {
    r = await api("PATCH", "/checkout", { delivery: "parcel" });
    check(
      "PATCH parcel while white-glove needed -> 422 field delivery",
      isError(r, 422) && r.body.field === "delivery",
      r,
    );
  }
  r = await api("PATCH", "/checkout", { delivery: "teleport" });
  check("PATCH unknown delivery -> 422", isError(r, 422) && r.body.field === "delivery", r);
  r = await api("PATCH", "/checkout", { payment: "card" });
  check("PATCH unknown payment -> 422", isError(r, 422) && r.body.field === "payment", r);
  r = await api("PATCH", "/checkout", { payment: "invoice", delivery: "collect" });
  check(
    "PATCH payment invoice + collect",
    r.status === 200 && r.body.payment === "invoice" && r.body.delivery === "collect" && r.body.bag.deliveryFee === 0,
    r.body,
  );
  check(
    "Collect: deliveryFeeText is $0 while the bag is not empty",
    r.body.bag.count > 0 &&
      r.body.bag.deliveryFeeText === "$0" &&
      r.body.bag.totalText === fmt(r.body.bag.total) &&
      summaryTextOk(r.body.bag),
    r.body.bag,
  );

  // stored choice survives while valid, falls back while not
  const whiteGloveLines = r.body.bag.items.filter((l) => l.delivery === "white-glove");
  if (whiteGloveLines.length && parcelPiece) {
    for (const line of whiteGloveLines) await api("DELETE", `/bag/${line.id}`);
    r = await api("PATCH", "/checkout", { delivery: "parcel" });
    check(
      "Parcel allowed once no line needs white-glove",
      r.status === 200 && r.body.delivery === "parcel" && r.body.bag.needsWhiteGlove === false,
      r.body,
    );
    await api("POST", "/bag", { sku: madeToOrder.sku });
    r = await api("GET", "/checkout");
    check(
      "Unavailable stored delivery falls back to first available",
      r.body.delivery === "white-glove" && r.body.deliveryOptions[0].isAvailable === false,
      r.body.delivery,
    );
    await api("DELETE", `/bag/${madeToOrder.sku}.${finishA.id}`);
    r = await api("GET", "/checkout");
    check("Stored delivery returns once valid again", r.body.delivery === "parcel", r.body.delivery);
    r = await api("DELETE", `/bag/${madeToOrder.sku}.${finishA.id}`);
    check("DELETE /bag/:lineId idempotent", r.status === 200, r);
    await api("POST", "/bag", { sku: madeToOrder.sku, qty: 2 });
    r = await api("PATCH", "/checkout", { contact: { phone: "(518) 555-0199" } });
    check(
      "PATCH without delivery succeeds while stored choice is unavailable",
      r.status === 200 && r.body.delivery === "white-glove" && r.body.contact.phone === "(518) 555-0199",
      r,
    );
  }
  await api("PATCH", "/checkout", {
    delivery: "white-glove",
    payment: "bank-transfer",
    address: { postcode: "12534" },
  });

  // ---------------------------------------------------------------- orders
  const preview = (await api("GET", "/checkout")).body;
  r = await api("POST", "/orders", {});
  const order = r.body;
  check("POST /orders -> 201 Order WF-24001", r.status === 201 && order.id === "WF-24001", r);
  check(
    "Order keys",
    same(Object.keys(order), [
      "id",
      "createdAt",
      "contact",
      "address",
      "delivery",
      "payment",
      "items",
      "subtotal",
      "subtotalText",
      "tradeDiscount",
      "tradeDiscountText",
      "deliveryFee",
      "deliveryFeeText",
      "total",
      "totalText",
      "dueToday",
      "dueTodayText",
      "dueLater",
      "dueLaterText",
      "status",
      "statusLabel",
      "timeline",
    ]),
    Object.keys(order),
  );
  check(
    "Order totals and their texts equal the checkout preview",
    SUMMARY_KEYS.every((k) => order[k] === preview.bag[k] && order[`${k}Text`] === preview.bag[`${k}Text`]),
    { order, bag: preview.bag },
  );
  check(
    "Order amount texts match, order items are priced like the bag lines",
    summaryTextOk(order) &&
      order.deliveryFeeText === "$250" &&
      same(
        order.items.map((l) => [l.unitPriceText, l.lineTotalText]),
        preview.bag.items.map((l) => [l.unitPriceText, l.lineTotalText]),
      ),
    order,
  );
  check(
    "Order delivery/payment objects",
    same(Object.keys(order.delivery), ["id", "name", "fee", "feeText", "eta"]) &&
      order.delivery.id === "white-glove" &&
      order.delivery.fee === 250 &&
      order.delivery.feeText === "$250" &&
      same(Object.keys(order.payment), ["id", "name", "instructions"]) &&
      order.payment.instructions.includes(order.id),
    { d: order.delivery, p: order.payment },
  );
  check(
    "Order items are BagLines without holds",
    order.items.length === preview.bag.items.length && order.items.every((l) => l.heldUntil === null),
    order.items,
  );
  check(
    "New order timeline: placed is current",
    order.status === "placed" &&
      order.statusLabel === "Order placed" &&
      order.timeline.length === 5 &&
      order.timeline[0].isDone &&
      order.timeline[0].isCurrent &&
      order.timeline[0].at === order.createdAt &&
      order.timeline.slice(1).every((s) => !s.isDone && !s.isCurrent && s.at === null),
    order.timeline,
  );
  r = await api("GET", "/bag");
  check("Order cleared the bag", r.body.count === 0 && r.body.items.length === 0, r.body);
  r = await api("GET", "/checkout");
  check(
    "Checkout after an order charges nothing, delivery choice kept",
    r.body.bag.count === 0 &&
      r.body.bag.deliveryFee === 0 &&
      r.body.bag.total === 0 &&
      r.body.delivery === "white-glove",
    { delivery: r.body.delivery, bag: r.body.bag },
  );
  r = await api("GET", "/me");
  check("/me.orderCount", r.body.orderCount === 1, r.body.orderCount);
  const orderedUnique = order.items.find((l) => l.isUnique);
  if (orderedUnique) {
    r = await api("GET", `/products/${orderedUnique.slug}`);
    check("Ordered unique piece is sold", r.body.isSold === true, r.body.isSold);
    r = await api("POST", "/bag", { sku: orderedUnique.sku });
    check("Adding a sold piece -> 409", isError(r, 409), r);
    r = await api("GET", "/home");
    check(
      "Home hides sold pieces from rails",
      ![r.body.hero, ...r.body.featured, ...r.body.arrivals, ...r.body.antiques].some(
        (p) => p.sku === orderedUnique.sku,
      ),
      null,
    );
    r = await api("GET", "/products");
    check(
      "Listing still shows sold piece flagged",
      r.body.items.find((p) => p.sku === orderedUnique.sku)?.isSold === true,
      null,
    );
  }
  r = await api("POST", "/orders", {});
  check("POST /orders with empty bag -> 409", isError(r, 409), r);

  await api("POST", "/bag", { sku: parcelPiece?.sku ?? madeToOrder.sku });
  await api("PATCH", "/checkout", { delivery: "collect" });
  r = await api("POST", "/orders");
  const second2 = r.body;
  check(
    "Second order WF-24002 (collect)",
    r.status === 201 && second2.id === "WF-24002" && second2.delivery.id === "collect" && second2.deliveryFee === 0,
    r,
  );
  check(
    "Collect order: deliveryFeeText and delivery.feeText are $0",
    second2.deliveryFeeText === "$0" && second2.delivery.feeText === "$0" && summaryTextOk(second2),
    second2,
  );
  r = await api("GET", "/orders");
  check("GET /orders newest first", same(r.body.map((o) => o.id), ["WF-24002", "WF-24001"]), r.body.map((o) => o.id));
  check(
    "GET /orders list items carry the amount texts",
    r.body.every((o) => summaryTextOk(o) && textOk(o.delivery, ["fee"])),
    r.body,
  );
  r = await api("GET", "/orders/latest");
  check("GET /orders/latest", r.body.id === "WF-24002", r.body.id);
  r = await api("GET", "/orders/WF-24001");
  check("GET /orders/:id", r.status === 200 && r.body.id === "WF-24001", r.body.id);
  r = await api("GET", "/orders/WF-99999");
  check("GET unknown order -> 404", isError(r, 404), r);

  const statusAfter = async (id) => (await api("GET", `/orders/${id}`)).body;
  await travel(25_000);
  let o = await statusAfter("WF-24001");
  check(
    "Timeline advances: confirmed after ~20s",
    o.status === "confirmed" &&
      o.timeline[1].isCurrent &&
      o.timeline[0].isDone &&
      !o.timeline[0].isCurrent &&
      o.timeline[1].at,
    o.timeline,
  );
  await travel(40_000);
  o = await statusAfter("WF-24001");
  check("Timeline: workshop after ~60s", o.status === "workshop", o.status);
  await travel(40_000);
  o = await statusAfter("WF-24001");
  check("Timeline: dispatched after ~100s", o.status === "dispatched" && o.statusLabel === "On its way", o.statusLabel);
  const c = await statusAfter("WF-24002");
  check(
    "Collect orders relabel dispatch stage",
    c.status === "dispatched" && c.statusLabel === "Ready to collect",
    c.statusLabel,
  );
  await travel(60_000);
  o = await statusAfter("WF-24001");
  check(
    "Timeline: delivered after ~150s, all done",
    o.status === "delivered" &&
      o.timeline.every((s) => s.isDone && s.at) &&
      o.timeline[4].isCurrent &&
      o.timeline.every((s, i) => i === 0 || Date.parse(s.at) > Date.parse(o.timeline[i - 1].at)),
    o.timeline,
  );
  check("Collect order ends Collected", (await statusAfter("WF-24002")).statusLabel === "Collected", null);

  // ---------------------------------------------------------------- holds expire
  await api("DELETE", "/demo");
  r = await api("POST", "/bag", { sku: antique.sku });
  check("Unique piece addable after reset", r.status === 201, r);
  await travel(14 * 60_000);
  r = await api("GET", "/bag");
  check("Hold still live at 14 minutes", r.body.items.some((l) => l.sku === antique.sku), r.body.items);
  await travel(2 * 60_000);
  r = await api("GET", "/bag");
  check(
    "Expired hold drops out on next read",
    r.body.items.every((l) => l.sku !== antique.sku) && r.body.count === 0,
    r.body.items,
  );
  r = await api("POST", "/bag", { sku: antique.sku });
  check(
    "Expired piece can be added again with a new hold",
    r.status === 201 && Date.parse(r.body.items[0].heldUntil) - Date.now() > 14 * 60000,
    r.body.items,
  );

  // ---------------------------------------------------------------- concurrency
  await api("DELETE", "/demo");
  const [c1, c2] = await Promise.all([
    api("POST", "/bag", { sku: madeToOrder.sku }),
    api("POST", "/bag", { sku: madeToOrder.sku }),
  ]);
  r = await api("GET", "/bag");
  check(
    "Parallel adds are serialised (qty 2)",
    c1.status === 201 && c2.status === 201 && r.body.items[0].qty === 2,
    r.body.items,
  );
  const pair = await Promise.all([
    api("POST", "/bag", { sku: antique.sku }),
    api("POST", "/bag", { sku: antique.sku }),
  ]);
  check(
    "Parallel unique adds: one 201, one 409",
    same(pair.map((p) => p.status).toSorted(), [201, 409]),
    pair.map((p) => p.status),
  );

  // ---------------------------------------------------------------- routing and reset
  r = await api("GET", "/nope");
  check("Unknown route -> 404 {message}", isError(r, 404), r);
  r = await api("POST", "/me");
  check("Wrong method -> 404 {message}", isError(r, 404), r);
  await api("PUT", `/saved/${first.sku}`);
  await api("PATCH", "/session", { isTrade: true });
  await api("PATCH", "/checkout", { address: { postcode: "99501" } });
  r = await api("DELETE", "/demo");
  const [meAfter, coAfter] = [(await api("GET", "/me")).body, (await api("GET", "/checkout")).body];
  check(
    "DELETE /demo wipes session, bag, saved, orders",
    same(r.body, { ok: true }) &&
      meAfter.isTrade === false &&
      meAfter.bag.count === 0 &&
      meAfter.saved.count === 0 &&
      meAfter.orderCount === 0,
    meAfter,
  );
  check(
    "DELETE /demo restores the demo draft",
    coAfter.address.postcode === "12534" && coAfter.delivery === "white-glove",
    coAfter.address,
  );
  const homeAfter = (await api("GET", "/home")).body;
  check(
    "DELETE /demo clears recent and sold",
    homeAfter.recent.length === 0 && (await api("GET", "/products")).body.items.every((p) => !p.isSold),
    null,
  );

  const failed = results.filter((x) => !x.ok);
  return { passed: results.length - failed.length, failed, total: results.length };
}
