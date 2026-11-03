// JSON bridge for the independent Python reference verification.
import fs from "node:fs";
import { backtest } from "../docs/assets/engine.js";
const market = JSON.parse(
  fs.readFileSync(new URL("../docs/data/market.json", import.meta.url)),
);
const configurations = [
  {},
  { formation: 252, lookback: 20, maxHold: 5 },
  { costBps: 0, borrowPct: 0 },
  { entry: 1.5, costBps: 20, borrowPct: 5 },
];
const results = market.pairs.flatMap((pair) =>
  configurations.map((config) => {
    const series = {
      dates: market.dates,
      a: market.prices[pair.a],
      b: market.prices[pair.b],
    };
    const r = backtest(series, config);
    return {
      pair: pair.id,
      config: r.config,
      equity: r.rows.map((row) => row.equity),
      trades: r.trades,
      metrics: r.metrics,
    };
  }),
);
process.stdout.write(JSON.stringify(results));
