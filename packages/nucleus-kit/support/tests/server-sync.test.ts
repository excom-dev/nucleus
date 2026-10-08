/**
 * `server.ts` is `index.ts` minus the packages whose elements read the device
 * or the person, plus the server entries (`<package>/server`: the prerender
 * hooks) of packages it re-exports. Both files are parsed: a package added to
 * `index.ts` has to land in `server.ts` or have its tags listed in
 * `SERVER_EXCLUDED_TAGS`.
 */
import { SERVER_EXCLUDED_TAGS } from "../../server";
import { afterEach, describe, expect, it, vi } from "@excom/nucleus-test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The `@excom/*` modules a file re-exports (`export * from`, `export { … } from`), in order. */
const reExported = (file: string): string[] =>
  Array.from(
    readFileSync(resolve(ROOT, file), "utf8").matchAll(
      /^export\s+(?:\*|\{[^}]*\})\s+from\s+"(@excom\/[^"]+)"/gm
    ),
    ([, name]) => name
  );

/** The tags a package defines when imported. */
const tagsDefinedBy = async (name: string): Promise<string[]> => {
  const define = vi.spyOn(customElements, "define");
  await import(name);
  return define.mock.calls.map(([tag]) => tag);
};

describe("nucleus-kit server entry vs index", () => {
  const SERVER_ENTRY = /\/server$/;
  const index = reExported("index.ts");
  const server = reExported("server.ts").filter((name) => !SERVER_ENTRY.test(name));
  const serverEntries = reExported("server.ts").filter((name) => SERVER_ENTRY.test(name));
  const excluded = index.filter((name) => !server.includes(name));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-exports nothing index.ts does not, in the same order", () => {
    expect(server.length).toBeGreaterThan(0);
    expect(server).toEqual(index.filter((name) => server.includes(name)));
  });

  it("adds only the server entries of packages it re-exports: the prerender hooks", () => {
    expect(serverEntries).toEqual(["@excom/quark-sheet/server", "@excom/spa-route/server"]);
    expect(serverEntries.map((name) => name.replace(SERVER_ENTRY, "")).filter((name) => !server.includes(name))).toEqual([]);
    expect(reExported("index.ts").filter((name) => name.split("/").length > 2)).toEqual([]);
  });

  it("lists the tags of every package it leaves out, and no others", async () => {
    expect(excluded.length).toBeGreaterThan(0);
    // one at a time: each import's `define` calls belong to it alone
    const defined: [string, string[]][] = [];
    for (const name of excluded) {
      defined.push([name, await tagsDefinedBy(name)]);
      vi.restoreAllMocks();
    }
    // a library left out by mistake defines nothing
    expect(
      defined.filter(([, tags]) => !tags.length).map(([name]) => name)
    ).toEqual([]);
    expect(defined.flatMap(([, tags]) => tags).sort()).toEqual(
      [...SERVER_EXCLUDED_TAGS].sort()
    );
  });
});
