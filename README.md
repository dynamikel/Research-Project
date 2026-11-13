# GreenDC

**An Integrated Data-Driven Framework for Sustainable Data Centre Management and Optimization**

**Live site:** https://dynamikel.github.io/Research-Project/

GreenDC assesses data centre sustainability across six dimensions (energy, water, cooling, carbon, noise and location) and combines them into one **GreenScore**. This repository holds the research prototype: a free, interactive website that runs entirely in the browser, a Python reference implementation of the same calculations, test suites, data and a presentation guide.

## Repository layout

| Path | Contents |
|---|---|
| `website/index.html` | The web application |
| `website/assets/engine.js` | Calculation engine: indicators, scoring, anomaly detection, regression, simulator, recommendations, sensitivity analysis, detection benchmark, usability scoring, verification cases |
| `website/assets/app.js` | Interface for the framework and analytics pages, saving and projects |
| `website/assets/research.js` | Research pages: real-world cases, sensitivity, evaluation, presentation mode |
| `website/assets/styles.css` | Styles (light and dark, responsive) |
| `website/assets/vendor/` | Bundled Chart.js 4.4.1 (MIT) and IBM Plex fonts (OFL), so the site works offline |
| `python/greendc.py` | Python reference implementation (standard library only) |
| `tests/` | Node and Python test suites, including JavaScript/Python parity |
| `data/sample_dataset.csv` | One simulated year (Ashburn, 2 MW, evaporative cooling) with injected faults |
| `data/scenarios/*.json` | Importable project files: Ashburn C → A, Karachi liquid retrofit, best case |
| `scripts/make_scenarios.js` | Regenerates the sample dataset and scenario files |
| `docs/PRESENTATION_GUIDE.md` | Talk outline, demo script, likely questions with answers, key numbers |
| `.github/workflows/pages.yml` | Runs the tests on every push; can also publish `website/` when Pages uses GitHub Actions |
| `index.html`, `.nojekyll` | Forward the repository root to the website when Pages deploys from a branch |

## Website pages

**Framework**
- **Overview:** GreenScore gauge, headline indicators, six dimension cards, radar profile, abstract and keywords.
- **Data & facility:** simulate a facility (8 regions, 3 cooling systems) or upload a CSV; edit regional parameters; save, export and import projects.

**Six dimensions.** Each page has indicators, charts and a worked calculation that shows the formula with your data substituted.
- **Energy:** PUE, DCiE, CLF and PLF, IT utilisation, cost.
- **Water:** WUE (site and source), stress-weighted water.
- **Cooling:** CLF, CER, partial PUE, free-cooling utilisation.
- **Carbon:** location- and market-based Scope 2, CUE, ERF.
- **Noise:** boundary noise compared with the limit, plus an acoustic calculator.
- **Location:** regional sub-scores, and the same facility compared across eight locations.

**Analytics**
- **GreenScore:** adjustable weights, contributions, every sub-indicator.
- **Anomaly detection:** weather-adjusted residual, rolling z-score and IQR methods, with precision, recall and F1 against injected faults.
- **Predictive model:** OLS regression on outdoor temperature, point forecasts and a climate-warming scenario.
- **What-if simulator:** seven intervention levers and presets, with annual savings.
- **Recommendations:** rule-based advice quantified by the simulator, plus CSV and JSON export.

**Research**
- **Google case study:** Google's published 2023 figures taken step by step through published figures, indicators, scores and a partial GreenScore, with "what if" sliders. Simulated case studies follow on the same page.
- **Sensitivity analysis:** one-at-a-time weights, Monte Carlo over weights (Dirichlet) with rank stability, and benchmark-anchor perturbation.
- **Evaluation:**
  - Detection benchmark: 8 locations × 5 seeds, threshold sweep.
  - System Usability Scale questionnaire, with CSV export of responses.
- **Methodology:** standard and framework-defined indicators, regional data sources, 26 live verification checks, formulas, assumptions, limitations, references.
- **Presentation mode:** a 13-slide talk built from live results, with keyboard navigation and full screen.

## Running it

**Online:** open the live site above.

**Offline:** download the repository (Code → Download ZIP), unzip it and open `website/index.html` in a browser. No server or internet connection is needed.

**Local server (optional):**

```bash
cd website
```

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Saving your work

- **Automatic:** the current dataset, parameters, weights and simulator settings are saved in the browser.
- **Saved projects:** on the Data page, choose *Save project*, then *Open* it later.
- **Project files:** *Export project file* downloads a `.json` file with the full dataset, and *Import project file* opens it on any computer. The files in `data/scenarios/` open the same way.

Browser storage is per browser and per device; use project files to move work around.

## Verification

```bash
node tests/engine.test.js
```

```bash
python3 tests/test_greendc.py
```

The Node suite runs the 26 hand-calculated cases, identity checks (PUE = 1 + CLF + PLF, CUE = PUE × grid intensity × (1 − RE)), no double counting of renewables, utilisation under consolidation, and detection performance. The Python suite repeats the hand cases and confirms Python and JavaScript agree to 1e-9 on the sample dataset. The same hand cases run live on the website's Methodology page, and the deployment workflow runs both suites before publishing.

## Data sources

- **Grid carbon intensity and grid renewable share:** national 2024 values from the Our World in Data energy dataset (Ember; Energy Institute).
- **Google case study:** Google 2024 Environmental Report (2023 data). Industry reference values for context: Uptime Institute 2024 (PUE) and Shehabi et al. (2016) (WUE).
- **Indicative values:** water stress, climate, tariffs, distances and contracted renewables are indicative and labelled as such on the site.

## Input data format

Daily rows, comma separated. Required: `date, it_kwh, cooling_kwh, other_kwh, water_l`. Optional: `temp_c, it_util_pct, noise_dba, grid_ci, event`. Indicators that need a missing optional column are left out and the remaining weights are renormalised.

## Key formulas

| Indicator | Formula |
|---|---|
| PUE | (E_IT + E_cooling + E_other) ÷ E_IT = 1 + CLF + PLF |
| WUE | water (L) ÷ E_IT (kWh) |
| CUE | market-based CO₂ ÷ E_IT |
| CO₂ (location / market) | Σ E_total × grid intensity; × (1 − renewable share) |
| Noise at receiver | Lp = Lw − 20·log₁₀(r) − 8 |
| Sub-score | 100 × (x − worst) ÷ (best − worst), clamped 0–100 |
| GreenScore | Σ wᵢSᵢ ÷ Σ wᵢ (default weights: energy 25, carbon 25, water 15, cooling 15, noise 10, location 10) |
| SUS | 2.5 × Σ(odd items − 1 + 5 − even items) |
