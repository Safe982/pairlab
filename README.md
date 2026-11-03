# PairLab

A pairs trading research workbench by **Ayan Safe**, a CS student at UMass Amherst studying Economics.

PairLab tests a simple question: when related assets move apart, does trading their spread survive realistic accounting and basic execution friction?

The site is a static HTML/CSS/JavaScript application designed for **GitHub Pages**. The research tools are Python. No API keys, paid services, database, npm dependencies, or backend are needed to use the workbench.

## What's built

- Five example pairs: KO/PEP, XOM/CVX, JPM/BAC, V/MA, GLD/IAU.
- A bundled, attributable snapshot of **1,258 daily observations per asset**, January 2, 2020–December 31, 2024.
- A 252- or 504-session formation period; log-price OLS coefficients are frozen before the trading period.
- Formation-only Engle–Granger p-values, residual AR(1) half-life, and log-return correlation, computed using statsmodels.
- Configurable rolling z-score, entry/exit/stop thresholds, holding limit, starting capital, transaction costs, and annual short-borrow rate.
- A next-close execution engine with fixed shares per trade, daily mark-to-market equity, actual exit notional costs, and calendar-day borrowing charges.
- Interactive equity, drawdown, z-score, and normalized-price charts; trade filters and pagination; a nine-run exploratory sensitivity grid.
- Local CSV import, CSV trade/equity export, and a JSON research report containing the actual run parameters and source provenance.
- Responsive layouts, keyboard-operable tabs and charts, native form validation, and reduced-motion support.

## Run locally

Use Node 20 or newer. No `npm install` is required:

```bash
npm run dev
```

Open `http://localhost:3000`. Or serve the `docs/` directory using any static HTTP server. Double-clicking the HTML file does not work because browsers restrict local module imports and fetching JSON on `file://` URLs.

For a quick review without a server, open **`PairLab_preview.html`** in the downloadable project bundle. It embeds the same scripts and price snapshot into one file. Regenerate it with `node scripts/export-preview.mjs /tmp/PairLab_preview.html`; `docs/` remains the production source.

```bash
npm test
```

The numerical reference requires Python 3.11+:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm run verify
python research/backtest.py --pair KO-PEP --output /tmp/ko-pep-report.json
```

`verify.py` compares all daily equity observations and every trade's entry, exit, reason, P&L, fees, and borrow against a separate pandas/NumPy implementation. The shipped checks cover 20 configurations and 16,340 daily equity observations. This numerical agreement supplements the timing, accounting, and no-look-ahead tests; it is not proof that the trading assumptions match a real market.

## Research method

### 1. Formation and diagnostics

Fit the following regression on the **first** N observations, where N is 252 or 504:

```text
log(A_t) = alpha + beta * log(B_t) + residual_t
```

Freeze `alpha` and `beta` for the rest of the sample. This workbench requires `beta > 0`; non-positive hedge ratios are rejected rather than silently changing a long/short strategy into a same-direction position.

The Engle–Granger test uses `statsmodels.tsa.stattools.coint`, with a constant and AIC lag selection. Its null is **no cointegration**. P-values are computed only on formation prices and are unadjusted for multiple testing. The test assumes I(1) input series; individual unit-root tests are not enforced. Half-life comes from a formation-residual AR(1) estimate and is unavailable if the fitted AR coefficient is outside (0, 1).

### 2. Signals

At close t:

```text
spread_t = log(A_t) - alpha - beta * log(B_t)
z_t = (spread_t - mean(spread[t-lookback:t]))
      / sample_std(spread[t-lookback:t])
```

The current observation is **excluded** from its own rolling mean and sample standard deviation. Flat positions enter only when `entry <= abs(z) < stop`. Negative z enters long A / short B; positive z enters short A / long B. The engine starts flat at the first test close, with its first eligible signal observed at that close.

### 3. Execution, sizing, and exits

Every close-t signal executes at **close t+1**, not at the price that generated it. At entry, allocate 100% of pre-fee equity as gross notional in a `1:beta` dollar ratio. For direction `d` (+1 for long spread, −1 for short):

```text
q_A = d * equity / (1+beta) / A_entry
q_B = -d * equity * beta / (1+beta) / B_entry
```

Keep those share quantities fixed until exit. Equity changes each session by `q_A * delta_A + q_B * delta_B`, less modeled costs. Gross exposure can drift, and the position is not generally dollar neutral or market-beta neutral. Log-price beta is an elasticity hedge, not an estimate of market beta.

Exit signals have the following priority:

1. `abs(z) >= stop`: z-score stop.
2. Long spread: `z >= -exit`; short spread: `z <= exit`: mean reversion.
3. Holding limit reached: time exit.

All execute on the next close. The holding limit counts close-to-close trading sessions. A z-score stop does **not** cap the loss, especially after a gap. The last open trade is administratively liquidated at the final sample close with exit costs. No new trade opens on that final close. If simulated equity falls to zero or below, the browser engine liquidates, stops trading, and flags capital exhaustion.

### 4. Costs and metrics

- **Execution:** combined fee + slippage rate in basis points, multiplied by absolute traded dollar notional. Both legs incur costs on entry and on exit. Closing costs use the actual exit notional.
- **Borrow:** annual assumed rate on the previous close's short notional, multiplied by actual calendar days elapsed / 365. Weekends and holidays are charged. No financing or cash interest is modeled.
- **Benchmark:** fixed-share 50/50 long-only allocation into both assets at the first test close, before costs; this is a reference exposure, not a risk-matched benchmark.
- **Sharpe:** average daily marked equity return / sample daily standard deviation × sqrt(252), with a zero risk-free rate and flat days included. Undefined Sharpe and win rates are displayed as unavailable.
- **CAGR:** `(final_equity / initial_equity)^(252 / test_observations) - 1`. The initial flat test observation is included in the session count.
- **Drawdown:** equity / prior peak equity − 1, using initial capital as the initial peak.
- **Win rate:** positive net P&L trades / all closed trades.

## Findings, not a profitability claim

See [research/RESULTS.md](research/RESULTS.md) for the reproducible baseline results. The familiar sector labels do not establish a stationary spread. In the shipped 504-session formation sample, **none of the five unadjusted cointegration tests rejects no cointegration at 5%**. The site displays that evidence rather than hiding unsuccessful examples or selecting a profitable default.

Changing thresholds or opening the sensitivity grid reuses the historical test period. The period is out-of-sample relative to the initial regression fit, but it becomes development data as you inspect and tune against it. It must not be described as an untouched holdout or a validated predictive edge. A subsequent study should preregister its rules and evaluate a separate period.

## Data and reproduction

`docs/data/prices.csv` contains split- and dividend-adjusted closes obtained through Yahoo Finance via yfinance (`auto_adjust=True`). `docs/data/market.json` stores the same rounded prices, pair metadata, formation diagnostics, download time, and CSV SHA-256. See [docs/data/README.md](docs/data/README.md).

Rebuild diagnostics **offline** from the checked-in CSV:

```bash
python research/prepare_data.py
```

Explicitly refresh the external snapshot:

```bash
python research/prepare_data.py --download
```

Refreshing data can change both prices and results because providers may revise adjusted histories. Do not interpret a refreshed snapshot as identical to the committed one. CI uses the committed data and never downloads market data.

Imported CSVs require exactly `Date,TICKER_A,TICKER_B`, strictly ascending ISO dates, unique asset names, positive prices, 300–20,000 observations, and a file smaller than 5 MB. Imports stay in browser memory and are not uploaded or persisted. They are assumed to be adjusted closes; that adjustment cannot be verified automatically. Browser imports do not compute cointegration p-values or half-lives.

## GitHub Pages

The deployable site is entirely inside **`docs/`**, and all asset paths are relative, so it works at a project path such as `/pairlab/`.

After the repository's publication is approved and the source is pushed:

1. Open repository **Settings → Pages**.
2. Select **Deploy from a branch**.
3. Select **main**, folder **/docs**, and save.

No build step is required. `.nojekyll` prevents Jekyll processing. `.github/workflows/check.yml` runs research checks on pushes and pull requests; Pages' branch deployment is managed by GitHub separately. A public repository supports free GitHub Pages hosting. A private source repository may require a paid GitHub plan.

GitHub Pages is configured to deploy the `main` branch, folder `/docs`. The public repository is https://github.com/Safe982/pairlab.

## Project structure

```text
docs/
  index.html            Workbench and methodology
  assets/
    app.js              UI, imports, exports, and orchestration
    engine.js           Pure backtest and CSV functions
    charts.js           Responsive SVG charts
    style.css           Desktop and mobile design
  data/
    prices.csv          Committed adjusted-close snapshot
    market.json         Prices, provenance, and formation diagnostics
    example.csv         Two-asset import template with real example data
research/
  prepare_data.py       Snapshot preparation and statistical diagnostics
  backtest.py           Independent numerical reference
  verify.py             Browser/Python parity check
  RESULTS.md            Generated baseline research table
tests/
  engine.test.mjs       Timing, accounting, data validation, and boundary checks
  emit-results.mjs      JavaScript results bridge for Python comparison
scripts/
  dev.mjs               Development-only static server
  summarize.mjs         Reproduce the baseline results table
```

## Scope and next experiments

The snapshot contains a small, retrospectively selected surviving universe. It does not solve survivorship or selection bias. Adjusted closes are a total-return proxy rather than executable quotes; dividends and corporate actions are not separate cash flows. Liquidity, market impact, short locates, financing, margin requirements, taxes, and changing borrow rates are not modeled. P-values are conditional, unadjusted evidence, not a ranking of investable strategies.

Next research steps are rolling formation/refitting, unit-root pretests, multiple-testing corrections for a screened universe, a separate holdout period, and exposure-matched benchmarks. These are **not implemented** in version 1.

## Resume wording

After reviewing and understanding the implementation, a factual project description is:

> Built a browser-based pairs trading research platform using JavaScript and Python, evaluating five asset pairs over 1,258 daily observations with formation-only OLS, cointegration diagnostics, next-close execution, transaction costs, and short-borrow accounting; verified 20 configurations against an independent numerical model.

Be prepared to explain why correlation differs from cointegration, why the log-price hedge ratio determines dollar sizing, how a close-to-close position earns P&L, and why tuning the test period weakens an out-of-sample claim.

## References

- [statsmodels: Engle–Granger cointegration test](https://www.statsmodels.org/stable/generated/statsmodels.tsa.stattools.coint.html)
- [yfinance: download API](https://ranaroussi.github.io/yfinance/reference/api/yfinance.download.html)
- [QuantConnect: research and backtesting pitfalls](https://www.quantconnect.com/docs/v2/writing-algorithms/key-concepts/research-guide)
- [GitHub: GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

Code is original project source. Market data remains subject to the source provider's terms; this repository does not grant a separate data license. The workbench makes no live trades and connects to no brokerage.
