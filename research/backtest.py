"""Independent pandas/NumPy reference for PairLab's JavaScript engine.

Example: python research/backtest.py --pair KO-PEP --output /tmp/ko-pep.json
This is deliberately a small, readable research script, not a trading service.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEFAULTS = dict(formation=504, lookback=60, entry=2, exit=0.5, stop=4,
                maxHold=40, costBps=5, borrowPct=2, capital=100000)


def run(prices, a, b, **overrides):
    c = DEFAULTS | overrides
    logs = np.log(prices[[a, b]])
    formation = logs.iloc[:c["formation"]]
    beta, alpha = np.polyfit(formation[b], formation[a], 1)
    residual = logs[a] - alpha - beta * logs[b]
    prior = residual.shift(1).rolling(c["lookback"])
    z = (residual - prior.mean()) / prior.std(ddof=1)
    equity = c["capital"]
    quantities = np.zeros(2)
    position = None
    order = None
    rows, trades = [], []
    raw = prices[[a, b]].values
    dates = pd.to_datetime(prices.index)

    def liquidate(i, reason):
        nonlocal equity, position, quantities
        fee = float(np.abs(quantities * raw[i]).sum()) * c["costBps"] / 10000
        equity -= fee
        position["fees"] += fee
        trades.append(dict(entryDate=str(prices.index[position["entry"]]),
                           exitDate=str(prices.index[i]), reason=reason,
                           pnl=equity-position["before"], fees=position["fees"],
                           borrow=position["borrow"]))
        quantities = np.zeros(2)
        position = None

    for i in range(c["formation"], len(prices)):
        if position is not None:
            gross = float(np.dot(quantities, raw[i] - raw[i-1]))
            calendar_days = (dates[i] - dates[i-1]).days
            short = float(np.abs(np.minimum(quantities, 0) * raw[i-1]).sum())
            borrow = short * c["borrowPct"] / 100 * calendar_days / 365
            equity += gross - borrow
            position["borrow"] += borrow
        if order is not None:
            if order[0] == "exit" and position is not None:
                liquidate(i, order[1])
            elif order[0] == "entry" and position is None and i < len(prices)-1:
                direction = order[1]
                quantities = direction * equity * np.array([1, -beta]) / (1+beta) / raw[i]
                fee = equity * c["costBps"] / 10000
                position = dict(entry=i, before=equity, direction=direction, fees=fee, borrow=0)
                equity -= fee
        order = None
        if i == len(prices)-1 and position is not None:
            liquidate(i, "End of sample")
        if i < len(prices)-1:
            zi = float(z.iloc[i])
            if position is not None:
                if abs(zi) >= c["stop"]:
                    order = ("exit", "Z-score stop")
                elif ((position["direction"] == 1 and zi >= -c["exit"]) or
                      (position["direction"] == -1 and zi <= c["exit"])):
                    order = ("exit", "Mean reversion")
                elif i-position["entry"]+1 >= c["maxHold"]:
                    order = ("exit", "Time limit")
            elif c["entry"] <= abs(zi) < c["stop"]:
                order = ("entry", 1 if zi < 0 else -1)
        rows.append(float(equity))
    return {"alpha": float(alpha), "beta": float(beta), "equity": rows, "trades": trades}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pair", default="KO-PEP")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    prices = pd.read_csv(ROOT / "docs/data/prices.csv", index_col="Date")
    a, b = args.pair.split("-")
    result = run(prices, a, b)
    result["pair"] = args.pair
    result["config"] = DEFAULTS
    result["netReturn"] = result["equity"][-1] / DEFAULTS["capital"]-1
    text = json.dumps(result, indent=2, allow_nan=False)
    if args.output:
        args.output.write_text(text + "\n")
        print(f"Saved {args.output}; {len(result['trades'])} trades; net return {result['netReturn']:.2%}")
    else:
        print(text)
