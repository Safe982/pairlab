// Make a reviewable single-file copy. GitHub Pages uses docs/ directly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const inlineModule = relative => read(relative).replace(/^export /gm, "");
let app = read("docs/assets/app.js").replace(/^import[\s\S]*?from "\.\/engine.js";\s*/, "")
  .replace(/^import[^\n]+from "\.\/charts.js";\s*/, "");
app = app.replace(/const response = await fetch\([\s\S]*?\);/, 'const response = { ok: true, json: async () => JSON.parse(document.getElementById("market-snapshot").textContent) };');
const scripts = inlineModule("docs/assets/engine.js") + "\n" + inlineModule("docs/assets/charts.js") + "\nconst esc = escapeHTML;\n" + app;
const market = read("docs/data/market.json").replaceAll("<", "\\u003c");
let html = read("docs/index.html")
  .replace(/<link\s+rel="stylesheet"[^>]*>/, `<style>${read("docs/assets/style.css")}</style>`)
  .replace(/<script\s+type="module"[^>]*>[\s\S]*?<\/script>/, "")
  .replace('./assets/favicon.svg', 'data:image/svg+xml;base64,' + Buffer.from(read("docs/assets/favicon.svg")).toString("base64"));
for (const name of ["prices", "example"]) {
  html = html.replaceAll(`./data/${name}.csv`, "data:text/csv;base64," + Buffer.from(read(`docs/data/${name}.csv`)).toString("base64"));
}
html = html.replace(/<a\s+class="source-link"[\s\S]*?<\/a\s*>/, '<span class="source-link">Source in project ZIP</span>');
html = html.replace("</body>", `<script id="market-snapshot" type="application/json">${market}</script><script type="module">${scripts}</script></body>`);
const output = process.argv[2] || path.join(root, "preview.html");
fs.writeFileSync(output, html);
console.log(`Saved self-contained preview: ${output}`);
