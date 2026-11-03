"""Compare every daily equity value and every trade against the Python model."""
import json
import subprocess

import numpy as np
import pandas as pd

from backtest import ROOT, run

prices = pd.read_csv(ROOT / "docs/data/prices.csv", index_col="Date")
javascript = json.loads(subprocess.check_output(["node", "tests/emit-results.mjs"], cwd=ROOT))
observations = 0
for result in javascript:
    a, b = result["pair"].split("-")
    reference = run(prices, a, b, **result["config"])
    np.testing.assert_allclose(result["equity"], reference["equity"], rtol=1e-9, atol=1e-6)
    assert len(result["trades"]) == len(reference["trades"]), result["pair"]
    for js, py in zip(result["trades"], reference["trades"]):
        assert (js["entryDate"], js["exitDate"], js["reason"]) == (py["entryDate"], py["exitDate"], py["reason"])
        for field in ["pnl", "fees", "borrow"]:
            np.testing.assert_allclose(js[field], py[field], rtol=1e-8, atol=1e-6)
    observations += len(result["equity"])
print(f"PASS: {len(javascript)} configurations; {observations:,} daily equity observations and all trade accounting match the independent Python model.")
