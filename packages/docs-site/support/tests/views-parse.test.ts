import { sameTree } from "@excom/nucleus-dom";
import { describe, expect, it } from "@excom/nucleus-test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VIEWS = join(dirname(fileURLToPath(import.meta.url)), "../../public/views");
const views = (readdirSync(VIEWS, { recursive: true }) as string[])
  .filter((file) => file.endsWith(".html"))
  .sort();

// A view reaches the prerender through `template.innerHTML`, parsed by
// happy-dom: markup it reads into another tree than a browser does (a stray
// end tag, say) would be served, and hydration keeps what it finds.
describe("views", () => {
  it.each(views)("%s parses in the prerender as in a browser", (file) => {
    const html = readFileSync(join(VIEWS, file), "utf8");
    const template = document.createElement("template");
    template.innerHTML = html;
    expect(sameTree(template.innerHTML, html)).toBe(true);
  });
});
