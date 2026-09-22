import { access } from "node:fs/promises";
import { createServer } from "vite";
import path from "node:path";
import { createRigViteConfig } from "./vite-config.mjs";
import { isSitePackage } from "./package-type.mjs";
import { prepareSiteDocs } from "./collect-docs-metas.mjs";

const packageRoot = process.cwd();

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

const site = await isSitePackage(packageRoot);
const demoIndex = path.resolve(packageRoot, "support/demos/index.html");
const siteIndex = path.resolve(packageRoot, "index.html");

let config;
if (site) {
  if (!(await fileExists(siteIndex))) {
    throw new Error(
      `Site package is missing ${siteIndex}. Expected index.html at the package root.`,
    );
  }
  await prepareSiteDocs(packageRoot);
  config = await createRigViteConfig({
    mode: "dev-site",
    root: packageRoot,
    packageRoot,
    entry: siteIndex,
  });
} else if (await fileExists(demoIndex)) {
  config = await createRigViteConfig({
    mode: "dev",
    root: path.resolve(packageRoot, "support/demos"),
    packageRoot,
    entry: demoIndex,
  });
} else {
  throw new Error(
    `No Vite entry found in ${packageRoot}. ` +
      `Site packages need ./index.html; demo playgrounds need support/demos/index.html.`,
  );
}

const server = await createServer(config);
await server.listen();
server.printUrls();
server.bindCLIShortcuts({ print: true });
