import fs from "node:fs";
import { backtest, DEFAULTS } from "../docs/assets/engine.js";

const market = JSON.parse(
  fs.readFileSync(new URL("../docs/data/market.json", import.meta.url)),
);
const percent = (n) => (100 * n).toFixed(2) + "%";
const dollars = (n) =>
  "$" +
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
let text = `# Baseline research results\n\nThis table is generated from the committed snapshot using \`node scripts/summarize.mjs\`. The example pairs were not screened for profitability.\n\nSnapshot: **${market.meta.start}–${market.meta.end}**, ${market.meta.observations} observations per asset. CSV SHA-256: \`${market.meta.sha256}\`.\n\nFormation: first ${DEFAULTS.formation} sessions. Lookback: ${DEFAULTS.lookback}. Entry/exit/stop: ${DEFAULTS.entry}/${DEFAULTS.exit}/${DEFAULTS.stop} standard deviations. Maximum hold: ${DEFAULTS.maxHold} sessions. Execution cost: ${DEFAULTS.costBps} bps per traded dollar. Annual short borrow: ${DEFAULTS.borrowPct}%. Starting equity: ${dollars(DEFAULTS.capital)}.\n\n| Pair | Formation p | Net return | Sharpe | Max drawdown | Trades | Win rate | Execution costs | Borrow |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
for (const pair of market.pairs) {
  const r = backtest({
    dates: market.dates,
    a: market.prices[pair.a],
    b: market.prices[pair.b],
  });
  const m = r.metrics;
  text += `| ${pair.a}/${pair.b} | ${pair.diagnostics[DEFAULTS.formation].pvalue.toFixed(4)} | ${percent(m.totalReturn)} | ${m.sharpe?.toFixed(2) ?? "N/A"} | ${percent(m.maxDrawdown)} | ${m.trades} | ${m.winRate === null ? "N/A" : percent(m.winRate)} | ${dollars(m.costs)} | ${dollars(m.borrow)} |\n`;
}
text += `\n## Interpretation\n\nNone of these five 504-session formation tests rejects no cointegration at the unadjusted 5% level. One baseline happens to have positive later returns; that is not evidence that the formation test established its stationarity or that the strategy has a persistent edge. Negative outcomes and the gold ETF example's friction-heavy trading remain visible.\n\nThe p-values concern formation log prices only. The test assumes I(1) series, and this project does not enforce separate unit-root tests or correct for multiple comparisons. The later evaluation is out-of-sample with respect to the regression fit, but inspecting these results and choosing parameters against them makes it development data. An untouched holdout remains future work.\n\nPrices are adjusted-close proxies. Costs and borrow are assumptions, not measured historical fills. The baseline does not model market impact, financing, liquidity, margin requirements, tax, short availability, or separate dividend cash flows. See the main README and the site's assumptions for the complete convention.\n`;
fs.writeFileSync(new URL("../research/RESULTS.md", import.meta.url), text);
console.log("Wrote research/RESULTS.md");
