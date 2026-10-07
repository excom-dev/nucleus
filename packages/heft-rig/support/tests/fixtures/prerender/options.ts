// `@excom/heft-rig/…` only resolves through the workspace aliases: this
// fixture has no node_modules
import { SITE_BASE } from "@excom/heft-rig/scripts/site-base.mjs";
import { fileURLToPath } from "node:url";

/** The fixture site, prerendered to `RIG_PRERENDER_OUT`. */
export const options = () => ({
  root: fileURLToPath(new URL("./site/", import.meta.url)),
  out: process.env.RIG_PRERENDER_OUT!,
  origin: "https://rig.test",
  routes: ["/", `${SITE_BASE}/broken`],
  entry: () => import("./entry"),
  // the shell links `/sandbox/app`, which no prerendered file serves
  servedElsewhere: (absoluteUrl: string) => new URL(absoluteUrl).pathname.startsWith("/sandbox/"),
});
