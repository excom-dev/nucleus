import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The fixture site, prerendered to `NUCLEUS_SSR_TEST_OUT`; `/broken` fails. */
export const options = () => ({
  root: join(dirname(fileURLToPath(import.meta.url)), "site"),
  out: process.env.NUCLEUS_SSR_TEST_OUT,
  origin: "https://wren.test",
  routes: ["/", "/broken"],
  entry: () => import("./entry.js"),
  // the shell links `/sandbox/app`, which no prerendered file serves
  servedElsewhere: (absoluteUrl) =>
    new URL(absoluteUrl).pathname.startsWith("/sandbox/"),
});
