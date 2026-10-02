/**
 * Every path relative to this folder: the fixture site, and `out` and the
 * cache under `NUCLEUS_SSR_TEST_RELATIVE` (a path relative to this folder
 * too). Resolved against any other folder, they miss.
 */
export default () => ({
  root: "../site",
  out: `${process.env.NUCLEUS_SSR_TEST_RELATIVE}/out`,
  cache: { dir: `${process.env.NUCLEUS_SSR_TEST_RELATIVE}/cache`, key: "relative" },
  origin: "https://wren.test",
  routes: ["/"],
  shellRoutes: ["/broken", "/bag"],
  entry: () => import("../entry.js"),
  servedElsewhere: (absoluteUrl) =>
    new URL(absoluteUrl).pathname.startsWith("/sandbox/"),
});
