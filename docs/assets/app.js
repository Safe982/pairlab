import {
  DEFAULTS,
  backtest,
  parsePriceCSV,
  tradesCSV,
  csvEscape,
} from "./engine.js";
import { chart, escapeHTML as esc } from "./charts.js";

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const money = (n) => (n < 0 ? "−$" : "$") + fmt.format(Math.abs(n));
const percent = (n, digits = 1) =>
  n === null || !Number.isFinite(n)
    ? "—"
    : `${n < 0 ? "−" : ""}${(Math.abs(n) * 100).toFixed(digits)}%`;
const signedPercent = (n) => (n > 0 ? "+" + percent(n) : percent(n));
const dateLabel = (date) =>
  new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const smallDate = (date) =>
  new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
    timeZone: "UTC",
  });
const state = {
  market: null,
  pairId: "KO-PEP",
  imported: null,
  result: null,
  runPair: null,
  activeTab: "backtest",
  chart: "equity",
  range: "all",
  page: 0,
  sensitivity: null,
};

function getPair() {
  if (state.imported)
    return {
      id: "custom",
      a: state.imported.nameA,
      b: state.imported.nameB,
      nameA: "Imported asset A",
      nameB: "Imported asset B",
      sector: "Your CSV",
      diagnostics: null,
    };
  return state.market.pairs.find((pair) => pair.id === state.pairId);
}
function getSeries(pair = getPair()) {
  return (
    state.imported ?? {
      dates: state.market.dates,
      a: state.market.prices[pair.a],
      b: state.market.prices[pair.b],
    }
  );
}
function getConfig() {
  return Object.fromEntries(
    Object.keys(DEFAULTS).map((key) => [key, Number($(key).value)]),
  );
}
function showError(error) {
  $("error-banner").textContent = error.message ?? String(error);
  $("error-banner").hidden = false;
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    $("toast").hidden = true;
  }, 3500);
}

function renderPairs() {
  $("pair-grid").innerHTML = state.market.pairs
    .map(
      (pair, i) =>
        `<button class="pair-card${!state.imported && pair.id === state.pairId ? " selected" : ""}" data-pair="${pair.id}" aria-pressed="${!state.imported && pair.id === state.pairId}" type="button" aria-label="${pair.nameA} and ${pair.nameB}, ${pair.sector}"><span class="pair-tickers">${pair.a}<span class="slash">/</span>${pair.b}</span><span class="pair-sector">${pair.sector}</span><span class="pair-number">0${i + 1}</span></button>`,
    )
    .join("");
  document.querySelectorAll("[data-pair]").forEach((button) =>
    button.addEventListener("click", () => {
      state.imported = null;
      state.pairId = button.dataset.pair;
      $("csv-file").value = "";
      $("clear-import").hidden = true;
      renderPairs();
      run();
    }),
  );
}

function metric(label, value, foot, explanation, color = "") {
  return `<article class="metric"><div class="metric-label">${label}<span class="info-dot" title="${esc(explanation)}" aria-label="${esc(explanation)}">i</span></div><div class="metric-value ${color}">${value}</div><div class="metric-foot">${foot}</div></article>`;
}

function renderMetrics() {
  const { metrics: m, config: c } = state.result;
  $("metric-grid").innerHTML = [
    metric(
      "Net return",
      signedPercent(m.totalReturn),
      `${money(m.netPnl)} net P&amp;L`,
      "Total change in marked portfolio equity after execution and borrow costs.",
      m.totalReturn >= 0 ? "positive" : "negative",
    ),
    metric(
      "Sharpe ratio",
      m.sharpe === null ? "—" : m.sharpe.toFixed(2),
      "Daily returns · risk-free = 0",
      "Mean daily return divided by sample standard deviation, annualized by square root of 252. Includes flat days.",
    ),
    metric(
      "Max drawdown",
      percent(m.maxDrawdown),
      "Peak-to-trough equity decline",
      "Largest daily equity decline from a prior peak, including initial capital.",
    ),
    metric(
      "Win rate",
      percent(m.winRate, 0),
      `${m.trades} closed trades`,
      "Share of completed trades with positive net P&L after all modeled costs.",
    ),
  ].join("");
  $("equity-legend").innerHTML =
    `<span><i class="legend-line"></i>Pair strategy</span><span><i class="legend-line benchmark"></i>50/50 long-only pair</span><span class="chart-note">${money(c.capital)} initial capital</span>`;
}

function visibleRows() {
  const rows = state.result.rows;
  if (state.range === "all") return rows;
  const end = new Date(rows.at(-1).date + "T00:00:00Z");
  end.setUTCMonth(end.getUTCMonth() - (state.range === "1y" ? 12 : 6));
  const cutoff = end.toISOString().slice(0, 10);
  return rows.filter((row) => row.date >= cutoff);
}

function renderBacktestCharts() {
  if (!state.result || state.activeTab !== "backtest") return;
  const result = state.result,
    rows = visibleRows(),
    drawdown = state.chart === "drawdown";
  $("equity-title").textContent = drawdown
    ? "Portfolio drawdown"
    : "Out-of-sample equity";
  $("equity-subtitle").textContent = drawdown
    ? "Marked equity below its previous high"
    : "After trading and short-borrow costs";
  $("equity-legend").hidden = drawdown;
  chart($("equity-chart"), {
    rows,
    title: drawdown
      ? "Portfolio drawdown over the test period"
      : "Strategy equity and long-only benchmark over the test period",
    lines: drawdown
      ? [{ value: (r) => r.drawdown * 100, color: "#b77c6c" }]
      : [
          { value: (r) => r.equity, color: "#245e4b" },
          { value: (r) => r.benchmark, color: "#acb6bd", opacity: 0.8 },
        ],
    yFormat: (v) =>
      drawdown ? `${v.toFixed(0)}%` : `$${(v / 1000).toFixed(0)}k`,
    tooltip: (r) =>
      drawdown
        ? `Drawdown ${percent(r.drawdown)}`
        : `Strategy ${money(r.equity)} · Pair ${money(r.benchmark)}`,
    zero: drawdown,
  });
  chart($("z-chart"), {
    rows,
    title: "Rolling spread z-score, entry bands, and trade executions",
    lines: [{ value: (r) => r.z, color: "#658a70" }],
    yFormat: (v) => `${v.toFixed(1)}σ`,
    bands: [
      { value: result.config.entry },
      { value: -result.config.entry },
      { value: 0 },
    ],
    markers: result.signals,
    fill: false,
    tooltip: (r) =>
      `z = ${r.z?.toFixed(2) ?? "unavailable"} · ${r.position === 0 ? "Flat" : r.position === 1 ? "Long spread" : "Short spread"}`,
  });
  $("chart-caption").textContent =
    `${smallDate(rows[0].date)} — ${smallDate(rows.at(-1).date)}${state.range === "all" ? " · full test" : " · chart view only; metrics use full test"}`;
}

function currentDiagnostic() {
  return (
    state.runPair.diagnostics?.[String(state.result.config.formation)] ?? null
  );
}

function renderObservation() {
  const d = currentDiagnostic(),
    m = state.result.metrics;
  let text;
  if (!d)
    text =
      "<strong>Imported pair.</strong> The hedge ratio is fitted locally. Cointegration and half-life tests are not computed for uploaded data; use the Python research workflow to investigate stationarity.";
  else if (d.pvalue >= 0.05)
    text = `<strong>Relationship check:</strong> formation p = ${d.pvalue.toFixed(3)}. The test does not reject no cointegration at 5%. A backtest can still generate trades, but this pair's mean-reversion assumption is not established.`;
  else
    text = `<strong>Relationship check:</strong> formation p = ${d.pvalue.toFixed(3)}. Evidence of cointegration in this formation window is conditional on the test assumptions; it does not guarantee the relationship persists.`;
  if (state.result.exhausted)
    text +=
      " <strong>The simulated portfolio exhausted its capital and stopped trading.</strong>";
  $("observation").innerHTML =
    `<span class="observation-icon" aria-hidden="true">↳</span><p>${text}</p>`;
  $("observation").title =
    `Trading costs ${money(m.costs)}; short borrow ${money(m.borrow)}.`;
}

function renderDiagnostics() {
  if (!state.result) return;
  const d = currentDiagnostic(),
    c = state.result.config,
    pair = state.runPair;
  const diagnostics = [
    [
      "Hedge ratio β",
      state.result.model.beta.toFixed(3),
      "Formation-only log-price OLS",
    ],
    [
      "Cointegration p",
      d ? d.pvalue.toFixed(3) : "—",
      d ? "Engle–Granger · unadjusted" : "Not computed for imports",
    ],
    [
      "Residual half-life",
      d?.halfLife
        ? `${d.halfLife.toFixed(1)}<span style="font-size:12px"> d</span>`
        : "—",
      d?.halfLife ? "AR(1) estimate · sessions" : "No stable AR(1) estimate",
    ],
    [
      "Return correlation",
      d ? d.returnCorrelation.toFixed(3) : "—",
      "Formation log returns",
    ],
  ];
  $("diagnostic-grid").innerHTML = diagnostics
    .map(
      ([label, value, foot]) =>
        `<article class="diagnostic-metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></article>`,
    )
    .join("");
  $("price-subtitle").textContent =
    `First ${c.formation} observations fit the model; the remaining observations evaluate it.`;
  $("price-legend").innerHTML =
    `<span><i class="legend-line"></i>${esc(pair.a)}</span><span><i class="legend-line asset-b"></i>${esc(pair.b)}</span>`;
  let verdict = d
    ? d.pvalue < 0.05
      ? `The formation test rejects no cointegration at the unadjusted 5% level (p = ${d.pvalue.toFixed(4)}). This is evidence about the formation window, not the later test period. The test assumes both log-price series are integrated of order one; this project does not enforce that assumption.`
      : `The formation test does not reject no cointegration (p = ${d.pvalue.toFixed(4)}). Treat this as an illustrative backtest rather than an established mean-reverting relationship. High return correlation is not a substitute for a stationary spread.`
    : "Cointegration and half-life diagnostics are unavailable for browser-uploaded pairs. The OLS model and trading results are still computed from your data; a missing p-value is not evidence of cointegration.";
  verdict += ` Formation: ${dateLabel(state.runSeries.dates[0])} — ${dateLabel(state.runSeries.dates[c.formation - 1])}.`;
  $("diagnostic-verdict").textContent = verdict;
  $("diagnostic-verdict").classList.toggle(
    "supported",
    Boolean(d && d.pvalue < 0.05),
  );
  if (state.activeTab !== "diagnostics") return;
  const series = state.runSeries;
  const rows = series.dates.map((date, index) => ({
    date,
    index,
    a: (100 * series.a[index]) / series.a[0],
    b: (100 * series.b[index]) / series.b[0],
  }));
  chart($("price-chart"), {
    rows,
    title: `${pair.a} and ${pair.b} normalized price paths with formation period shaded`,
    lines: [
      { value: (r) => r.a, color: "#245e4b" },
      { value: (r) => r.b, color: "#8297b0" },
    ],
    yFormat: (v) => v.toFixed(0),
    tooltip: (r) => `${pair.a} ${r.a.toFixed(1)} · ${pair.b} ${r.b.toFixed(1)}`,
    shadeUntil: c.formation,
    fill: false,
  });
}

function renderTrades() {
  if (!state.result) return;
  const result = state.result,
    filter = $("trade-filter").value;
  const trades = result.trades.filter(
    (trade) =>
      filter === "all" || (filter === "wins" ? trade.pnl > 0 : trade.pnl <= 0),
  );
  const pages = Math.ceil(trades.length / 10),
    start = state.page * 10;
  const page = trades.slice(start, start + 10),
    pair = state.runPair;
  $("trade-count").textContent = result.trades.length;
  $("trade-summary").textContent =
    `${result.trades.length} trades · ${money(result.metrics.costs)} execution costs · ${money(result.metrics.borrow)} short borrow`;
  $("trade-body").innerHTML = page.length
    ? page
        .map(
          (t) =>
            `<tr><td>${t.id.toString().padStart(2, "0")}</td><td><span class="position-tag ${t.direction === -1 ? "short" : ""}">${t.direction === 1 ? "Long" : "Short"} spread</span><small>${t.direction === 1 ? "+" : "−"}${esc(pair.a)} / ${t.direction === 1 ? "−" : "+"}${esc(pair.b)}</small></td><td>${smallDate(t.entryDate)}<small>${smallDate(t.exitDate)}</small></td><td>${t.holdDays}d</td><td>${t.entryZ.toFixed(2)}</td><td class="${t.pnl > 0 ? "positive" : t.pnl < 0 ? "negative" : ""}">${money(t.pnl)}<small>${signedPercent(t.returnOnEntry)}</small></td><td><span class="reason-tag">${t.reason}</span></td></tr>`,
        )
        .join("")
    : `<tr><td colspan="7" class="empty-trades">${result.trades.length ? "No trades match this filter." : "No completed trades under these rules. Try a longer test period or inspect the z-score bands."}</td></tr>`;
  $("page-label").textContent = trades.length
    ? `Showing ${start + 1}–${Math.min(start + 10, trades.length)} of ${trades.length} trades`
    : "0 trades";
  $("previous-page").disabled = state.page === 0;
  $("next-page").disabled = state.page >= pages - 1;
}

function renderSensitivity() {
  if (!state.result || !document.querySelector(".sensitivity-section").open)
    return;
  if (!state.sensitivity) {
    state.sensitivity = [20, 40, 60].map((lookback) =>
      [1.5, 2, 2.5].map((entry) => {
        if (
          entry >= state.result.config.stop ||
          entry <= state.result.config.exit
        )
          return null;
        return backtest(state.runSeries, {
          ...state.result.config,
          lookback,
          entry,
        }).metrics.totalReturn;
      }),
    );
  }
  $("sensitivity-grid").innerHTML =
    `<table class="sensitivity-table"><caption class="sr-only">Exploratory net returns by lookback and entry threshold</caption><thead><tr><th scope="col">Lookback ↓ / Entry →</th>${[1.5, 2, 2.5].map((v) => `<th scope="col">${v.toFixed(1)}σ</th>`).join("")}</tr></thead><tbody>${state.sensitivity.map((row, index) => `<tr><th scope="row">${[20, 40, 60][index]} sessions</th>${row.map((value) => `<td class="${value === null ? "" : value >= 0 ? "sensitivity-positive" : "sensitivity-negative"}">${value === null ? "N/A" : signedPercent(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function run() {
  if (!state.market) return;
  try {
    const pair = getPair(),
      series = getSeries(pair),
      config = getConfig();
    const result = backtest(series, config);
    state.result = result;
    state.runPair = pair;
    state.runSeries = series;
    state.runSource = state.imported
      ? {
          source: "User-uploaded CSV; adjusted-close status not verified",
          file: state.importedFilename,
        }
      : { ...state.market.meta };
    state.page = 0;
    state.sensitivity = null;
    $("error-banner").hidden = true;
    $("stale-banner").hidden = true;
    $("run-status").textContent =
      `✓ ${result.rows.length.toLocaleString()} test observations · run complete`;
    $("test-period").textContent =
      `${pair.a} / ${pair.b} · ${dateLabel(result.rows[0].date)} — ${dateLabel(result.rows.at(-1).date)}`;
    $("results-area").setAttribute("aria-busy", "false");
    $("export").disabled = false;
    $("run").innerHTML =
      '<span aria-hidden="true">▷</span> Run backtest <span aria-hidden="true">↗</span>';
    renderMetrics();
    renderBacktestCharts();
    renderObservation();
    renderDiagnostics();
    renderTrades();
    renderSensitivity();
  } catch (error) {
    showError(error);
    $("run-status").textContent = "Check the settings above.";
  }
}

function setTab(name, focus = false) {
  state.activeTab = name;
  for (const tab of ["backtest", "diagnostics", "trades"]) {
    $("tab-" + tab).setAttribute("aria-selected", tab === name);
    $("tab-" + tab).tabIndex = tab === name ? 0 : -1;
    $("view-" + tab).hidden = tab !== name;
  }
  if (focus) $("tab-" + name).focus();
  if (name === "backtest") renderBacktestCharts();
  if (name === "diagnostics") renderDiagnostics();
  if (name === "trades") renderTrades();
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Export prepared.");
}

$("strategy-form").addEventListener("submit", (event) => {
  event.preventDefault();
  run();
});
$("strategy-form").addEventListener("input", () => {
  if (state.result) {
    $("stale-banner").hidden = false;
    $("run-status").textContent = "Settings changed · run to apply";
  }
});
$("reset").addEventListener("click", () => {
  for (const [key, value] of Object.entries(DEFAULTS)) $(key).value = value;
  if (state.imported && state.imported.dates.length <= 506)
    $("formation").value = 252;
  run();
});
document.querySelectorAll('[role="tab"]').forEach((button, i, tabs) => {
  button.addEventListener("click", () => setTab(button.id.replace("tab-", "")));
  button.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
      setTab(tabs[index].id.replace("tab-", ""), true);
    }
  });
});
document.querySelectorAll("[data-chart]").forEach((button) =>
  button.addEventListener("click", () => {
    state.chart = button.dataset.chart;
    document.querySelectorAll("[data-chart]").forEach((b) => {
      b.classList.toggle("active", b === button);
      b.setAttribute("aria-pressed", b === button);
    });
    renderBacktestCharts();
  }),
);
document.querySelectorAll("[data-range]").forEach((button) =>
  button.addEventListener("click", () => {
    state.range = button.dataset.range;
    document.querySelectorAll("[data-range]").forEach((b) => {
      b.classList.toggle("active", b === button);
      b.setAttribute("aria-pressed", b === button);
    });
    renderBacktestCharts();
  }),
);
$("trade-filter").addEventListener("change", () => {
  state.page = 0;
  renderTrades();
});
$("previous-page").addEventListener("click", () => {
  state.page--;
  renderTrades();
});
$("next-page").addEventListener("click", () => {
  state.page++;
  renderTrades();
});
document
  .querySelector(".sensitivity-section")
  .addEventListener("toggle", renderSensitivity);
$("export").addEventListener("click", () => {
  $("export-description").textContent =
    `${state.runPair.a} / ${state.runPair.b} · ${state.result.config.formation}-session formation · settings from the last completed run.`;
  $("export-dialog").showModal();
});
$("close-export").addEventListener("click", () => $("export-dialog").close());
$("export-dialog").addEventListener("click", (event) => {
  if (event.target === $("export-dialog")) {
    const r = event.target.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      $("export-dialog").close();
  }
});
$("download-trades").addEventListener("click", () =>
  download(
    `pairlab-${state.runPair.a}-${state.runPair.b}-trades.csv`,
    tradesCSV(state.result),
    "text/csv;charset=utf-8",
  ),
);
$("download-equity").addEventListener("click", () => {
  const fields = ["date", "equity", "benchmark", "drawdown", "z", "position"];
  const csv = [
    fields.join(","),
    ...state.result.rows.map((row) =>
      fields.map((k) => csvEscape(row[k])).join(","),
    ),
  ].join("\r\n");
  download("pairlab-daily-equity.csv", csv, "text/csv;charset=utf-8");
});
$("download-report").addEventListener("click", () => {
  const r = state.result;
  const report = {
    project: "PairLab",
    engineVersion: "1.0.0",
    exportedAt: new Date().toISOString(),
    pair: { a: state.runPair.a, b: state.runPair.b },
    config: r.config,
    source: state.runSource,
    formation: {
      start: state.runSeries.dates[0],
      end: state.runSeries.dates[r.config.formation - 1],
      alpha: r.model.alpha,
      beta: r.model.beta,
      diagnostics: currentDiagnostic(),
    },
    test: {
      start: r.rows[0].date,
      end: r.rows.at(-1).date,
      observations: r.rows.length,
    },
    metrics: r.metrics,
    trades: r.trades,
    assumptions: [
      "Close-t signals execute at close t+1.",
      "Adjusted-close total-return proxy; no separate dividend or corporate-action cash flows.",
      "Fixed shares, 100% gross notional at entry, no cash interest or financing.",
      "Borrow accrues on prior-close short notional over calendar days / 365.",
      "Uncosted long-only benchmark; no margin, impact, taxes, or locate constraints.",
      "The test period is reused when changing parameters; not an untouched holdout.",
      "Cointegration p-values are unadjusted and conditional on I(1) input series.",
    ],
  };
  download(
    "pairlab-research-report.json",
    JSON.stringify(report, null, 2),
    "application/json;charset=utf-8",
  );
});

$("csv-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024)
      throw new Error("Choose a CSV smaller than 5 MB.");
    const series = parsePriceCSV(await file.text());
    // Validate before replacing the selected dataset or last successful result.
    const config = getConfig();
    if (series.dates.length <= config.formation + 2) config.formation = 252;
    backtest(series, config);
    state.imported = series;
    state.importedFilename = file.name;
    $("formation").value = config.formation;
    $("clear-import").hidden = false;
    renderPairs();
    run();
    toast("CSV loaded locally. Nothing was uploaded.");
  } catch (error) {
    showError(error);
    event.target.value = "";
  }
});
$("clear-import").addEventListener("click", () => {
  state.imported = null;
  $("csv-file").value = "";
  $("clear-import").hidden = true;
  renderPairs();
  run();
});

let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderBacktestCharts();
    if (state.activeTab === "diagnostics") renderDiagnostics();
  }, 100);
}).observe($("results-area"));

async function init() {
  try {
    const response = await fetch(
      new URL("../data/market.json", import.meta.url),
    );
    if (!response.ok)
      throw new Error(
        `Historical data could not be loaded (HTTP ${response.status}). Reload the page to try again.`,
      );
    state.market = await response.json();
    $("data-count").textContent =
      `${fmt.format(state.market.meta.observations)} daily observations · 5 example pairs`;
    renderPairs();
    run();
  } catch (error) {
    showError(error);
    $("run-status").textContent = "Price data unavailable";
    $("data-count").textContent = "Historical snapshot unavailable";
    $("equity-chart").textContent =
      "The price snapshot could not be loaded. Please reload to retry.";
    $("results-area").setAttribute("aria-busy", "false");
  }
}
init();
