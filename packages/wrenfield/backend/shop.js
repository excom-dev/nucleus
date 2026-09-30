const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  trailingZeroDisplay: "stripIfInteger",
});
const cents = (amount) => Math.round(amount * 100) / 100;
const money = (amount) => (amount == null ? null : usd.format(amount));
const withText = (object, keys) =>
  Object.fromEntries(
    Object.entries(object).flatMap(([key, value]) =>
      keys.includes(key) ? [[key, value], [`${key}Text`, money(value)]] : [[key, value]],
    ),
  );
const tradeOf = (price) => cents(price * (1 - TRADE_DISCOUNT));
const pricesOf = (price) => withText({ price, tradePrice: tradeOf(price) }, ["price", "tradePrice"]);
const labelFor = (slug) => slug[0].toUpperCase() + slug.slice(1).replaceAll("-", " ");
const searchable = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replaceAll("-", " ");

const allProducts = ({ catalog, state }) =>
  catalog.products.map((product) =>
    withText(
      {
        ...product,
        href: `/shop/${product.category}/${product.slug}`,
        categoryName: CATEGORIES[product.category],
        eraName: ERAS[product.era].name,
        isUnique: product.era === "antique",
        tradePrice: tradeOf(product.price),
        finishes: product.finishes.map((finish) =>
          withText({ ...finish, prices: pricesOf(product.price + finish.priceDelta) }, ["priceDelta"]),
        ),
        isSold: state.sold.includes(product.sku),
      },
      ["price", "tradePrice"],
    ),
  );

const productWhere = (ctx, key, value) =>
  allProducts(ctx).find((product) => product[key] === value) ?? fail(404, "We could not find that piece.");

const productsBySku = (ctx, skus) => {
  const products = allProducts(ctx);
  return skus.map((sku) => products.find((product) => product.sku === sku)).filter(Boolean);
};

const FILTERS = {
  category: (product, slug) => product.category === slug,
  era: (product, slug) => product.era === slug,
  material: (product, slug) => product.materials.includes(slug),
  priceMax: (product, max) => product.price <= max,
  q: (product, q) => {
    const text = searchable([product.name, product.maker, product.categoryName, ...product.materials].join(" "));
    return searchable(q)
      .split(/\s+/)
      .every((term) => text.includes(term));
  },
};

const SORTS = {
  featured: (a, b) => b.isFeatured - a.isFeatured,
  "price-asc": (a, b) => a.price - b.price,
  "price-desc": (a, b) => b.price - a.price,
  newest: (a, b) => b.isNew - a.isNew,
};

const listingParams = (query) => {
  const priceMax = Number(query.get("priceMax"));
  const sort = query.get("sort");
  return {
    category: query.get("category") || null,
    era: query.get("era") || null,
    material: query.get("material") || null,
    priceMax: priceMax > 0 ? priceMax : null,
    q: query.get("q")?.trim() || null,
    sort: Object.hasOwn(SORTS, sort) ? sort : "featured",
  };
};

const matching = (products, params, except) => {
  const active = Object.entries(FILTERS).filter(([key]) => key !== except && params[key] !== null);
  return products.filter((product) => active.every(([key, test]) => test(product, params[key])));
};

const listingTitle = ({ q, category, era }) => {
  if (q) return `Results for “${q}”`;
  if (category && era) return `${ERAS[era].name} ${CATEGORIES[category].toLowerCase()}`;
  if (category) return CATEGORIES[category];
  if (era) return ERAS[era].title;
  return "All pieces";
};

const eraFacets = (products) =>
  Object.entries(ERAS).map(([slug, { name }]) => ({
    slug,
    name,
    count: products.filter((product) => product.era === slug).length,
  }));

const materialFacets = (products) => {
  const slugs = products.flatMap((product) => product.materials);
  return Object.entries(Object.groupBy(slugs, (slug) => slug))
    .map(([slug, all]) => ({ slug, name: labelFor(slug), count: all.length }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
};

const listing = (ctx) => {
  const params = listingParams(ctx.query);
  if (params.category && !Object.hasOwn(CATEGORIES, params.category)) fail(404, "There is no such category.");
  if (params.era && !Object.hasOwn(ERAS, params.era)) fail(404, "There is no such era.");
  const products = allProducts(ctx);
  const items = matching(products, params).toSorted(SORTS[params.sort]);
  return {
    title: listingTitle(params),
    total: items.length,
    items,
    facets: {
      eras: eraFacets(matching(products, params, "era")),
      materials: materialFacets(matching(products, params, "material")),
    },
  };
};

const affinity = (a, b) =>
  2 * (a.category === b.category) + a.materials.filter((material) => b.materials.includes(material)).length;

const productPage = (ctx) => {
  const product = productWhere(ctx, "slug", ctx.params.slug);
  const related = allProducts(ctx)
    .filter((other) => other.sku !== product.sku && !other.isSold && affinity(product, other) > 0)
    .toSorted((a, b) => affinity(product, b) - affinity(product, a))
    .slice(0, RELATED_LENGTH);
  return { ...product, related };
};

const recordRecent = (ctx) => {
  const { sku } = productWhere(ctx, "slug", ctx.params.slug);
  return { recent: [sku, ...ctx.state.recent.filter((other) => other !== sku)].slice(0, RECENT_LENGTH) };
};

const inCollection = (slug) => (product) => [product.category, product.era, ...product.materials].includes(slug);

const collectionHref = (slug) =>
  Object.hasOwn(CATEGORIES, slug) ? `/shop/${slug}` : `/shop?${Object.hasOwn(ERAS, slug) ? "era" : "material"}=${slug}`;

const mixCategories = (products) => {
  const turn = (product) => products.filter((other) => other.category === product.category).indexOf(product);
  return products.toSorted((a, b) => turn(a) - turn(b));
};

const home = (ctx) => {
  const products = allProducts(ctx);
  const available = products.filter((product) => !product.isSold);
  const hero = available.find((product) => product.isFeatured) ?? available[0];
  const rail = (shown, test) =>
    mixCategories(available.filter((product) => test(product) && !shown.includes(product))).slice(0, RAIL_LENGTH);
  const featured = rail([hero], (product) => product.isFeatured);
  const arrivals = rail([hero, ...featured], (product) => product.isNew);
  const antiques = rail([hero, ...featured, ...arrivals], (product) => product.isUnique);
  return {
    hero,
    collections: ctx.catalog.collections.map((collection) => ({
      ...collection,
      href: collectionHref(collection.slug),
      count: products.filter(inCollection(collection.slug)).length,
    })),
    featured,
    arrivals,
    antiques,
    recent: productsBySku(ctx, ctx.state.recent),
  };
};
