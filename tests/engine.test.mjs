import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  backtest,
  analyze,
  ols,
  stdev,
  parsePriceCSV,
  tradesCSV,
} from "../docs/assets/engine.js";

const market = JSON.parse(
  fs.readFileSync(new URL("../docs/data/market.json", import.meta.url)),
);
const real = { dates: market.dates, a: market.prices.KO, b: market.prices.PEP };
const close = (a, b, tolerance = 1e-7) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("OLS recovers an exact intercept and slope; sample standard deviation uses n−1", () => {
  const model = ols([5, 8, 11, 14], [1, 2, 3, 4]);
  close(model.alpha, 2);
  close(model.beta, 3);
  close(stdev([1, 2, 3]), 1);
});

test("all five browser fits agree with formation-only statsmodels inputs", () => {
  for (const pair of market.pairs) {
    for (const formation of [252, 504]) {
      const series = {
        dates: market.dates,
        a: market.prices[pair.a],
        b: market.prices[pair.b],
      };
      const result = analyze(series, formation, 60);
      close(result.alpha, pair.diagnostics[formation].alpha, 1e-8);
      close(result.beta, pair.diagnostics[formation].beta, 1e-8);
    }
  }
});

test("test-period prices cannot change the fitted hedge ratio or earlier signals", () => {
  const mutated = {
    ...real,
    a: real.a.map((p, i) => (i >= 1000 ? p * 1.1 : p)),
  };
  const original = backtest(real),
    changed = backtest(mutated);
  close(original.model.alpha, changed.model.alpha);
  close(original.model.beta, changed.model.beta);
  assert.deepEqual(
    original.rows.filter((r) => r.index < 1000),
    changed.rows.filter((r) => r.index < 1000),
  );
});

test("each z-score excludes today's residual from its reference mean and variance", () => {
  const model = analyze(real, 504, 60),
    t = 700;
  const history = model.spread.slice(t - 60, t);
  const avg = history.reduce((a, b) => a + b, 0) / 60;
  close(model.z[t], (model.spread[t] - avg) / stdev(history), 1e-10);
});

test("signals trade at the following close; entry shares respect 1:β dollar sizing", () => {
  const result = backtest(real);
  assert.ok(result.trades.length > 5);
  assert.equal(result.rows[0].position, 0);
  assert.equal(result.rows[0].equity, result.config.capital);
  for (const trade of result.trades) {
    const i = real.dates.indexOf(trade.entryDate),
      signalIndex = real.dates.indexOf(trade.signalDate);
    assert.equal(i, signalIndex + 1);
    assert.ok(i > result.config.formation);
    close(trade.entryZ, result.model.z[signalIndex]);
    assert.ok(trade.holdDays >= 1);
    const notionalA = Math.abs(trade.qa * real.a[i]);
    const notionalB = Math.abs(trade.qb * real.b[i]);
    close(notionalB / notionalA, result.model.beta);
  }
});

test("round-trip P&L and trading costs reconcile to entry/exit prices by hand", () => {
  const result = backtest(real);
  for (const trade of result.trades) {
    const i = real.dates.indexOf(trade.entryDate),
      j = real.dates.indexOf(trade.exitDate);
    const gross =
      trade.qa * (real.a[j] - real.a[i]) + trade.qb * (real.b[j] - real.b[i]);
    const turnover =
      Math.abs(trade.qa) * (real.a[i] + real.a[j]) +
      Math.abs(trade.qb) * (real.b[i] + real.b[j]);
    close(gross, trade.grossPnl);
    close((turnover * result.config.costBps) / 10000, trade.fees);
    close(gross - trade.fees - trade.borrow, trade.pnl);
  }
  close(
    result.trades.reduce((total, t) => total + t.pnl, 0),
    result.metrics.netPnl,
  );
});

test("short borrow uses actual calendar gaps including weekends and holidays", () => {
  const result = backtest(real, { borrowPct: 12 });
  let weekendGaps = 0;
  for (const trade of result.trades) {
    const i = real.dates.indexOf(trade.entryDate),
      j = real.dates.indexOf(trade.exitDate);
    let borrow = 0;
    for (let k = i + 1; k <= j; k++) {
      const gap =
        (Date.parse(real.dates[k]) - Date.parse(real.dates[k - 1])) / 86400000;
      if (gap >= 3) weekendGaps++;
      const shortValue =
        trade.qa < 0 ? -trade.qa * real.a[k - 1] : -trade.qb * real.b[k - 1];
      borrow += (shortValue * 0.12 * gap) / 365;
    }
    close(borrow, trade.borrow);
  }
  assert.ok(weekendGaps > 0);
});

test("raising friction reduces wealth, and zero costs produce zero fee and borrow totals", () => {
  const free = backtest(real, { costBps: 0, borrowPct: 0 });
  const costly = backtest(real, { costBps: 50, borrowPct: 8 });
  assert.equal(free.metrics.costs, 0);
  assert.equal(free.metrics.borrow, 0);
  assert.ok(costly.metrics.totalReturn < free.metrics.totalReturn);
  assert.deepEqual(
    free.trades.map((t) => [t.entryDate, t.exitDate]),
    costly.trades.map((t) => [t.entryDate, t.exitDate]),
  );
});

test("maximum holding period and end-of-sample liquidation are enforced", () => {
  const result = backtest(real, { maxHold: 3 });
  assert.ok(result.trades.some((t) => t.reason === "Time limit"));
  assert.ok(result.trades.every((t) => t.holdDays <= 3));
  assert.equal(result.rows.at(-1).position, 0);
  close(
    result.metrics.netPnl,
    result.trades.reduce((sum, t) => sum + t.pnl, 0),
  );
});

test("benchmark is a fixed-share 50/50 buy-and-hold pair, rebased at first test close", () => {
  const result = backtest(real),
    f = result.config.formation,
    i = 900;
  close(result.rows[0].benchmark, 100000);
  close(
    result.rows.find((r) => r.index === i).benchmark,
    (50000 * real.a[i]) / real.a[f] + (50000 * real.b[i]) / real.b[f],
  );
});

test("empty strategies report unavailable Sharpe and win rate, without fabricated values", () => {
  const result = backtest(real, { entry: 999, stop: 1000 });
  assert.equal(result.trades.length, 0);
  assert.equal(result.metrics.winRate, null);
  assert.equal(result.metrics.sharpe, null);
  assert.equal(result.metrics.totalReturn, 0);
  assert.equal(result.metrics.maxDrawdown, 0);
});

test("invalid configurations and unsorted or non-positive prices fail clearly", () => {
  assert.throws(() => backtest(real, { entry: 0.5, exit: 1 }), /Thresholds/);
  assert.throws(() => backtest(real, { formation: 20 }), /formation/);
  assert.throws(() => backtest(real, { costBps: -1 }), /costs/);
  const zero = { ...real, a: [...real.a] };
  zero.a[15] = 0;
  assert.throws(() => backtest(zero), /positive/);
  const duplicate = { ...real, dates: [...real.dates] };
  duplicate.dates[2] = duplicate.dates[1];
  assert.throws(() => backtest(duplicate), /strictly increasing/);
});

test("CSV parser accepts quoted CRLF headers and rejects gaps or invalid dates", () => {
  const lines = real.dates
    .slice(0, 600)
    .map((d, i) => `${d},${real.a[i]},${real.b[i]}`);
  const parsed = parsePriceCSV(
    '\uFEFF"Date","KO","PEP"\r\n' + lines.join("\r\n"),
  );
  assert.equal(parsed.dates.length, 600);
  assert.equal(parsed.nameA, "KO");
  assert.throws(() => parsePriceCSV("Date,KO,PEP\n2020-01-02,,4"), /Missing/);
  assert.throws(
    () =>
      parsePriceCSV(
        "Date,KO,PEP\n2020-02-30,3,4\n2020-03-02,4,5\n2020-03-03,5,6",
      ),
    /Invalid ISO date/,
  );
  assert.throws(() => parsePriceCSV("Date,KO,KO\n2020-01-02,3,4"), /distinct/);
});

test("a severe adverse gap liquidates the portfolio and stops later entries", () => {
  const baseline = backtest(real);
  const first = baseline.trades[0];
  const entry = real.dates.indexOf(first.entryDate);
  const shocked = { dates: real.dates, a: [...real.a], b: [...real.b] };
  const shortPrices = first.qa < 0 ? shocked.a : shocked.b;
  for (let i = entry + 1; i < shortPrices.length; i++) shortPrices[i] *= 100;
  const result = backtest(shocked);
  assert.equal(result.exhausted, true);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].reason, "Capital exhausted");
  assert.equal(result.trades[0].exitZ, null);
  assert.ok(result.rows.at(-1).equity < 0);
  assert.equal(result.metrics.cagr, null);
  assert.ok(result.rows.filter(r => r.index > entry).every(r => r.position === 0));
  close(result.metrics.netPnl, result.trades[0].pnl);
});

test("trade CSV exports all round trips with separate gross P&L, fees, and borrow", () => {
  const result = backtest(real),
    csv = tradesCSV(result);
  assert.equal(csv.split("\r\n").length, result.trades.length + 1);
  assert.ok(csv.startsWith("id,direction,signalDate,entryDate,exitDate"));
  assert.ok(csv.includes("grossPnl,fees,borrow,pnl"));
});
