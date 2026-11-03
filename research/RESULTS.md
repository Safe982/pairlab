# Baseline research results

This table is generated from the committed snapshot using `node scripts/summarize.mjs`. The example pairs were not screened for profitability.

Snapshot: **2020-01-02–2024-12-31**, 1258 observations per asset. CSV SHA-256: `e5479834200051bf175930dc872686db69e307aefd3e68485c9f9b9e3303cdc6`.

Formation: first 504 sessions. Lookback: 60. Entry/exit/stop: 2/0.5/4 standard deviations. Maximum hold: 40 sessions. Execution cost: 5 bps per traded dollar. Annual short borrow: 2%. Starting equity: $100,000.00.

| Pair | Formation p | Net return | Sharpe | Max drawdown | Trades | Win rate | Execution costs | Borrow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| KO/PEP | 0.1629 | -5.12% | -0.39 | -10.44% | 15 | 60.00% | $1,430.60 | $1,363.36 |
| XOM/CVX | 0.0723 | -7.95% | -0.49 | -11.23% | 15 | 33.33% | $1,427.90 | $922.26 |
| JPM/BAC | 0.7155 | -15.69% | -1.00 | -20.45% | 15 | 46.67% | $1,329.50 | $1,067.85 |
| V/MA | 0.3325 | 5.04% | 0.51 | -2.40% | 19 | 63.16% | $1,999.17 | $1,461.32 |
| GLD/IAU | 0.9659 | -4.73% | -5.03 | -4.73% | 43 | 0.00% | $4,202.79 | $574.48 |

## Interpretation

None of these five 504-session formation tests rejects no cointegration at the unadjusted 5% level. One baseline happens to have positive later returns; that is not evidence that the formation test established its stationarity or that the strategy has a persistent edge. Negative outcomes and the gold ETF example's friction-heavy trading remain visible.

The p-values concern formation log prices only. The test assumes I(1) series, and this project does not enforce separate unit-root tests or correct for multiple comparisons. The later evaluation is out-of-sample with respect to the regression fit, but inspecting these results and choosing parameters against them makes it development data. An untouched holdout remains future work.

Prices are adjusted-close proxies. Costs and borrow are assumptions, not measured historical fills. The baseline does not model market impact, financing, liquidity, margin requirements, tax, short availability, or separate dividend cash flows. See the main README and the site's assumptions for the complete convention.
