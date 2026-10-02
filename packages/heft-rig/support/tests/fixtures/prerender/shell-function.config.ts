import { options } from "./options";
import { readFileSync } from "node:fs";

/** Only `/`, its shell from a function: no one shell to save. */
export default {
  ...options(),
  routes: ["/"],
  shell: () => readFileSync(new URL("./site/index.html", import.meta.url), "utf8"),
};
