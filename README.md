# GreenDC

**An Integrated Data-Driven Framework for Sustainable Data Centre Management and Optimization**

GreenDC assesses data centre sustainability across six dimensions (energy, water, cooling, carbon, noise and location) and combines them into one **GreenScore**. This repository holds the research prototype: a free, interactive website that runs entirely in the browser, plus a Python reference implementation of the same calculations.

## What's included

| Path | Contents |
|---|---|
| `website/index.html` | The web application (open it directly or serve the folder) |
| `website/assets/engine.js` | Calculation engine: indicators, scoring, anomaly detection, regression, simulator, recommendations |
| `website/assets/app.js` | User interface, charts and page routing |
| `website/assets/styles.css` | Styles (light and dark themes, responsive) |
| `python/greendc.py` | Python reference implementation (standard library only) |
| `data/sample_dataset.csv` | One simulated year (Ashburn, Virginia, 2 MW, evaporative cooling) with injected faults |

## Website pages

- **Overview**: GreenScore gauge, headline KPIs, six dimension cards, radar profile, abstract and keywords.
- **Data & facility**: simulate a facility (8 regional presets, 3 cooling systems, capacity, economiser adoption, seed) or upload a CSV; edit the regional parameters.
- **Energy**: facility and IT energy, PUE, DCiE, overhead, utilisation, cost, monthly breakdown, daily PUE.
- **Water**: WUE (site and source-inclusive), water-stress-weighted footprint, cost, WUE vs temperature.
- **Cooling**: Cooling Load Factor, Cooling Efficiency Ratio, cooling share, pPUE, free-cooling days and utilisation.
- **Carbon**: Scope 2 location- and market-based emissions, CUE, grid intensity, renewables, carbon cost.
- **Noise**: level at the nearest receiver vs the limit, implied sound power, and an acoustic calculator.
- **Location**: grid intensity, water stress, climate, renewables and distance sub-scores, plus a comparison of the same facility in eight locations.
- **GreenScore**: adjustable weights, contribution table, every sub-indicator and the grade scale.
- **Anomaly detection**: rolling z-score, IQR fences and weather-adjusted residual methods, with precision, recall and F1 against injected faults.
- **Predictive model**: OLS regression of PUE, cooling energy, WUE or noise on outdoor temperature; point forecasts and a climate-warming scenario.
- **What-if simulator**: seven intervention levers and three presets, with annual energy, water, CO₂e and cost savings.
- **Recommendations**: rule-based advice, each quantified by the simulator and ranked by GreenScore gain; export to CSV or JSON.
- **Methodology**: all formulas, benchmarks, model assumptions, data dictionary and references.

Every dimension page shows a **worked calculation**: the formula, then the same formula with your data substituted.

## Saving your work

- **Automatic:** the current dataset, facility parameters, weights and simulator settings are saved in your browser and come back when you reopen the site.
- **Saved projects:** on the Data page, name an analysis and choose *Save project* to keep several scenarios side by side, then *Open* any of them later.
- **Project files:** *Export project file* downloads a `.json` file with the full dataset and settings. *Import project file* opens it on any computer, which is the way to share an analysis or back it up.

Browser storage belongs to one browser on one device. Use project files to move work between devices.

## Verification

Every formula is checked against hand-calculated cases:

```bash
node tests/engine.test.js
```

```bash
python3 tests/test_greendc.py
```

The Node suite runs 22 hand-worked cases (PUE, DCiE, WUE, CUE, ERF, Scope 2, acoustics, OLS regression, robust z-score, GreenScore) plus identity checks on the sample data. Examples are PUE = 1 + CLF + PLF and CUE = PUE × grid intensity × (1 − RE). It also checks that contracted renewables are not double counted in the location score. The Python suite repeats the hand cases and confirms the Python and JavaScript results agree to 1e-9. The same hand cases run live on the website's Methodology page.

The Methodology page also separates **standardised indicators** (ISO/IEC 30134, The Green Grid, GHG Protocol) from **GreenDC-defined constructs** (scores, GreenScore, free-cooling utilisation, noise margin). It lists every modelling assumption, and covers limitations and references.

## Running it

The site is static, so no build step is needed. Charts and fonts load from public CDNs.

```bash
cd website
```

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Opening `website/index.html` directly in a browser also works.

To publish it free with GitHub Pages, copy the contents of `website/` to a `docs/` folder (or the repository root) and enable Pages for that folder in the repository settings.

## Python reference implementation

```bash
python3 python/greendc.py data/sample_dataset.csv --location virginia
```

Add `--json` for the full report. The Python module and `engine.js` produce identical PUE, WUE, CUE, dimension scores and GreenScore on the sample dataset.

## Input data format

Daily rows, comma separated. Required: `date, it_kwh, cooling_kwh, other_kwh, water_l`. Optional: `temp_c, it_util_pct, noise_dba, grid_ci, event`. Indicators that need a missing optional column are left out and the remaining weights are renormalised.

## Key formulas

| Indicator | Formula |
|---|---|
| PUE | (E_IT + E_cooling + E_other) ÷ E_IT |
| DCiE | E_IT ÷ E_total × 100 |
| WUE | water (L) ÷ E_IT (kWh) |
| CLF / CER | E_cooling ÷ E_IT / E_IT ÷ E_cooling |
| CO₂ (location) | Σ E_total × grid intensity |
| CO₂ (market) | CO₂_loc × (1 − renewable share) |
| CUE | CO₂_mkt ÷ E_IT |
| Noise at receiver | Lp = Lw − 20·log₁₀(r) − 8 |
| Sub-score | 100 × (x − worst) ÷ (best − worst), clamped 0–100 |
| GreenScore | Σ wᵢSᵢ ÷ Σ wᵢ (default weights: energy 25, carbon 25, water 15, cooling 15, noise 10, location 10) |

Regional presets are rounded indicative values for research demonstration, not certified data.
