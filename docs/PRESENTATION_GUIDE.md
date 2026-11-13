# GreenDC presentation guide

This guide is for presenting GreenDC as a research project: a talk outline that follows the built-in slides, a live demo script, answers to questions examiners are likely to ask, and a checklist for the day.

All numbers below come from the website with its default settings: **Google's data centre fleet, 2023**, with default weights. The site recalculates them live, so if you change the settings, read the numbers from the screen rather than from this guide.

---

## 1. The one sentence to explain the data

> "The dashboard uses Google's 2023 data centre figures. The yearly totals are exactly what Google published (24 TWh of electricity, PUE 1.10, 6.1 billion gallons of water, 64 % carbon-free power). Google does not publish daily data, so GreenDC models the day-to-day pattern, noise and site details around those totals."

Say this early, when the dashboard first appears (slide 5). It answers the most likely question before anyone asks it.

---

## 2. Before the day

- [ ] Open the public site and click through every page once: `https://dynamikel.github.io/Research-Project/`
- [ ] Copy the project to a USB stick as a backup: download the repository as a ZIP from GitHub and unzip it. Opening `website/index.html` by double-clicking works **with no internet connection**, because the charts and fonts are bundled.
- [ ] On the presentation laptop, open **Presentation mode** and type your name, institution and date in the presenter field. It is remembered in that browser.
- [ ] If you changed anything while practising, press **Start over** on the Data page. The site returns to Google's 2023 data, which matches the numbers in this guide.
- [ ] Optional: run 3–5 people through the usability study (Evaluation page) so you can report a real SUS score. Export the CSV afterwards.

The **▶ Present** button at the top right of every page opens Presentation mode. On the Overview page, the Research highlights strip gives a one-glance summary of the evidence.

Keyboard in Presentation mode: → or Space for the next slide, ← for the previous one, Home for the first. **Full screen** fills the projector, and each slide has an **Open the live page** link.

---

## 3. Talk outline (about 12–15 minutes)

| Slide | Time | What to say |
|---|---|---|
| 1. Title | 0:30 | One sentence: GreenDC measures a data centre's environmental impact across six dimensions in one framework. |
| 2. The problem | 1:30 | Monitoring usually tracks PUE alone. A facility can have an excellent PUE and still use scarce water, run on a coal-heavy grid or disturb its neighbours. Quote the three reference figures. |
| 3. Research question | 1:00 | Read the question. Name the three aims: standard indicators, one transparent score, measured recommendations. |
| 4. The framework | 1:30 | Walk the five steps. Make the distinction clear: the indicators come from ISO/IEC 30134, The Green Grid and the GHG Protocol; the scores, the GreenScore, weather-adjusted detection and the simulator are your contribution. |
| 5. Live assessment | 1:30 | Say the one sentence from section 1. Google's fleet scores **82.1 (grade A)**. Energy (94) and cooling (98) are excellent; water (58) is the weakest dimension; carbon (78) depends on the 36 % of electricity that is not carbon-free. |
| 6. Google case | 2:00 | The four steps with Google's published numbers only: 24 TWh, PUE 1.10, 6.1 billion gallons, 64 % carbon-free → WUE 1.06 L/kWh and CUE 0.156 → energy 100, water 58, carbon 78 → **81.7 (A)**. It almost equals the dashboard's 82.1, which shows the modelled parts do not drive the result. |
| 7. Location matters | 1:00 | The same campus design scores very differently by region: grid carbon, water stress and climate decide much of the footprint. |
| 8. Anomaly detection | 1:30 | Across 40 simulated years, the weather-adjusted method has the best F1 on PUE (0.72 against 0.48 and 0.44). Removing the temperature effect stops hot days being flagged as faults. |
| 9. What-if | 1:30 | On Google's data: 100 % carbon-free power takes 82.1 to 87.7; adding 50 % water reuse reaches **A+ (90.7)**; with a 2 °C setpoint and 10 % server consolidation, 91.7. A typical small facility (simulated Ashburn) goes from C to A. |
| 10. Robustness | 1:00 | Location rankings barely change under 2,000 random weightings (mean Spearman ρ 0.98). Moving every benchmark anchor by ±10 % keeps Google within 78.8–84.3. |
| 11. Verification | 0:45 | 26 hand-calculated checks pass live in the browser. Python and JavaScript agree exactly, also on Google's dataset. |
| 12. Limitations | 1:00 | Be open about them; examiners respect it. |
| 13. Conclusion | 0:30 | One sentence, then invite questions. |

---

## 4. Live demo (3–5 minutes, optional)

Pick two or three of these; each takes about a minute.

1. **Worked calculation:** go to **Energy** and point at "PUE = 24,000,000 ÷ 21,818,182 = 1.100". That is Google's 24 TWh divided by its IT energy. Every number on the site can be traced to its formula like this.
2. **Google step by step:** on **Google case study**, scroll through Steps 1–4, then click **100 % carbon-free** (81.7 → 90.2) and **Halve water use** (→ 86.6). Drag PUE to 1.56, the industry average, to show the score falling to 63.3 (C).
3. **Simulator:** on **What-if simulator**, click **Net-zero path**: Google moves from 82.1 (A) to 90.5 (A+).
4. **Anomaly detection:** on **Anomaly detection**, PUE with the weather-adjusted method flags four days (25–26 January and 5–6 June 2023), all of them injected cooling faults. Switch to **IQR fences**: it finds none, because seasonal variation hides the faults.
5. **Verification:** on **Methodology**, scroll to Verification: 26 of 26 checks pass.

To return to Google's data at any time: **Data & facility → Load Google 2023 (default)**.

---

## 5. Likely questions and suggested answers

**Is this Google's real data?**
The yearly totals are. Energy, PUE, water, carbon-free share and grid intensity match Google's 2023 Environmental Report exactly, and the tests check this. Google does not publish daily figures, noise or site details, so those are modelled around the totals. The Google case study page shows the score from the published figures alone (81.7), and the full dashboard gives 82.1. The modelled parts change the result by less than half a point.

**Why these weights (energy 25, carbon 25, water 15, cooling 15, noise 10, location 10)?**
Energy and carbon are the most established and most material impacts, so they carry the most weight. The weights are a stated assumption and users can change them. The sensitivity analysis shows the conclusions do not depend on them: over 2,000 random weightings, location rankings keep a mean Spearman correlation of 0.98 with the default ranking, and the top site never changes.

**Isn't the scale harsh? An average facility would score low.**
Yes, deliberately. The anchors define 100 as leading practice (PUE 1.10, zero water, zero carbon), so a sustainability score shows how far a facility is from best practice. If Google's PUE were the industry average of 1.56, its score would fall from 81.7 to 63.3. Moving every anchor by ±10 % changes Google's score by only about ±3 points.

**Why is water Google's weakest dimension?**
Google uses about 1.06 litres of water per kWh of IT energy, mainly for evaporative cooling. That is better than the industry average of 1.8 L/kWh but far from zero, so it scores 58. Water reuse is the second-largest improvement in the what-if analysis.

**How do you know the framework works on real facilities?**
(1) The indicators follow published standards, and 26 hand-calculated checks confirm the code computes them correctly. (2) The Google case applies the framework to real published figures. (3) Any facility can upload its own daily CSV. Using real sensor data from one site is the main item of future work.

**How realistic is the simulator?**
It is physics-informed: chiller efficiency falls as outdoor temperature rises, free cooling depends on temperature, server power follows a linear idle-to-peak model, and noise follows the fan laws. For the Google dataset, the totals are then scaled to Google's published figures. Every coefficient that is assumed rather than measured is listed in the Methodology page's assumptions table.

**What is new compared with just using PUE, WUE and CUE?**
The combination: six dimensions in one framework, including noise and location, which usual dashboards leave out; one transparent, benchmark-anchored score; weather-adjusted anomaly detection; and recommendations quantified by simulation rather than generic advice.

**Why does weather-adjusted detection work better?**
PUE rises with outdoor temperature because chillers work harder. A rolling z-score or a fixed range treats a hot week as abnormal, which produces false alarms and hides real faults during warm periods. Regressing out temperature first and using a robust (median-based) z-score leaves only the unexplained deviations.

**Are the regional values reliable?**
Grid carbon intensity and grid renewable share are cited national values from Our World in Data (Ember and Energy Institute data). Water stress, climate, tariffs and distances are indicative and labelled as such.

**How did you check the calculations are correct?**
In three ways: hand-calculated reference cases (26 checks), identity checks on real outputs (for example PUE = 1 + CLF + PLF), and two independent implementations (Python and JavaScript) that agree exactly, including on Google's dataset. All of them run automatically: `node tests/engine.test.js` and `python3 tests/test_greendc.py`.

**Why is market-based carbon calculated with the grid average?**
This is a simplification and is listed as a limitation. The GHG Protocol asks for a residual-mix factor, which is usually higher. Google's 64 % is hourly carbon-free energy, which also counts nuclear.

**Could this scale to many data centres or real-time data?**
Yes. The engine already handles Google's fleet of 24 TWh a year. Adding hourly data or several sites mainly means extending the input format. A portfolio view is listed as future work.

**What did users think of it?**
If you ran the usability study, report the mean SUS score and the participant count (68 is the average across published studies). If you did not, say it is planned future work and show the built-in questionnaire.

---

## 6. Key numbers (default settings: Google 2023)

| Item | Value |
|---|---|
| Published inputs | 24 TWh; PUE 1.10; 6.1 billion gallons of water; 64 % carbon-free; US grid 393 g/kWh |
| Derived indicators | IT energy 21.82 TWh; WUE 1.058 L/kWh; CUE 0.156 kg/kWh; emissions 9.43 Mt at grid average, 3.40 Mt after carbon-free supply |
| GreenScore (dashboard) | **82.1 (A)**: energy 93.7, water 57.7, cooling 97.5, carbon 77.8, noise 100, location 59.8 |
| GreenScore (published figures only) | **81.7 (A)** over energy, water and carbon |
| Google what-if | 82.1 → 87.7 (100 % carbon-free) → 90.7 A+ (+50 % water reuse) → 91.2 (+2 °C setpoint) → 91.7 (+10 % consolidation) |
| Simulator presets | Quick wins 82.3 (A); Deep retrofit 86.6 (A); Net-zero path 90.5 (A+) |
| Recommendations | 100 % renewable supply +5.6; water reuse +3.1; server consolidation +0.6 |
| PUE vs temperature | PUE = 1.072 + 0.0021 × T, R² 0.83 |
| Detection, PUE, 40 years | weather-adjusted F1 0.72; rolling z 0.48; IQR 0.44 |
| Weight robustness | mean Spearman ρ 0.98 (any weighting) |
| Anchor robustness | ±10 % anchors: Google 78.8 – 84.3 (90 % interval) |
| Simulated examples | Ashburn 2 MW: 62.5 (C) → 82.4 (A); Karachi liquid + retrofit 87.3 (A); upper bound 99.2 (A+) |
| Verification | 26 / 26 checks pass; Python and JavaScript agree exactly |
