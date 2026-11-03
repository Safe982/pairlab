# Price snapshot

Source: **Yahoo Finance**, retrieved with **yfinance 0.2.66**, using adjusted daily closes. The exact download time and CSV SHA-256 are in `market.json` under `meta`.

```python
yfinance.download(
    ["KO", "PEP", "XOM", "CVX", "JPM", "BAC", "V", "MA", "GLD", "IAU"],
    start="2020-01-01", end="2025-01-01",
    auto_adjust=True, progress=False, threads=False,
)["Close"]
```

The inclusive start/end of the resulting aligned snapshot is **2020-01-02–2024-12-31**, with 1,258 common trading observations. `end` in the request is exclusive. Common rows are retained with `dropna()`, then prices are rounded to six decimal places before diagnostics or backtests. Neither missing-price forward fills nor synthetic prices are used.

`prices.csv` contains all ten assets. `example.csv` is its Date/KO/PEP subset for testing the three-column browser import. The `market.json` snapshot includes the same prices and formation-only tests for the first 252 and 504 observations of each pair. Its data is bundled so the deployed website does not call Yahoo, depend on cross-origin market-data requests, or require secrets.

The five sector pairs are illustrative examples, not the output of an exhaustive screen. Yahoo adjusted closes account for splits and dividends using the provider's adjustment conventions. This simulation treats them as a total-return price proxy. It does not reconstruct unadjusted execution prices, dividend cash flows, or stock split share adjustments separately.

Historical adjusted data may be revised. Run `python research/prepare_data.py` to reproduce the diagnostics from the committed snapshot without downloading anything. Only `--download` replaces the snapshot. All files are intended for this educational research example, subject to the data provider's terms.
