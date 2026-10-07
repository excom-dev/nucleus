import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempDir, removeDir, writeFiles } from "./docs-pipeline-fixtures";

const BUILD = path.resolve(__dirname, "../../scripts/vite-build.mjs");

/**
 * An app shaped like Wrenfield: `index.html` and `shell.css` at the root, every
 * served file under `public/` (a classic service worker that `importScripts` its
 * backend, views, a sheet, icons), the host's rules, and an installed Nucleus Kit.
 * Its third-party module loads by `import()` from a classic script.
 */
const APP = {
  "package.json": JSON.stringify({ name: "app", type: "module", excom: { packageType: "app" } }),
  "index.html": `<!doctype html>
<html><head>
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/img/logo.svg">
  <link rel="stylesheet" href="./shell.css">
  <script type="module">
    import "@excom/nucleus-kit/nucleus-kit.progressive";
  </script>
  <script>navigator.serviceWorker?.register("/sw.js"); import("https://example.com/viewer.js");</script>
</head><body>
  <quark-sheet src-url="/shell.quark"></quark-sheet>
  <spa-route route-href="/" template-ref="/views/home/home.html"></spa-route>
</body></html>
`,
  "shell.css": '@import "@excom/nucleus-kit/basic.css";\nbody { color: red; }\n',
  "public/sw.js": 'importScripts("backend/shop.js");\nself.addEventListener("fetch", (event) => shop(event));\n',
  "public/backend/shop.js": "function shop() {}\n",
  "public/views/home/home.html": "<h1>home</h1>\n",
  "public/shell.quark": "body { data-ready: true; }\n",
  "public/img/logo.svg": "<svg/>",
  "public/manifest.webmanifest": "{}",
  "public/_headers": "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n",
  "node_modules/@excom/nucleus-kit/package.json": JSON.stringify({ name: "@excom/nucleus-kit", version: "9.9.9" }),
  "node_modules/@excom/nucleus-kit/nucleus-kit.progressive.js": "document.body.dataset.kit = 'kit';\n",
  "node_modules/@excom/nucleus-kit/basic.css": ".kit { color: blue; }\n",
};

let app: string;

beforeAll(() => {
  app = path.join(makeTempDir("heft-rig-site-app-"), "app");
  writeFiles(app, APP);
});

afterAll(() => removeDir(path.dirname(app)));

/** `pnpm run build [--kit=…]` in the app, as Rush runs it: a process of its own. */
const run = (...args: string[]) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(VITEST|NODE_ENV)/.test(name)));
  return spawnSync(process.execPath, [BUILD, ...args], { cwd: app, env, encoding: "utf8" });
};

describe("an app built like Wrenfield", () => {
  it.each([[], ["--kit=unpkg"]])("builds %j writing nothing to stderr, its public files as they are", (...args) => {
    const { status, stderr } = run(...args);
    expect([status, stderr]).toEqual([0, ""]);
    const dist = path.join(app, "dist");
    for (const file of ["sw.js", "backend/shop.js", "views/home/home.html", "shell.quark", "_headers"])
      expect(readFileSync(path.join(dist, file), "utf8"), file).toBe(APP[`public/${file}` as keyof typeof APP]);
    const html = readFileSync(path.join(dist, "index.html"), "utf8");
    const links = [...html.matchAll(/(?:(?<![\w-])(?:href|src|src-url|template-ref)=|register\()"(\/[^"?#]*)/g)].map(([, link]) => link);
    expect(links).toEqual(expect.arrayContaining(["/sw.js", "/shell.quark", "/views/home/home.html", "/img/logo.svg"]));
    for (const link of links) expect(existsSync(path.join(dist, link)), link).toBe(true);
    expect(readdirSync(path.join(dist, "assets")).some((file) => file.endsWith(".css"))).toBe(true);
  });

  it("would write a warning beside an async module script, which Rush fails the build on", () => {
    writeFiles(app, {
      "index.html": APP["index.html"].replace(
        "<script>",
        '<script type="module" async src="https://example.com/viewer.js"></script>\n  <script>'
      ),
    });
    const { status, stderr } = run();
    writeFiles(app, { "index.html": APP["index.html"] });
    expect(status).toBe(0);
    expect(stderr).toContain("Mixed async and defer script modules");
  });
});
