# GreenDC presentation guide

This guide is for presenting GreenDC as a research project: a talk outline that follows the built-in slides, a live demo script, answers to questions examiners are likely to ask, and a checklist for the day.

All numbers below come from the website with its default settings: the Ashburn, Virginia facility, seed 42 and default weights. The site recalculates them live, so if you change the settings, read the numbers from the screen rather than from this guide.

---

## 1. Before the day

- [ ] Open the public site and click through every page once: `https://dynamikel.github.io/Research-Project/`
- [ ] Copy the project to a USB stick as a backup: download the repository as a ZIP from GitHub and unzip it. Opening `website/index.html` by double-clicking works **with no internet connection**, because the charts and fonts are bundled.
- [ ] On the presentation laptop, open **Presentation mode** and type your name, institution and date in the presenter field. It is remembered in that browser.
- [ ] Press **Start over** on the Data page so the site shows the default Ashburn facility, which matches the numbers in this guide.
- [ ] Optional: run 3–5 people through the usability study (Evaluation page) so you can report a real SUS score. Export the CSV afterwards.
- [ ] Optional: import the three scenario files in `data/scenarios/` and save them as projects, so you can switch between them with one click.

The **▶ Present** button at the top right of every page opens Presentation mode. On the Overview page, the Research highlights strip gives a one-glance summary of the evidence.

Keyboard in Presentation mode: → or Space for the next slide, ← for the previous one, Home for the first. **Full screen** fills the projector, and each slide has an **Open the live page** link.

---

## 2. Talk outline (about 12–15 minutes)

| Slide | Time | What to say |
|---|---|---|
| 1. Title | 0:30 | One sentence: GreenDC measures a data centre's environmental impact across six dimensions in one framework. |
| 2. The problem | 1:30 | Monitoring usually tracks PUE alone. A facility can have an excellent PUE and still use scarce water, run on a coal-heavy grid or disturb its neighbours. Quote the three reference figures. |
| 3. Research question | 1:00 | Read the question. Name the three aims: standard indicators, one transparent score, measured recommendations. |
| 4. The framework | 1:30 | Walk the five steps. Make the distinction clear: the indicators come from ISO/IEC 30134, The Green Grid and the GHG Protocol; the scores, the GreenScore, weather-adjusted detection and the simulator are your contribution. |
| 5. Live assessment | 1:00 | Ashburn scores 62.5 (grade C). Carbon (47) and location (44) pull it down; energy (77) is good. |
| 6. Published data | 1:30 | Leading operators score A or A+, while an industry-average facility on the world-average grid scores F. Mention coverage: public reports only support three of the six dimensions. |
| 7. Location matters | 1:00 | The same facility scores from about 35 (Mumbai) to 86 (Stockholm). Siting decides much of the footprint. |
| 8. Anomaly detection | 1:30 | Across 40 simulated years, the weather-adjusted method has the best F1 on PUE (0.72 against 0.48 and 0.44). Removing the temperature effect stops hot days being flagged as faults. |
| 9. What-if | 1:30 | Ashburn goes from C (62.5) to A (82.4) in four steps. Karachi reaches A only with liquid cooling plus upgrades. The upper bound of the scale is 99.2. |
| 10. Robustness | 1:00 | Location rankings barely change under 2,000 random weightings (mean Spearman ρ 0.98). Moving every benchmark anchor by ±10 % shifts Ashburn by about ±3 points. |
| 11. Verification | 0:45 | 26 hand-calculated checks pass live in the browser, and the Python and JavaScript versions agree to 1e-9. |
| 12. Limitations | 1:00 | Be open about them; examiners respect it. |
| 13. Conclusion | 0:30 | One sentence, then invite questions. |

---

## 3. Live demo (3–5 minutes, optional)

Pick two or three of these; each takes about a minute.

1. **Worked calculation:** go to **Energy** and point at "PUE = 18,144 ÷ 14,108 = 1.286". Every number on the site can be traced to its formula like this.
2. **Change the location:** on **Data & facility**, choose Karachi and **Generate dataset**. The GreenScore drops to about 44 (E). Then go back to Ashburn.
3. **Anomaly detection:** on **Anomaly detection**, PUE with the weather-adjusted method flags four days, all of them injected cooling faults (precision 100 %, recall 80 %). Switch to **IQR fences**: it finds none, because seasonal variation hides the faults.
4. **Simulator:** on **What-if simulator**, click **Net-zero path** and watch the grade change. Or use the **Open** buttons on **Real-world cases** to load each step of the Ashburn path.
5. **Verification:** on **Methodology**, scroll to Verification: 26 of 26 checks pass.

---

## 4. Likely questions and suggested answers

**Why these weights (energy 25, carbon 25, water 15, cooling 15, noise 10, location 10)?**
Energy and carbon are the most established and most material impacts, so they carry the most weight. The weights are a stated assumption and users can change them. The sensitivity analysis shows the conclusions do not depend on them: over 2,000 random weightings, location rankings keep a mean Spearman correlation of 0.98 with the default ranking, and the top site never changes.

**Why does the industry average get an F? Isn't that too harsh?**
The anchors define 100 as leading practice (PUE 1.10, zero water, zero carbon), not as the average. That is deliberate: a sustainability score should show how far a facility is from best practice. Moving every anchor by ±10 % changes a score by only about ±3 points, so the conclusions are not sensitive to exact anchor values.

**Your data is simulated. How do you know the framework works on real facilities?**
Three answers. (1) The indicators follow published standards, and 26 hand-calculated checks confirm the code computes them correctly. (2) The Real-world cases page applies the framework to published figures from Google, Meta and Microsoft and an industry reference, and the results match their reputations. (3) Any facility can upload its own daily CSV. Using real sensor data is the main item of future work.

**How realistic is the simulator?**
It is physics-informed rather than calibrated: chiller efficiency falls as outdoor temperature rises, free cooling depends on temperature, server power follows a linear idle-to-peak model, and noise follows the fan laws. The resulting PUE values (about 1.25–1.45) fall in the range reported for modern facilities. Every coefficient that is assumed rather than measured is listed in the Methodology page's assumptions table.

**What is new compared with just using PUE, WUE and CUE?**
The combination: six dimensions in one framework, including noise and location, which usual dashboards leave out; one transparent, benchmark-anchored score; weather-adjusted anomaly detection; and recommendations quantified by simulation rather than generic advice.

**Why does weather-adjusted detection work better?**
PUE rises with outdoor temperature because chillers work harder. A rolling z-score or a fixed range treats a hot week as abnormal, which produces false alarms and hides real faults during warm periods. Regressing out temperature first and using a robust (median-based) z-score leaves only the unexplained deviations.

**Are the regional values reliable?**
Grid carbon intensity and grid renewable share are cited national 2024 values from Our World in Data (Ember and Energy Institute data). Water stress, climate, tariffs and distances are indicative and labelled as such. For a study of one real site, replace them with local data on the Data page.

**How did you check the calculations are correct?**
In three ways: hand-calculated reference cases (26 checks), identity checks on real outputs (for example PUE = 1 + CLF + PLF), and two independent implementations (Python and JavaScript) that agree to 1e-9. All of them run automatically: `node tests/engine.test.js` and `python3 tests/test_greendc.py`.

**Why is market-based carbon calculated with the grid average?**
This is a simplification and is listed as a limitation. The GHG Protocol asks for a residual-mix factor, which is usually higher, so GreenDC slightly underestimates market-based emissions where residual mixes are published.

**Could this scale to many data centres or real-time data?**
Yes. The engine works on any number of daily rows, and adding hourly data or several sites mainly means extending the input format. A portfolio view is listed as future work.

**What did users think of it?**
If you ran the usability study, report the mean SUS score and the participant count (68 is the average across published studies). If you did not, say it is planned future work and show the built-in questionnaire.

---

## 5. Key numbers (default settings)

| Item | Value |
|---|---|
| Ashburn GreenScore | 62.5 (C); PUE 1.286, WUE 0.92 L/kWh, CUE 0.370 kg/kWh, 5,215 tCO₂e/yr |
| Location range | Stockholm 85.9 (A) to Mumbai 34.6 (F), same facility |
| Ashburn C to A | 62.5 → 82.4 with 100 % renewables, 8 dB acoustic mitigation, 50 % water reuse, +2 °C setpoint |
| Karachi | evaporative 43.5 (E) → liquid cooling with deep retrofit 87.3 (A) |
| Upper bound | 99.2 (A+) |
| Published cases | Meta 98.2, Microsoft 94.1 (40 % coverage), Google 81.7, industry average 25.3 |
| Detection, PUE, 40 years | weather-adjusted F1 0.72; rolling z 0.48; IQR 0.44 |
| PUE vs temperature | PUE = 1.206 + 0.006 × T, R² 0.83 |
| Weight robustness | mean Spearman ρ 0.98 (any weighting), 0.999 (near default) |
| Anchor robustness | ±10 % anchors: Ashburn 59.9 – 65.6 (90 % interval) |
| Verification | 26 / 26 checks pass; Python and JavaScript agree to 1e-9 |
