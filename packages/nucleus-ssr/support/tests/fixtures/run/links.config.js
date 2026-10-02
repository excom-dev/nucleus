import { options } from "./options.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Only `/`, from a shell function: its links to `/broken` and `/bag` lead to no page, and no one shell is saved. */
export default () => ({
  ...options(),
  routes: ["/"],
  shell: () => readFileSync(join(options().root, "index.html"), "utf8"),
});
