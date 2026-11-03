"""Create the immutable, public price snapshot and formation diagnostics.

Run with --download to refresh Yahoo Finance data; otherwise rebuild from the
checked-in CSV. The website never needs credentials or a running Python server.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from statsmodels.tsa.stattools import coint

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs" / "data"
PAIRS = [
    ("KO", "PEP", "Coca-Cola", "PepsiCo", "Consumer staples"),
    ("XOM", "CVX", "Exxon Mobil", "Chevron", "Energy"),
    ("JPM", "BAC", "JPMorgan Chase", "Bank of America", "Banking"),
    ("V", "MA", "Visa", "Mastercard", "Payments"),
    ("GLD", "IAU", "SPDR Gold Shares", "iShares Gold Trust", "Gold ETFs"),
]


def diagnostics(a, b):
    y, x = np.log(a), np.log(b)
    beta, alpha = np.polyfit(x, y, 1)
    residual = y - alpha - beta * x
    slope, _ = np.polyfit(residual[:-1], np.diff(residual), 1)
    phi = 1 + slope
    half_life = float(-np.log(2) / np.log(phi)) if 0 < phi < 1 else None
    statistic, pvalue, critical = coint(y, x, trend="c", autolag="aic")
    return {
        "alpha": float(alpha), "beta": float(beta),
        "pvalue": float(pvalue), "statistic": float(statistic),
        "criticalValues": [float(v) for v in critical],
        "halfLife": half_life,
        "returnCorrelation": float(np.corrcoef(np.diff(y), np.diff(x))[0, 1]),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    DATA.mkdir(exist_ok=True)
    csv_path = DATA / "prices.csv"
    if args.download:
        import yfinance as yf

        symbols = [s for p in PAIRS for s in p[:2]]
        raw = yf.download(symbols, start="2020-01-01", end="2025-01-01",
                          auto_adjust=True, progress=False, threads=False)
        prices = raw["Close"][symbols].dropna().round(6)
        if len(prices) < 1200:
            raise RuntimeError(f"Incomplete download: {len(prices)} common observations")
        prices.index = prices.index.strftime("%Y-%m-%d")
        prices.index.name = "Date"
        prices.to_csv(csv_path, float_format="%.6f")
        fetched = datetime.now(timezone.utc).isoformat()
    else:
        prices = pd.read_csv(csv_path, index_col="Date")
        old_path = DATA / "market.json"
        fetched = json.loads(old_path.read_text())["meta"]["retrievedAt"] if old_path.exists() else None

    prices = pd.read_csv(csv_path, index_col="Date")
    pairs = []
    for a, b, name_a, name_b, sector in PAIRS:
        pairs.append({
            "id": f"{a}-{b}", "a": a, "b": b, "nameA": name_a,
            "nameB": name_b, "sector": sector,
            "diagnostics": {str(n): diagnostics(prices[a].values[:n], prices[b].values[:n])
                            for n in (252, 504)},
        })
    payload = {
        "meta": {
            "source": "Yahoo Finance via yfinance 0.2.66",
            "sourceUrl": "https://finance.yahoo.com/",
            "priceType": "Split- and dividend-adjusted daily close (auto_adjust=True)",
            "retrievedAt": fetched,
            "start": prices.index[0], "end": prices.index[-1],
            "observations": len(prices),
            "sha256": hashlib.sha256(csv_path.read_bytes()).hexdigest(),
            "selection": "Five illustrative sector pairs, not selected by backtest profitability. No exhaustive screening or multiple-testing correction.",
        },
        "dates": list(prices.index),
        "prices": {col: prices[col].tolist() for col in prices.columns},
        "pairs": pairs,
    }
    (DATA / "market.json").write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n")
    print(f"Prepared {len(prices)} daily observations, {len(pairs)} pairs; {prices.index[0]} to {prices.index[-1]}")
    for pair in pairs:
        print(pair["id"], "formation p =", round(pair["diagnostics"]["504"]["pvalue"], 4))


if __name__ == "__main__":
    main()
