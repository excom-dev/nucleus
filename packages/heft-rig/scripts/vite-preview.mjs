import { preview } from "vite";
import { createRigViteConfig } from "./vite-config.mjs";

const packageRoot = process.cwd();
const config = await createRigViteConfig({
  mode: "preview",
  root: packageRoot,
  packageRoot,
  entry: undefined,
});

const server = await preview(config);
server.printUrls();
server.bindCLIShortcuts({ print: true });
