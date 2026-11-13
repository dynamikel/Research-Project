"""
GreenDC reference implementation (Python).

Mirrors the formulas in website/assets/engine.js so results from the website
can be reproduced in notebooks, pandas pipelines or batch jobs.

Usage:
    python greendc.py ../data/sample_dataset.csv --location virginia
    python greendc.py my_facility.csv --grid-ci 420 --renewable 15 --water-stress 4.4 \
        --distance 120 --noise-limit 55

Only the Python standard library is required.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
from dataclasses import dataclass, field, asdict

DIMENSIONS = ["energy", "water", "cooling", "carbon", "noise", "location"]
DEFAULT_WEIGHTS = {"energy": 25, "water": 15, "cooling": 15, "carbon": 25, "noise": 10, "location": 10}

# Score anchors: value scoring 100 ("best") and value scoring 0 ("worst").
BENCHMARKS = {
    "pue": (1.10, 2.00),
    "it_util": (80, 20),
    "wue": (0.0, 2.5),
    "clf": (0.05, 0.60),
    "fcu": (100, 0),
    "cue": (0.0, 0.70),
    "noise_margin": (10, -10),
    "grid_ci": (50, 800),
    "water_stress": (0, 5),
    "free_cooling": (100, 0),
    "renewables": (100, 0),
    "distance": (1000, 50),
}

GRADES = [(90, "A+", "Exemplary"), (80, "A", "Leading"), (70, "B", "Good"), (60, "C", "Fair"),
          (50, "D", "Needs improvement"), (40, "E", "Poor"), (0, "F", "Critical")]

# grid_ci and grid_renewable_pct: national 2024 values, Our World in Data energy dataset
# (Ember; Energy Institute). Other values are indicative assumptions (see the Methodology page).
LOCATIONS = {
    "stockholm": dict(grid_ci=35, renewable_pct=70, grid_renewable_pct=69, water_stress=0.6, distance_m=600, noise_limit=45, price_kwh=0.09, price_water_m3=2.6),
    "dublin": dict(grid_ci=271, renewable_pct=40, grid_renewable_pct=47, water_stress=1.2, distance_m=350, noise_limit=45, price_kwh=0.22, price_water_m3=2.2),
    "virginia": dict(grid_ci=384, renewable_pct=25, grid_renewable_pct=24, water_stress=2.1, distance_m=250, noise_limit=50, price_kwh=0.08, price_water_m3=1.6),
    "phoenix": dict(grid_ci=384, renewable_pct=20, grid_renewable_pct=24, water_stress=4.6, distance_m=400, noise_limit=50, price_kwh=0.10, price_water_m3=1.9),
    "singapore": dict(grid_ci=499, renewable_pct=5, grid_renewable_pct=5, water_stress=2.8, distance_m=150, noise_limit=55, price_kwh=0.21, price_water_m3=2.0),
    "karachi": dict(grid_ci=374, renewable_pct=15, grid_renewable_pct=37, water_stress=4.4, distance_m=120, noise_limit=55, price_kwh=0.14, price_water_m3=0.6),
    "mumbai": dict(grid_ci=705, renewable_pct=12, grid_renewable_pct=20, water_stress=3.9, distance_m=120, noise_limit=55, price_kwh=0.11, price_water_m3=0.5),
    "sydney": dict(grid_ci=554, renewable_pct=30, grid_renewable_pct=35, water_stress=2.5, distance_m=300, noise_limit=50, price_kwh=0.18, price_water_m3=2.4),
}

CARBON_PRICE_PER_T = 85.0
WATER_ENERGY_FACTOR = 1.8  # litres consumed at the power plant per kWh generated


@dataclass
class Profile:
    grid_ci: float = 370
    renewable_pct: float = 25          # contracted by the facility (Carbon dimension)
    grid_renewable_pct: float = 12     # regional grid mix (Location dimension)
    water_stress: float = 2.1
    distance_m: float = 250
    noise_limit: float = 50
    price_kwh: float = 0.08
    price_water_m3: float = 1.6
    fc_threshold: float = 18.0
    carbon_price: float = 85.0


@dataclass
class Day:
    date: str
    it_kwh: float
    cooling_kwh: float
    other_kwh: float
    water_l: float
    temp_c: float = math.nan
    it_util_pct: float = math.nan
    noise_dba: float = math.nan
    grid_ci: float = math.nan
    event: str = ""


# --------------------------------------------------------------------------- helpers

def linear_score(value: float, best: float, worst: float) -> float:
    """100 at `best`, 0 at `worst`, linear in between, clamped to [0, 100]."""
    if value is None or not math.isfinite(value):
        return math.nan
    return max(0.0, min(100.0, (value - worst) / (best - worst) * 100))


def quantile(values, q):
    s = sorted(values)
    if not s:
        return math.nan
    pos = (len(s) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def sound_pressure_at(lw: float, distance_m: float) -> float:
    """Hemispherical free-field propagation: Lp = Lw - 20 log10(r) - 8."""
    return lw - 20 * math.log10(max(1.0, distance_m)) - 8


def combine_levels(levels) -> float:
    """Logarithmic sum: L = 10 log10(sum(10^(Li/10)))."""
    return 10 * math.log10(sum(10 ** (l / 10) for l in levels))


def grade_for(score: float):
    if not math.isfinite(score):
        return ("-", "Not enough data")
    for lo, g, label in GRADES:
        if score >= lo:
            return (g, label)


# --------------------------------------------------------------------------- I/O

def read_csv(path: str) -> list[Day]:
    days = []
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            row = {k.strip().lower(): (v or "").strip() for k, v in row.items()}

            def num(key):
                v = row.get(key, "")
                return float(v) if v != "" else math.nan

            it = num("it_kwh")
            if not row.get("date") or not math.isfinite(it) or it <= 0:
                continue
            days.append(Day(
                date=row["date"], it_kwh=it,
                cooling_kwh=num("cooling_kwh") if math.isfinite(num("cooling_kwh")) else 0.0,
                other_kwh=num("other_kwh") if math.isfinite(num("other_kwh")) else 0.0,
                water_l=num("water_l") if math.isfinite(num("water_l")) else 0.0,
                temp_c=num("temp_c"), it_util_pct=num("it_util_pct"), noise_dba=num("noise_dba"),
                grid_ci=num("grid_ci"), event=row.get("event", ""),
            ))
    days.sort(key=lambda d: d.date)
    return days


# --------------------------------------------------------------------------- indicators

def compute_metrics(days: list[Day], p: Profile) -> dict:
    ren = max(0.0, min(1.0, p.renewable_pct / 100))
    it = sum(d.it_kwh for d in days)
    cooling = sum(d.cooling_kwh for d in days)
    other = sum(d.other_kwh for d in days)
    water = sum(d.water_l for d in days)
    total = it + cooling + other
    co2_loc = sum((d.it_kwh + d.cooling_kwh + d.other_kwh) * (d.grid_ci if math.isfinite(d.grid_ci) else p.grid_ci) / 1000 for d in days)
    co2_mkt = co2_loc * (1 - ren)

    has_temp = all(math.isfinite(d.temp_c) for d in days)
    has_util = all(math.isfinite(d.it_util_pct) for d in days)
    has_noise = all(math.isfinite(d.noise_dba) for d in days)

    fc_days_pct = fcu_pct = math.nan
    if has_temp:
        cool = [d for d in days if d.temp_c < p.fc_threshold]
        fc_days_pct = len(cool) / len(days) * 100
        if cool:
            fcu_pct = sum(1 for d in cool if d.cooling_kwh / d.it_kwh < 0.15) / len(cool) * 100

    noise_p95 = quantile([d.noise_dba for d in days], 0.95) if has_noise else math.nan

    return {
        "days": len(days),
        "it_mwh": it / 1000, "cooling_mwh": cooling / 1000, "other_mwh": other / 1000, "total_mwh": total / 1000,
        "pue": total / it,
        "dcie_pct": it / total * 100,
        "it_util_pct": statistics.mean(d.it_util_pct for d in days) if has_util else math.nan,
        "water_m3": water / 1000,
        "wue": water / it,
        "wue_source": (water + WATER_ENERGY_FACTOR * total) / it,
        "water_stress_weighted_m3": water / 1000 * (1 + p.water_stress / 5),
        "clf": cooling / it,
        "plf": other / it,
        "erf": ren,
        "cer": it / cooling if cooling else math.nan,
        "ppue_cooling": (it + cooling) / it,
        "free_cooling_days_pct": fc_days_pct,
        "free_cooling_utilisation_pct": fcu_pct,
        "co2_location_t": co2_loc / 1000,
        "co2_market_t": co2_mkt / 1000,
        "cue": co2_mkt / it,
        "avg_grid_ci": co2_loc * 1000 / total,
        "noise_p95": noise_p95,
        "noise_margin": p.noise_limit - noise_p95,
        "noise_exceed_days": sum(1 for d in days if d.noise_dba > p.noise_limit) if has_noise else math.nan,
        "energy_cost": total * p.price_kwh,
        "water_cost": water / 1000 * p.price_water_m3,
        "carbon_cost": co2_mkt / 1000 * p.carbon_price,
    }


def _weighted(parts):
    valid = [(s, w) for s, w in parts if math.isfinite(s)]
    ws = sum(w for _, w in valid)
    return sum(s * w for s, w in valid) / ws if ws else math.nan


def score_dimensions(m: dict, p: Profile) -> dict:
    B = BENCHMARKS
    S = lambda v, key: linear_score(v, *B[key])
    return {
        "energy": _weighted([(S(m["pue"], "pue"), 0.8), (S(m["it_util_pct"], "it_util"), 0.2)]),
        "water": _weighted([(S(m["wue"], "wue"), 1)]),
        "cooling": _weighted([(S(m["clf"], "clf"), 0.75), (S(m["free_cooling_utilisation_pct"], "fcu"), 0.25)]),
        "carbon": _weighted([(S(m["cue"], "cue"), 1)]),
        "noise": _weighted([(S(m["noise_margin"], "noise_margin"), 1)]),
        "location": _weighted([
            (S(p.grid_ci, "grid_ci"), 1), (S(p.water_stress, "water_stress"), 1),
            (S(m["free_cooling_days_pct"], "free_cooling"), 1), (S(p.grid_renewable_pct, "renewables"), 1),
            (S(p.distance_m, "distance"), 1),
        ]),
    }


def green_score(scores: dict, weights: dict | None = None) -> float:
    w = weights or DEFAULT_WEIGHTS
    valid = [(scores[k], w[k]) for k in DIMENSIONS if math.isfinite(scores[k]) and w[k] > 0]
    ws = sum(x for _, x in valid)
    return sum(s * x for s, x in valid) / ws if ws else math.nan


# --------------------------------------------------------------------------- analytics

def sus_score(answers) -> float:
    """System Usability Scale (Brooke, 1996): odd items a-1, even items 5-a, sum x 2.5."""
    if len(answers) != 10 or any(not 1 <= a <= 5 for a in answers):
        return math.nan
    return sum((a - 1) if i % 2 == 0 else (5 - a) for i, a in enumerate(answers)) * 2.5


def annual_case(pue=None, wue=None, grid_ci=None, renewable_pct=None, energy_twh=None, water_billion_gal=None):
    """Score published annual totals. Unknown inputs drop their dimension; returns (scores, green_score, coverage)."""
    if wue is None and energy_twh and water_billion_gal and pue:
        wue = water_billion_gal * 1e9 * 3.78541 / (energy_twh * 1e9 / pue)
    cue = pue * grid_ci / 1000 * (1 - renewable_pct / 100) if None not in (pue, grid_ci, renewable_pct) else math.nan
    S = lambda v, key: linear_score(v if v is not None else math.nan, *BENCHMARKS[key])
    scores = {k: math.nan for k in DIMENSIONS}
    scores["energy"] = S(pue, "pue")
    scores["water"] = S(wue, "wue")
    scores["carbon"] = S(cue, "cue")
    gs = green_score(scores)
    w = DEFAULT_WEIGHTS
    coverage = sum(w[k] for k in DIMENSIONS if math.isfinite(scores[k])) / sum(w.values())
    return scores, gs, coverage

def linear_regression(xs, ys):
    pts = [(x, y) for x, y in zip(xs, ys) if math.isfinite(x) and math.isfinite(y)]
    n = len(pts)
    mx = sum(x for x, _ in pts) / n
    my = sum(y for _, y in pts) / n
    sxy = sum((x - mx) * (y - my) for x, y in pts)
    sxx = sum((x - mx) ** 2 for x, _ in pts)
    syy = sum((y - my) ** 2 for _, y in pts)
    slope = sxy / sxx if sxx else 0.0
    intercept = my - slope * mx
    ss_res = sum((y - (intercept + slope * x)) ** 2 for x, y in pts)
    return {"slope": slope, "intercept": intercept, "r2": 1 - ss_res / syy if syy else 0.0,
            "rmse": math.sqrt(ss_res / n), "n": n}


def detect_anomalies(values, method="residual", window=14, threshold=3.5, x=None):
    """Return a list of booleans (True = anomaly). Same three methods as the website."""
    n = len(values)
    if method == "iqr":
        q1, q3 = quantile(values, 0.25), quantile(values, 0.75)
        k = threshold / 2
        lo, hi = q1 - k * (q3 - q1), q3 + k * (q3 - q1)
        return [v < lo or v > hi for v in values]
    if method == "residual" and x is not None:
        reg = linear_regression(x, values)
        res = [v - (reg["intercept"] + reg["slope"] * t) for v, t in zip(values, x)]
        med = quantile(res, 0.5)
        mad = quantile([abs(r - med) for r in res], 0.5) * 1.4826 or 1e-9
        return [abs((r - med) / mad) > threshold for r in res]
    flags = []
    for i in range(n):
        win = values[max(0, i - window):i]
        if len(win) < min(7, window):
            flags.append(False)
            continue
        m, s = statistics.mean(win), statistics.stdev(win) or 1e-9
        flags.append(abs((values[i] - m) / s) > threshold)
    return flags


# --------------------------------------------------------------------------- CLI

def main():
    ap = argparse.ArgumentParser(description="GreenDC sustainability assessment")
    ap.add_argument("csv")
    ap.add_argument("--location", choices=sorted(LOCATIONS), help="use a regional preset")
    ap.add_argument("--grid-ci", type=float)
    ap.add_argument("--renewable", type=float)
    ap.add_argument("--water-stress", type=float)
    ap.add_argument("--distance", type=float)
    ap.add_argument("--noise-limit", type=float)
    ap.add_argument("--json", action="store_true", help="print the full report as JSON")
    a = ap.parse_args()

    p = Profile(**LOCATIONS[a.location]) if a.location else Profile()
    for attr, val in [("grid_ci", a.grid_ci), ("renewable_pct", a.renewable), ("water_stress", a.water_stress),
                      ("distance_m", a.distance), ("noise_limit", a.noise_limit)]:
        if val is not None:
            setattr(p, attr, val)

    days = read_csv(a.csv)
    m = compute_metrics(days, p)
    scores = score_dimensions(m, p)
    gs = green_score(scores)
    grade = grade_for(gs)

    flags = detect_anomalies([(d.it_kwh + d.cooling_kwh + d.other_kwh) / d.it_kwh for d in days],
                             method="residual" if all(math.isfinite(d.temp_c) for d in days) else "rolling",
                             x=[d.temp_c for d in days])
    anomalies = [d.date for d, f in zip(days, flags) if f]

    if a.json:
        clean = lambda v: None if isinstance(v, float) and not math.isfinite(v) else v
        print(json.dumps({"profile": asdict(p), "kpis": {k: clean(v) for k, v in m.items()},
                          "scores": {k: clean(v) for k, v in scores.items()},
                          "green_score": clean(gs), "grade": grade, "pue_anomalies": anomalies}, indent=2))
        return

    print(f"GreenDC assessment: {len(days)} days ({days[0].date} to {days[-1].date})")
    print(f"  PUE {m['pue']:.3f} | DCiE {m['dcie_pct']:.1f} % | WUE {m['wue']:.3f} L/kWh | CLF {m['clf']:.3f}")
    print(f"  CUE {m['cue']:.3f} kg/kWh | Scope 2 {m['co2_market_t']:.0f} t (market) / {m['co2_location_t']:.0f} t (location)")
    print(f"  Noise P95 {m['noise_p95']:.1f} dB(A), margin {m['noise_margin']:+.1f} dB")
    for k in DIMENSIONS:
        print(f"  {k:<9} {scores[k]:6.1f}")
    print(f"  GreenScore {gs:.1f}  grade {grade[0]} ({grade[1]})")
    print(f"  PUE anomalies: {', '.join(anomalies) if anomalies else 'none'}")


if __name__ == "__main__":
    main()
