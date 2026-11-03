// Local preview only. GitHub Pages serves docs/ directly; no server is deployed.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../docs/", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const port = Number(option("--port", process.env.PORT || 3000));
const host = option("--host", "0.0.0.0");
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".csv": "text/csv",
};
const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
  } catch {
    res.writeHead(400);
    res.end("Invalid path");
    return;
  }
  if (pathname === "/__preview/mobile") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(new URL("mobile-preview.html", import.meta.url)));
    return;
  }
  const file = path.resolve(
    root,
    "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname),
  );
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(file, (error, bytes) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type":
        (types[path.extname(file)] || "application/octet-stream") +
        "; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(bytes);
  });
});
server.listen(port, host, () =>
  console.log(`PairLab ready on http://${host}:${port}`),
);
