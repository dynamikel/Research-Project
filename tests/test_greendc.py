"""Run with: python3 tests/test_greendc.py
Same hand-calculated cases as engine.selfTest(), plus parity with the JavaScript engine."""
import json
import math
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "python"))
import greendc as g  # noqa: E402

failures = 0


def check(name, actual, expected, tol=1e-4):
    global failures
    ok = math.isclose(actual, expected, rel_tol=tol, abs_tol=tol)
    failures += not ok
    print("PASS" if ok else "FAIL", name, "" if ok else f"({actual} != {expected})")


days = [
    g.Day("2025-01-01", 1000, 300, 100, 1500, temp_c=10, it_util_pct=50, noise_dba=40, grid_ci=400),
    g.Day("2025-01-02", 1000, 200, 100, 500, temp_c=20, it_util_pct=70, noise_dba=44, grid_ci=500),
]
p = g.Profile(grid_ci=450, renewable_pct=25, grid_renewable_pct=25, water_stress=2.5, distance_m=525,
              noise_limit=50, price_kwh=0.1, price_water_m3=2, carbon_price=100)
m = g.compute_metrics(days, p)
check("PUE", m["pue"], 1.35)
check("DCiE", m["dcie_pct"], 74.0740741)
check("PUE = 1 + CLF + PLF", 1 + m["clf"] + m["plf"], 1.35)
check("WUE (site)", m["wue"], 1.0)
check("WUE (source)", m["wue_source"], 3.43)
check("CER", m["cer"], 4.0)
check("Location-based CO2 (t)", m["co2_location_t"], 1.21)
check("Market-based CO2 (t)", m["co2_market_t"], 0.9075)
check("CUE", m["cue"], 0.45375)
check("Energy-weighted grid CI", m["avg_grid_ci"], 448.148148)
check("Carbon cost", m["carbon_cost"], 90.75)
check("Free-cooling days", m["free_cooling_days_pct"], 50)
check("Linear score", g.linear_score(1.55, 1.1, 2.0), 50)
check("Linear score clamped", g.linear_score(2.4, 1.1, 2.0), 0)
check("Sound pressure at 100 m", g.sound_pressure_at(100, 100), 52)
check("Two equal sources", g.combine_levels([90, 90]), 93.0103)
check("95th percentile", g.quantile(list(range(1, 22)), 0.95), 20)
reg = g.linear_regression([0, 1, 2, 3, 4], [2, 5, 8, 11, 14])
check("OLS slope", reg["slope"], 3)
check("OLS intercept", reg["intercept"], 2)
check("OLS R2", reg["r2"], 1)
check("GreenScore", g.green_score({"energy": 100, "water": 0, "cooling": 50, "carbon": 50, "noise": 50, "location": 50}), 55)

# Parity with the JavaScript engine on the sample dataset
sample = os.path.join(ROOT, "data", "sample_dataset.csv")
js = subprocess.run(["node", "-e", f"""
const G=require({json.dumps(os.path.join(ROOT, 'website/assets/engine.js'))});const fs=require('fs');
const a=G.analyse(G.parseCSV(fs.readFileSync({json.dumps(sample)},'utf8')),G.profileFromLocation('virginia','evaporative'));
console.log(JSON.stringify({{pue:a.metrics.kpis.pue,wue:a.metrics.kpis.wue,cue:a.metrics.kpis.cue,gs:a.green.score,scores:Object.fromEntries(Object.entries(a.scores).map(([k,v])=>[k,v.score]))}}));
"""], capture_output=True, text=True)
if js.returncode == 0:
    ref = json.loads(js.stdout)
    pp = g.Profile(**g.LOCATIONS["virginia"])
    d = g.read_csv(sample)
    mm = g.compute_metrics(d, pp)
    ss = g.score_dimensions(mm, pp)
    check("parity PUE", mm["pue"], ref["pue"], 1e-9)
    check("parity WUE", mm["wue"], ref["wue"], 1e-9)
    check("parity CUE", mm["cue"], ref["cue"], 1e-9)
    for key in g.DIMENSIONS:
        check(f"parity {key} score", ss[key], ref["scores"][key], 1e-9)
    check("parity GreenScore", g.green_score(ss), ref["gs"], 1e-9)
else:
    print("SKIP parity (node not available)")

print(f"\n{failures} check(s) failed" if failures else "\nAll checks passed")
sys.exit(1 if failures else 0)
