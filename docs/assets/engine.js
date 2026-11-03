/**
 * PairLab's backtester. No DOM, network calls, or external dependencies.
 * Prices must be aligned, positive, adjusted daily closes, sorted by ISO date.
 * A close-t signal trades at close t+1. Shares stay fixed until exit.
 */
export const DEFAULTS = Object.freeze({
  formation: 504,
  lookback: 60,
  entry: 2,
  exit: 0.5,
  stop: 4,
  maxHold: 40,
  costBps: 5,
  borrowPct: 2,
  capital: 100000,
});

export const mean = (values) =>
  values.reduce((s, v) => s + v, 0) / values.length;
export function stdev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(
    values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1),
  );
}

export function ols(y, x) {
  const mx = mean(x),
    my = mean(y);
  let variance = 0,
    covariance = 0;
  for (let i = 0; i < x.length; i++) {
    variance += (x[i] - mx) ** 2;
    covariance += (x[i] - mx) * (y[i] - my);
  }
  if (variance < 1e-14)
    throw new Error("Asset B has no usable variation in the formation period.");
  const beta = covariance / variance;
  return { beta, alpha: my - beta * mx };
}

export function validateSeries(series) {
  const { dates, a, b } = series;
  if (
    !Array.isArray(dates) ||
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    dates.length !== a.length ||
    dates.length !== b.length
  ) {
    throw new Error(
      "Dates and both price columns must have the same number of rows.",
    );
  }
  if (dates.length < 3)
    throw new Error("At least three aligned prices are required.");
  for (let i = 0; i < dates.length; i++) {
    const day = new Date(dates[i] + "T00:00:00Z");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dates[i]) ||
      Number.isNaN(+day) ||
      day.toISOString().slice(0, 10) !== dates[i]
    )
      throw new Error(`Invalid ISO date at row ${i + 2}.`);
    if (i && dates[i] <= dates[i - 1])
      throw new Error("Dates must be strictly increasing, with no duplicates.");
    if (
      !Number.isFinite(a[i]) ||
      !Number.isFinite(b[i]) ||
      a[i] <= 0 ||
      b[i] <= 0
    ) {
      throw new Error(`Both prices must be positive numbers at row ${i + 2}.`);
    }
  }
}

function validateConfig(c, length) {
  for (const key of Object.keys(DEFAULTS)) {
    if (!Number.isFinite(c[key])) throw new Error(`Invalid value for ${key}.`);
  }
  if (
    !Number.isInteger(c.formation) ||
    !Number.isInteger(c.lookback) ||
    c.lookback < 2 ||
    c.formation < c.lookback + 2 ||
    c.formation >= length - 2
  ) {
    throw new Error(
      "The formation period must exceed the lookback and leave at least three test observations.",
    );
  }
  if (!(c.exit >= 0 && c.entry > c.exit && c.stop > c.entry)) {
    throw new Error("Thresholds must satisfy 0 ≤ exit < entry < stop.");
  }
  if (
    c.capital <= 0 ||
    c.costBps < 0 ||
    c.costBps > 1000 ||
    c.borrowPct < 0 ||
    c.borrowPct > 100 ||
    !Number.isInteger(c.maxHold) ||
    c.maxHold < 1
  ) {
    throw new Error(
      "Check capital, costs, borrow rate, and maximum holding period.",
    );
  }
}

export function analyze(series, formation, lookback) {
  const logsA = series.a.map(Math.log),
    logsB = series.b.map(Math.log);
  const model = ols(logsA.slice(0, formation), logsB.slice(0, formation));
  if (model.beta <= 0)
    throw new Error(
      "This model has a non-positive hedge ratio. This long/short workbench requires β > 0.",
    );
  const spread = logsA.map((p, i) => p - model.alpha - model.beta * logsB[i]);
  // Deliberately exclude today's spread from its own reference distribution.
  const z = spread.map((s, i) => {
    if (i < lookback) return null;
    const history = spread.slice(i - lookback, i);
    const sd = stdev(history);
    return sd > 1e-12 ? (s - mean(history)) / sd : null;
  });
  return { ...model, spread, z };
}

export function summarize(rows, trades, capital) {
  let high = capital,
    previous = capital;
  const returns = [],
    drawdowns = [];
  for (const row of rows) {
    returns.push(previous > 0 ? row.equity / previous - 1 : 0);
    previous = row.equity;
    high = Math.max(high, row.equity);
    drawdowns.push(row.equity / high - 1);
  }
  const totalReturn = rows.at(-1).equity / capital - 1;
  const sd = stdev(returns);
  const winners = trades.filter((t) => t.pnl > 0);
  return {
    totalReturn,
    cagr:
      totalReturn > -1 ? (1 + totalReturn) ** (252 / rows.length) - 1 : null,
    sharpe: sd > 1e-12 ? (mean(returns) / sd) * Math.sqrt(252) : null,
    maxDrawdown: Math.min(0, ...drawdowns),
    winRate: trades.length ? winners.length / trades.length : null,
    trades: trades.length,
    averageHold: trades.length ? mean(trades.map((t) => t.holdDays)) : null,
    costs: trades.reduce((s, t) => s + t.fees, 0),
    borrow: trades.reduce((s, t) => s + t.borrow, 0),
    netPnl: rows.at(-1).equity - capital,
    exposure: rows.filter((r) => r.position !== 0).length / rows.length,
  };
}

export function backtest(series, overrides = {}) {
  validateSeries(series);
  const c = { ...DEFAULTS, ...overrides };
  validateConfig(c, series.dates.length);
  const model = analyze(series, c.formation, c.lookback);
  const { dates, a, b } = series;
  const rows = [],
    trades = [],
    signals = [];
  let equity = c.capital,
    position = null,
    pending = null,
    exhausted = false;

  function close(t, reason) {
    const fees =
      ((Math.abs(position.qa * a[t]) + Math.abs(position.qb * b[t])) *
        c.costBps) /
      10000;
    equity -= fees;
    position.fees += fees;
    const trade = {
      id: trades.length + 1,
      direction: position.direction,
      signalDate: position.signalDate,
      entryDate: dates[position.index],
      exitDate: dates[t],
      entryZ: position.entryZ,
      exitZ: ["End of sample", "Capital exhausted"].includes(reason)
        ? null
        : model.z[t - 1],
      holdDays: t - position.index,
      pnl: equity - position.equityBefore,
      grossPnl: position.grossPnl,
      fees: position.fees,
      borrow: position.borrow,
      returnOnEntry: (equity - position.equityBefore) / position.equityBefore,
      qa: position.qa,
      qb: position.qb,
      reason,
    };
    trades.push(trade);
    signals.push({ index: t, kind: "exit", direction: position.direction });
    position = null;
  }

  // Start flat at the first test close; do not use a formation-period trade.
  for (let t = c.formation; t < dates.length; t++) {
    if (position) {
      const pnl =
        position.qa * (a[t] - a[t - 1]) + position.qb * (b[t] - b[t - 1]);
      const calendarDays =
        (Date.parse(dates[t]) - Date.parse(dates[t - 1])) / 86400000;
      const shortNotional =
        Math.abs(Math.min(0, position.qa) * a[t - 1]) +
        Math.abs(Math.min(0, position.qb) * b[t - 1]);
      const borrow =
        (((shortNotional * c.borrowPct) / 100) * calendarDays) / 365;
      equity += pnl - borrow;
      position.grossPnl += pnl;
      position.borrow += borrow;
    }
    if (equity <= 0 && position) {
      close(t, "Capital exhausted");
      exhausted = true;
      pending = null;
    }
    if (pending && !exhausted) {
      if (pending.kind === "exit" && position) close(t, pending.reason);
      else if (pending.kind === "entry" && !position && t < dates.length - 1) {
        const direction = pending.direction;
        const weightA = 1 / (1 + model.beta),
          weightB = model.beta / (1 + model.beta);
        const fees = (equity * c.costBps) / 10000;
        position = {
          direction,
          index: t,
          entryZ: model.z[t - 1],
          signalDate: dates[t - 1],
          qa: (direction * equity * weightA) / a[t],
          qb: (-direction * equity * weightB) / b[t],
          equityBefore: equity,
          fees,
          borrow: 0,
          grossPnl: 0,
        };
        equity -= fees;
        signals.push({ index: t, kind: "entry", direction });
      }
    }
    pending = null;
    if (t === dates.length - 1 && position) close(t, "End of sample");

    const z = model.z[t];
    if (t < dates.length - 1 && !exhausted) {
      if (position) {
        if (z !== null && Math.abs(z) >= c.stop)
          pending = { kind: "exit", reason: "Z-score stop" };
        else if (
          z !== null &&
          ((position.direction === 1 && z >= -c.exit) ||
            (position.direction === -1 && z <= c.exit))
        ) {
          pending = { kind: "exit", reason: "Mean reversion" };
        } else if (t - position.index + 1 >= c.maxHold)
          pending = { kind: "exit", reason: "Time limit" };
      } else if (z !== null && Math.abs(z) >= c.entry && Math.abs(z) < c.stop) {
        pending = { kind: "entry", direction: z < 0 ? 1 : -1 };
      }
    }
    rows.push({
      date: dates[t],
      index: t,
      equity,
      z,
      benchmark:
        c.capital *
        ((0.5 * a[t]) / a[c.formation] + (0.5 * b[t]) / b[c.formation]),
      position: position?.direction ?? 0,
    });
  }
  let high = c.capital;
  for (const row of rows) {
    high = Math.max(high, row.equity);
    row.drawdown = row.equity / high - 1;
  }
  return {
    config: c,
    model,
    rows,
    trades,
    signals,
    metrics: summarize(rows, trades, c.capital),
    exhausted,
  };
}

export function csvEscape(value) {
  const text = String(value ?? "");
  // Prevent spreadsheet formula execution when exporting user-supplied labels.
  const safe = /^[=+@\t\r]/.test(text) ? "'" + text : text;
  return /[",\n\r]/.test(safe) ? '"' + safe.replaceAll('"', '""') + '"' : safe;
}

export function tradesCSV(result) {
  const keys = [
    "id",
    "direction",
    "signalDate",
    "entryDate",
    "exitDate",
    "holdDays",
    "entryZ",
    "exitZ",
    "grossPnl",
    "fees",
    "borrow",
    "pnl",
    "returnOnEntry",
    "reason",
  ];
  return [
    keys.join(","),
    ...result.trades.map((t) => keys.map((k) => csvEscape(t[k])).join(",")),
  ].join("\r\n");
}

export function parsePriceCSV(text) {
  const records = [];
  let row = [],
    value = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (ch === "," || ch === "\n" || ch === "\r")) {
      row.push(value.trim());
      value = "";
      if (ch !== ",") {
        if (row.some(Boolean)) records.push(row);
        row = [];
        if (ch === "\r" && text[i + 1] === "\n") i++;
      }
    } else value += ch;
  }
  if (quoted) throw new Error("Unclosed quote in CSV.");
  row.push(value.trim());
  if (row.some(Boolean)) records.push(row);
  const header = records.shift();
  if (
    !header ||
    header.length !== 3 ||
    header[0].toLowerCase() !== "date" ||
    !header[1] ||
    !header[2] ||
    header[1] === header[2]
  ) {
    throw new Error(
      "Use exactly three columns: Date,TICKER_A,TICKER_B, with two distinct asset names.",
    );
  }
  const series = {
    dates: [],
    a: [],
    b: [],
    nameA: header[1],
    nameB: header[2],
  };
  for (const [i, fields] of records.entries()) {
    if (fields.length !== 3 || fields.some((v) => v === ""))
      throw new Error(`Missing or extra values at CSV row ${i + 2}.`);
    series.dates.push(fields[0]);
    series.a.push(Number(fields[1]));
    series.b.push(Number(fields[2]));
  }
  validateSeries(series);
  if (series.dates.length < 300)
    throw new Error("Upload at least 300 aligned daily observations.");
  if (series.dates.length > 20000)
    throw new Error("Use at most 20,000 daily observations.");
  return series;
}
