import { options } from "./options.js";

/** Another site: its own entry and origin, written to `NUCLEUS_SSR_TEST_OTHER_OUT`. */
export default () => ({
  ...options(),
  out: process.env.NUCLEUS_SSR_TEST_OTHER_OUT,
  origin: "https://other.test",
  routes: ["/"],
  shellRoutes: ["/broken", "/bag"],
  entry: () => import("./other-entry.js"),
});
