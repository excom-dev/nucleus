import { options } from "./options.js";

/** `/` rendered, the rest shell routes, with a cache of its own in `NUCLEUS_SSR_TEST_CACHE`. */
export default () => ({
  ...options(),
  routes: ["/"],
  shellRoutes: ["/broken", "/bag"],
  cache: { dir: process.env.NUCLEUS_SSR_TEST_CACHE, key: "run fixture" },
});
