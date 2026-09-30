// Static dev server with an SPA fallback. /api/ belongs to the service worker (sw.js).
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = import.meta.dirname;
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".quark": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
};

const NOT_CONTROLLED = JSON.stringify({
  message:
    "The mock backend lives in the service worker (sw.js), which is not controlling this page yet. Reload.",
});

const send = (res, status, body, type = "text/plain; charset=utf-8") => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
};

const fileFor = async (root, path) => {
  const file = join(root, normalize(path));
  try {
    return (await stat(file)).isDirectory() ? join(file, "index.html") : file;
  } catch {
    return extname(path) ? file : join(root, "index.html");
  }
};

export const createHandler =
  (root = ROOT) =>
  async (req, res) => {
    try {
      const path = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname
      );
      if (path.startsWith("/api/"))
        return send(res, 503, NOT_CONTROLLED, TYPES[".json"]);
      const file = await fileFor(root, path);
      send(
        res,
        200,
        await readFile(file),
        TYPES[extname(file).toLowerCase()] ?? "application/octet-stream"
      );
    } catch {
      send(res, 404, `Not found: ${req.url}`);
    }
  };

if (import.meta.main)
  createServer(createHandler()).listen(PORT, () =>
    console.log(`Wrenfield is running at http://localhost:${PORT}`)
  );
