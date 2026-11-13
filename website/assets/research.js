/* GreenDC research pages: real-world cases, sensitivity analysis, evaluation
 * (detection benchmark and usability study) and presentation mode.
 * Uses the shared helpers exposed by app.js as window.GreenDCApp. */
(function () {
  "use strict";
  const A = window.GreenDCApp, G = A.G;
  const { $, fmt, fmt0, signed, esc, kpi, calcRow, statusPill, scoreBar, draw, chartBase, legend, css, DIM_COLOR } = A;
  ["cases", "sensitivity", "evaluation", "present"].forEach((p) => { if (!A.PAGES.includes(p)) A.PAGES.push(p); });
  const pct = (v, d) => (isFinite(v) ? fmt(v * 100, d === undefined ? 0 : d) + " %" : "–");
  const cache = {};
  function once(key, fn) { if (!(key in cache)) cache[key] = fn(); return cache[key]; }

  /* ---------------------------------------------------------- *
   * Fixed scenarios used for case studies and the presentation.
   * They do not depend on what the viewer has loaded, so the
   * numbers in the talk are the same every time.
   * ---------------------------------------------------------- */
  const SCENARIOS = [
    {
      id: "ashburn", title: "Ashburn: from grade C to grade A",
      gen: { location: "virginia", coolingSystem: "evaporative", itCapacityMW: 2, economiserAdoption: 0.6, days: 365, seed: 42, injectAnomalies: true },
      steps: [
        ["Baseline", {}],
        ["+ 100 % renewable electricity", { renewablePct: 100 }],
        ["+ 8 dB acoustic mitigation", { renewablePct: 100, noiseMitigation: 8 }],
        ["+ 50 % water reuse", { renewablePct: 100, noiseMitigation: 8, waterReuse: 50 }],
        ["+ setpoint raised 2 °C", { renewablePct: 100, noiseMitigation: 8, waterReuse: 50, setpointDelta: 2 }],
      ],
    },
    {
      id: "karachi", title: "Karachi: what cooling choice and upgrades can do",
      gen: { location: "karachi", coolingSystem: "evaporative", itCapacityMW: 2, economiserAdoption: 0.6, days: 365, seed: 42, injectAnomalies: true },
      alt: { location: "karachi", coolingSystem: "liquid", itCapacityMW: 2, economiserAdoption: 0.6, days: 365, seed: 42, injectAnomalies: true },
      deep: { setpointDelta: 4, economiserBoost: 70, itReduction: 15, lossReduction: 40, renewablePct: 100, waterReuse: 50, noiseMitigation: 8 },
    },
    {
      id: "best", title: "Upper bound: ideal site with every lever at maximum",
      gen: { location: "stockholm", coolingSystem: "aircooled", itCapacityMW: 2, economiserAdoption: 1, days: 365, seed: 42, injectAnomalies: false },
      profile: { name: "GreenDC best case · ideal Nordic site", gridCI: 20, gridRenewablePct: 100, waterStress: 0, distanceM: 1500 },
      levers: { setpointDelta: 6, economiserBoost: 100, itReduction: 30, lossReduction: 60, renewablePct: 100, waterReuse: 90, noiseMitigation: 15 },
    },
  ];
  function scenarioData(gen, profilePatch) {
    const rows = G.generateDataset(gen);
    const profile = Object.assign(G.profileFromLocation(gen.location, gen.coolingSystem), profilePatch || {});
    if (!profile.name || profile.name === G.LOCATIONS[gen.location].name) profile.name = "Case study · " + G.LOCATIONS[gen.location].name;
    return { rows, profile };
  }
  function ashburnPath() {
    return once("ashburn", () => {
      const sc = SCENARIOS[0], d = scenarioData(sc.gen);
      return sc.steps.map(([label, lv]) => {
        const c = G.compareScenario(d.rows, d.profile, lv);
        return { label, levers: lv, score: c.scen.green.score, grade: c.scen.green.grade.grade, delta: c.delta };
      });
    });
  }
  function karachiCase() {
    return once("karachi", () => {
      const sc = SCENARIOS[1], a = scenarioData(sc.gen), b = scenarioData(sc.alt);
      const r = (d, lv) => { const c = G.compareScenario(d.rows, d.profile, lv); return { score: c.scen.green.score, grade: c.scen.green.grade.grade, delta: c.delta, scores: c.scen.scores }; };
      return [
        { label: "Evaporative cooling, as built", ...r(a, {}) },
        { label: "Evaporative + deep retrofit + 100 % RE", ...r(a, sc.deep) },
        { label: "Liquid cooling, as built", ...r(b, {}) },
        { label: "Liquid + deep retrofit + 100 % RE", ...r(b, sc.deep) },
      ];
    });
  }
  function bestCase() {
    return once("best", () => {
      const sc = SCENARIOS[2], d = scenarioData(sc.gen, sc.profile);
      const c = G.compareScenario(d.rows, d.profile, sc.levers);
      return { base: c.base.green.score, score: c.scen.green.score, grade: c.scen.green.grade.grade, scores: c.scen.scores, delta: c.delta };
    });
  }
  function openScenario(id, stepIndex) {
    const sc = SCENARIOS.find((x) => x.id === id);
    let gen = sc.gen, patch = sc.profile, levers = sc.levers || {};
    if (id === "ashburn") levers = sc.steps[stepIndex == null ? sc.steps.length - 1 : stepIndex][1];
    if (id === "karachi") { gen = stepIndex >= 2 ? sc.alt : sc.gen; levers = stepIndex % 2 === 1 ? sc.deep : {}; }
    const d = scenarioData(gen, patch);
    A.applySnapshot({ app: "GreenDC", version: 1, source: "Simulated", gen, rows: null, profile: d.profile, weights: G.DEFAULT_WEIGHTS, levers: Object.assign({}, G.DEFAULT_LEVERS, { renewablePct: d.profile.renewablePct }, levers) });
    location.hash = "#simulator";
  }

  /* ---------------------------------------------------------- *
   * Real-world cases
   * ---------------------------------------------------------- */
  function publicResults() {
    return G.PUBLIC_CASES.map((c) => Object.assign({ c }, G.analyseAnnual(c, A.state.weights)));
  }
  function renderCases() {
    const res = publicResults();
    const cur = A.state.result;
    const cov = (r) => `${fmt0(r.coverage * 100)} %`;
    $("#cases-table").innerHTML = `<thead><tr><th>Case</th><th>Year</th><th class="n">PUE</th><th class="n">WUE (L/kWh)</th><th class="n">CUE (kg/kWh)</th><th class="n">Energy</th><th class="n">Water</th><th class="n">Carbon</th><th class="n">GreenScore*</th><th>Grade</th><th class="n">Coverage</th></tr></thead>
      <tbody>${res.map((r) => `<tr><td>${esc(r.c.name)}</td><td>${esc(r.c.year)}</td><td class="n">${fmt(r.kpis.pue, 2)}${r.c.pueIsDesign ? "†" : ""}</td><td class="n">${fmt(r.kpis.wue, 2)}${r.c.wue == null && isFinite(r.kpis.wue) ? "‡" : ""}</td><td class="n">${fmt(r.kpis.cue, 3)}</td><td class="n">${fmt(r.scores.energy.score, 0)}</td><td class="n">${fmt(r.scores.water.score, 0)}</td><td class="n">${fmt(r.scores.carbon.score, 0)}</td><td class="n"><b>${fmt(r.green.score, 1)}</b></td><td>${r.green.grade.grade}</td><td class="n">${cov(r)}</td></tr>`).join("")}
      <tr><td><b>Your loaded facility</b> (${esc(A.state.profile.name)})</td><td>${esc(cur.metrics.kpis.period.slice(0, 4))}</td><td class="n">${fmt(cur.metrics.kpis.pue, 2)}</td><td class="n">${fmt(cur.metrics.kpis.wue, 2)}</td><td class="n">${fmt(cur.metrics.kpis.cue, 3)}</td><td class="n">${fmt(cur.scores.energy.score, 0)}</td><td class="n">${fmt(cur.scores.water.score, 0)}</td><td class="n">${fmt(cur.scores.carbon.score, 0)}</td><td class="n"><b>${fmt(G.greenScore({ energy: cur.scores.energy, water: cur.scores.water, carbon: cur.scores.carbon, cooling: { score: NaN }, noise: { score: NaN }, location: { score: NaN } }, A.state.weights).score, 1)}</b></td><td>–</td><td class="n">same 3 dims</td></tr></tbody>`;
    $("#cases-notes").innerHTML = res.map((r) => `<div class="calc-row"><span class="c-name">${esc(r.c.name)} · ${esc(r.c.year)}</span><span style="font-size:0.85rem;color:var(--ink-2)">${esc(r.c.notes)}</span><span style="font-size:0.85rem">${esc(r.c.derived)}</span></div>`).join("");
    const g = res.find((r) => r.c.id === "google");
    $("#cases-calc").innerHTML =
      calcRow("Google WUE (derived)", "WUE = water ÷ E_IT = water ÷ (E_total ÷ PUE)", `6.1 × 10⁹ gal × 3.785 L ÷ (24 × 10⁹ kWh ÷ 1.10) = <b>${fmt(g.kpis.wue, 3)} L/kWh</b>`) +
      calcRow("Google CUE (estimated)", "CUE ≈ PUE × grid intensity × (1 − CFE)", `1.10 × 0.393 × (1 − 0.64) = <b>${fmt(g.kpis.cue, 3)} kg/kWh</b>`) +
      calcRow("Industry reference CUE", "CUE = PUE × grid intensity", `1.56 × 0.471 = <b>${fmt(res[0].kpis.cue, 3)} kg/kWh</b>`) +
      calcRow("Partial GreenScore", "GS = Σ wᵢSᵢ ÷ Σ wᵢ over the dimensions with data", `Energy (25) + Water (15) + Carbon (25) = 65 % of the default weight`);
    draw("cases-chart", {
      type: "bar",
      data: { labels: res.map((r) => r.c.name.replace(" data centre fleet", "").replace(" datacenter fleet", "").replace(" (reference)", "")), datasets: [
        { label: "Energy", data: res.map((r) => r.scores.energy.score), backgroundColor: css("--c-energy"), borderRadius: 4, maxBarThickness: 22 },
        { label: "Water", data: res.map((r) => r.scores.water.score), backgroundColor: css("--c-water"), borderRadius: 4, maxBarThickness: 22 },
        { label: "Carbon", data: res.map((r) => r.scores.carbon.score), backgroundColor: css("--c-carbon"), borderRadius: 4, maxBarThickness: 22 },
      ] },
      options: chartBase({ x: { ticks: { autoSkip: false, maxRotation: 45, color: css("--muted") } }, y: { min: 0, max: 100 }, tooltip: { label: (c) => `${c.dataset.label}: ${isFinite(c.parsed.y) ? fmt(c.parsed.y, 1) : "no data"}` } }),
    });
    $("#cases-legend").innerHTML = legend([["Energy", css("--c-energy")], ["Water", css("--c-water")], ["Carbon", css("--c-carbon")]]);

    // Scenario case studies
    const path = ashburnPath(), kc = karachiCase(), best = bestCase();
    $("#scn-ashburn").innerHTML = `<thead><tr><th>Step</th><th class="n">GreenScore</th><th>Grade</th><th class="n">MWh saved/yr</th><th class="n">tCO₂e avoided/yr</th><th class="n">m³ water saved/yr</th><th></th></tr></thead><tbody>${path.map((p, i) => `<tr><td>${esc(p.label)}</td><td class="n">${fmt(p.score, 1)}</td><td>${p.grade}</td><td class="n">${fmt0(p.delta.energyMWh)}</td><td class="n">${fmt0(p.delta.co2T)}</td><td class="n">${fmt0(p.delta.waterM3)}</td><td><button class="btn small" type="button" data-scn="ashburn" data-step="${i}">Open</button></td></tr>`).join("")}</tbody>`;
    $("#scn-karachi").innerHTML = `<thead><tr><th>Configuration</th><th class="n">GreenScore</th><th>Grade</th><th class="n">Water</th><th class="n">Cooling</th><th class="n">Location</th><th></th></tr></thead><tbody>${kc.map((p, i) => `<tr><td>${esc(p.label)}</td><td class="n">${fmt(p.score, 1)}</td><td>${p.grade}</td><td class="n">${fmt(p.scores.water.score, 0)}</td><td class="n">${fmt(p.scores.cooling.score, 0)}</td><td class="n">${fmt(p.scores.location.score, 0)}</td><td><button class="btn small" type="button" data-scn="karachi" data-step="${i}">Open</button></td></tr>`).join("")}</tbody>`;
    $("#scn-best").innerHTML = `<thead><tr><th>Dimension</th><th class="n">Score</th><th>What stops it reaching 100</th></tr></thead><tbody>
      <tr><td>Energy</td><td class="n">${fmt(best.scores.energy.score, 1)}</td><td style="white-space:normal">PUE stays slightly above the 1.10 anchor</td></tr>
      <tr><td>Water</td><td class="n">${fmt(best.scores.water.score, 1)}</td><td style="white-space:normal">a little humidification water remains</td></tr>
      <tr><td>Cooling</td><td class="n">${fmt(best.scores.cooling.score, 1)}</td><td style="white-space:normal">fans and pumps still use about 7 % of IT energy</td></tr>
      <tr><td>Carbon, noise, location</td><td class="n">100</td><td style="white-space:normal">at the anchors</td></tr>
      <tr><td><b>GreenScore</b></td><td class="n"><b>${fmt(best.score, 1)}</b></td><td>grade ${best.grade}, up from ${fmt(best.base, 1)} without upgrades</td></tr></tbody>`;
  }

  /* ---------------------------------------------------------- *
   * Sensitivity
   * ---------------------------------------------------------- */
  function locationItems() {
    return once("locItems", () => Object.keys(G.LOCATIONS).map((loc) => {
      const rows = G.generateDataset({ location: loc, coolingSystem: "evaporative", itCapacityMW: 2, economiserAdoption: 0.6, seed: 42, injectAnomalies: false });
      return { name: G.LOCATIONS[loc].name, short: G.LOCATIONS[loc].name.split(",")[0], scores: G.analyse(rows, G.profileFromLocation(loc, "evaporative")).scores };
    }));
  }
  function mcResult(mode) { return once("mc-" + mode, () => G.monteCarloWeights(locationItems(), { mode, draws: 2000 })); }
  function renderSensitivity() {
    const r = A.state.result;
    const oat = G.weightOAT(r.scores, A.state.weights);
    const base = r.green.score;
    $("#sens-oat").innerHTML = `<thead><tr><th>Dimension</th><th class="n">Score</th><th class="n">Weight 0</th><th class="n">Default</th><th class="n">Weight ×2</th><th class="n">Swing</th></tr></thead><tbody>${oat.map((o) => `<tr><td>${o.label}</td><td class="n">${fmt(r.scores[o.key].score, 1)}</td><td class="n">${fmt(o.low, 1)}</td><td class="n">${fmt(o.base, 1)}</td><td class="n">${fmt(o.high, 1)}</td><td class="n">${fmt(Math.abs(o.high - o.low), 1)}</td></tr>`).join("")}</tbody>`;
    const sorted = oat.slice().sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
    draw("sens-tornado", {
      type: "bar",
      data: { labels: sorted.map((o) => o.label), datasets: [
        { label: "GreenScore range", data: sorted.map((o) => [Math.min(o.low, o.high), Math.max(o.low, o.high)]), backgroundColor: sorted.map((o) => css(DIM_COLOR[o.key])), borderRadius: 4, barThickness: 18 },
      ] },
      options: Object.assign(chartBase({ mode: "nearest", x: { min: Math.floor((Math.min(...oat.map((o) => Math.min(o.low, o.high))) - 1) / 2) * 2, max: Math.ceil((Math.max(...oat.map((o) => Math.max(o.low, o.high))) + 1) / 2) * 2, ticks: { stepSize: 2, color: css("--muted") }, grid: { color: css("--grid") } }, y: { grid: { display: false } },
        tooltip: { label: (c) => { const o = sorted[c.dataIndex]; return `weight 0 → ${fmt(o.low, 1)}, weight ×2 → ${fmt(o.high, 1)} (default ${fmt(base, 1)})`; } } }), { indexAxis: "y" }),
    });
    const anchors = once("anchor-" + A.state.profile.name + base.toFixed(4), () => [10, 20].map((p) => G.anchorSensitivity(r.metrics, A.state.weights, { pct: p })));
    $("#sens-anchor").innerHTML = anchors.map((a) => calcRow(`Anchors moved by up to ±${a.pct} % of their span`, `${a.draws} random draws`, `${fmt(base, 1)} → 90 % interval <b>${fmt(a.p5, 1)} – ${fmt(a.p95, 1)}</b>`)).join("");

    const mode = $("#sens-mode").value;
    const mc = mcResult(mode);
    $("#sens-kpis").innerHTML = [
      kpi("Weight draws", fmt0(mc.draws), "", mode === "uniform" ? "any weighting equally likely" : "centred on the default weights"),
      kpi("Rank correlation", fmt(mc.meanSpearman, 3), "", "mean Spearman ρ; 1 = ranking never changes"),
      kpi("Identical ranking", pct(mc.sameOrder), "", "draws with the exact default order"),
      kpi("Top site keeps rank 1", pct(mc.items.find((i) => i.baseRank === 1).keepRank), ""),
    ].join("");
    const items = mc.items.slice().sort((a, b) => a.baseRank - b.baseRank);
    $("#sens-mc").innerHTML = `<thead><tr><th class="n">Rank</th><th>Location</th><th class="n">Default GS</th><th class="n">Mean</th><th class="n">5th–95th pct</th><th class="n">Keeps rank</th><th class="n">Keeps grade</th></tr></thead><tbody>${items.map((i) => `<tr><td class="n">${i.baseRank}</td><td>${esc(i.name)}</td><td class="n">${fmt(i.base, 1)}</td><td class="n">${fmt(i.mean, 1)}</td><td class="n">${fmt(i.p5, 1)} – ${fmt(i.p95, 1)}</td><td class="n">${pct(i.keepRank)}</td><td class="n">${pct(i.keepGrade)}</td></tr>`).join("")}</tbody>`;
    draw("sens-mc-chart", {
      type: "bar",
      data: { labels: items.map((i) => i.name.split(",")[0]), datasets: [
        { type: "bar", label: "5th–95th percentile", data: items.map((i) => [i.p5, i.p95]), backgroundColor: css("--accent") + "55", borderColor: css("--accent"), borderWidth: 1, borderRadius: 4, maxBarThickness: 30, order: 2 },
        { type: "line", label: "Default weights", data: items.map((i) => i.base), showLine: false, pointRadius: 6, pointStyle: "rectRot", pointBackgroundColor: css("--ink"), pointBorderColor: css("--surface"), pointBorderWidth: 2, order: 1 },
      ] },
      options: chartBase({ x: { ticks: { autoSkip: false, maxRotation: 45, color: css("--muted") } }, y: { min: 0, max: 100 }, tooltip: { label: (c) => (Array.isArray(c.raw) ? `90 % of draws: ${fmt(c.raw[0], 1)} – ${fmt(c.raw[1], 1)}` : `Default weights: ${fmt(c.parsed.y, 1)}`) } }),
    });
    $("#sens-mc-legend").innerHTML = legend([["5th–95th percentile across weight draws", css("--accent")], ["Default weights", css("--ink")]]);
  }

  /* ---------------------------------------------------------- *
   * Evaluation: detection benchmark and SUS study
   * ---------------------------------------------------------- */
  function bench(th) { return once("bench-" + th, () => G.benchmarkDetection({ threshold: th })); }
  function renderEvaluation() {
    const th = A.clampNum($("#ev-threshold").value, 1.5, 8, 3.5);
    const b = bench(th);
    const methods = Object.keys(G.DETECTION_METHODS);
    const best = {};
    Object.keys(b.table).forEach((m) => { best[m] = methods.reduce((x, y) => ((b.table[m][y].f1 || 0) > (b.table[m][x].f1 || 0) ? y : x)); });
    $("#ev-kpis").innerHTML = [
      kpi("Datasets", fmt0(b.datasets), "", `${fmt0(b.days)} simulated days`),
      kpi("Locations × seeds", "8 × 5", ""),
      kpi("Threshold", fmt(th, 2), "", "robust z or z; IQR k = threshold ÷ 2"),
      kpi("Best method on PUE", G.DETECTION_METHODS[best.pue], "", `F1 ${fmt(b.table.pue[best.pue].f1, 2)}`),
    ].join("");
    $("#ev-table").innerHTML = `<thead><tr><th>Indicator</th><th>Fault types</th>${methods.map((m) => `<th class="n">${G.DETECTION_METHODS[m]}<br><span style="text-transform:none;letter-spacing:0">P / R / F1</span></th>`).join("")}</tr></thead><tbody>${Object.entries(b.table).map(([m, row]) => `<tr><td>${G.ANOMALY_TARGETS[m].label}</td><td>${G.ANOMALY_TARGETS[m].events.join(", ").replace(/_/g, " ")}</td>${methods.map((k) => `<td class="n"${best[m] === k ? ' style="font-weight:600"' : ""}>${pct(row[k].precision)} / ${pct(row[k].recall)} / ${fmt(row[k].f1, 2)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    const metric = $("#ev-metric").value;
    const sweep = once("sweep-" + metric, () => methods.map((m) => G.detectionSweep(metric, m)));
    const colors = [css("--c-water"), css("--c-energy"), css("--c-cooling")];
    draw("ev-sweep", {
      type: "line",
      data: { labels: sweep[0].map((x) => fmt(x.threshold, 1)), datasets: methods.map((m, i) => ({ label: G.DETECTION_METHODS[m], data: sweep[i].map((x) => x.f1), borderColor: colors[i], backgroundColor: colors[i], borderWidth: 2, pointRadius: 3, tension: 0.2 })) },
      options: chartBase({ y: { min: 0, max: 1 }, x: { title: { display: true, text: "Detection threshold", color: css("--ink-2") } }, yTitle: "F1 score", tooltip: { label: (c) => `${c.dataset.label}: F1 ${fmt(c.parsed.y, 2)}` } }),
    });
    $("#ev-legend").innerHTML = legend(methods.map((m, i) => [G.DETECTION_METHODS[m], colors[i]]));
    renderSUS();
  }

  const SUS_KEY = "greendc.sus.v1";
  const susList = () => A.store.get(SUS_KEY) || [];
  let susClearPending = false;
  function setupSUS() {
    const labels = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
    $("#sus-items").innerHTML = G.SUS_ITEMS.map((q, i) => `<fieldset class="sus-q"><legend><span class="mono">${i + 1}.</span> ${esc(q)}</legend><div class="sus-scale">${labels.map((l, v) => `<label><input type="radio" name="sus${i}" value="${v + 1}" id="sus${i}-${v + 1}"><span>${v + 1}</span><small>${l}</small></label>`).join("")}</div></fieldset>`).join("");
    $("#sus-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const answers = G.SUS_ITEMS.map((_, i) => { const el = document.querySelector(`input[name="sus${i}"]:checked`); return el ? Number(el.value) : NaN; });
      const missing = answers.map((a, i) => (isFinite(a) ? null : i + 1)).filter(Boolean);
      if (missing.length) { A.showMsg("#sus-msg", `Answer every statement first. Missing: ${missing.join(", ")}.`, "err"); return; }
      const id = ($("#sus-id").value || "").trim() || "P" + String(susList().length + 1).padStart(2, "0");
      const role = $("#sus-role").value;
      const list = susList();
      list.push({ id, role, answers, score: G.susScore(answers), at: new Date().toISOString(), comment: ($("#sus-comment").value || "").trim() });
      if (!A.store.set(SUS_KEY, list)) { A.showMsg("#sus-msg", "Browser storage is blocked, so this response was not saved.", "err"); return; }
      A.showMsg("#sus-msg", `Saved response from ${id}: SUS ${fmt(G.susScore(answers), 1)}.`, "ok");
      e.target.reset();
      renderSUS();
    });
    $("#btn-sus-export").addEventListener("click", () => {
      const rows = susList().map((r) => Object.assign({ participant: r.id, role: r.role, sus: r.score, submitted: r.at, comment: (r.comment || "").replace(/[\n,]/g, " ") }, Object.fromEntries(r.answers.map((a, i) => ["q" + (i + 1), a]))));
      if (!rows.length) { A.showMsg("#sus-msg", "There are no responses to export yet.", "err"); return; }
      A.download("greendc_sus_responses.csv", G.toCSV(rows, ["participant", "role", "sus", "q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10", "submitted", "comment"]), "text/csv");
    });
    $("#btn-sus-clear").addEventListener("click", () => {
      if (!susClearPending) { susClearPending = true; renderSUS(); return; }
      susClearPending = false;
      A.store.set(SUS_KEY, []);
      A.showMsg("#sus-msg", "All responses were deleted.", "ok");
      renderSUS();
    });
  }
  function renderSUS() {
    const list = susList();
    const scores = list.map((r) => r.score);
    const m = G.mean(scores), sd = G.std(scores);
    const ci = scores.length > 1 ? 1.96 * sd / Math.sqrt(scores.length) : NaN;
    $("#sus-kpis").innerHTML = [
      kpi("Participants", fmt0(list.length), ""),
      kpi("Mean SUS", list.length ? fmt(m, 1) : "–", "/ 100", list.length ? G.susAdjective(m) : "no responses yet"),
      kpi("Std deviation", list.length > 1 ? fmt(sd, 1) : "–", ""),
      kpi("95 % CI", isFinite(ci) ? `${fmt(m - ci, 1)} – ${fmt(m + ci, 1)}` : "–", "", "normal approximation"),
      kpi("Benchmark", "68", "", "average SUS across studies"),
    ].join("");
    $("#sus-table").innerHTML = list.length ? `<thead><tr><th>Participant</th><th>Role</th><th class="n">SUS</th><th>Rating</th>${G.SUS_ITEMS.map((_, i) => `<th class="n">Q${i + 1}</th>`).join("")}<th>Comment</th></tr></thead><tbody>${list.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.role || "")}</td><td class="n">${fmt(r.score, 1)}</td><td>${G.susAdjective(r.score)}</td>${r.answers.map((a) => `<td class="n">${a}</td>`).join("")}<td style="white-space:normal;min-width:180px">${esc(r.comment || "")}</td></tr>`).join("")}</tbody>`
      : `<tbody><tr><td style="white-space:normal;color:var(--ink-2)">No responses yet. Ask each participant to try the tasks below, then fill in the questionnaire on this device.</td></tr></tbody>`;
    $("#btn-sus-clear").textContent = susClearPending ? "Confirm: delete all responses" : "Delete all responses";
  }

  /* ---------------------------------------------------------- *
   * Presentation mode
   * ---------------------------------------------------------- */
  let slideIndex = 0;
  const PRESENTER_KEY = "greendc.presenter.v1";
  const presenter = () => A.store.get(PRESENTER_KEY) || "";
  function slides() {
    const r = A.state.result, k = r.metrics.kpis;
    const pub = publicResults();
    const path = ashburnPath(), kc = karachiCase(), best = bestCase();
    const mc = mcResult("uniform");
    const b = bench(3.5);
    const tests = G.selfTest();
    const locs = locationItems().map((it) => ({ name: it.short, gs: G.greenScore(it.scores, G.DEFAULT_WEIGHTS).score })).sort((a, b2) => b2.gs - a.gs);
    const dimBlock = (scores) => `<div class="s-dims">${G.DIMENSIONS.map((d) => `<div><span><i style="background:var(${DIM_COLOR[d.key]})"></i>${d.label}</span><b>${fmt(scores[d.key].score, 0)}</b></div>`).join("")}</div>`;
    return [
      { title: "", html: `<div class="s-title"><div class="eyebrow">Research project</div><h1>Green<span>DC</span></h1><p>An integrated, data-driven framework for sustainable data centre management and optimisation</p>${presenter() ? `<p class="s-author">${esc(presenter())}</p>` : ""}<div class="s-tags">${G.DIMENSIONS.map((d) => `<span><i style="background:var(${DIM_COLOR[d.key]})"></i>${d.label}</span>`).join("")}</div></div>` },
      { title: "The problem", link: "methodology", html: `<ul class="s-list"><li>Data centres need electricity, water and cooling at growing scale.</li><li>Monitoring usually tracks one metric at a time, most often PUE.</li><li>A facility can have an excellent PUE and still use scarce water, run on a coal-heavy grid, or disturb its neighbours.</li></ul><div class="s-stats"><div><b>1.56</b><span>average PUE, Uptime Institute 2024</span></div><div><b>1.8 L</b><span>water per IT kWh, LBNL 2016</span></div><div><b>471 g</b><span>CO₂ per kWh, world grid 2024</span></div></div>` },
      { title: "Research question", html: `<p class="s-big">Can one integrated, data-driven framework measure a data centre's environmental impact across energy, water, cooling, carbon, noise and location, and show which interventions improve it most?</p><ul class="s-list"><li>Calculate standard indicators from operating data</li><li>Combine them into a single, transparent GreenScore</li><li>Detect abnormal behaviour and recommend measured improvements</li></ul>` },
      { title: "The GreenDC framework", link: "greenscore", html: `<div class="s-flow">${["Ingest", "Calculate", "Score", "Detect", "Optimise"].map((x, i) => `<div><b>${i + 1}</b><span>${x}</span></div>`).join("")}</div><div class="s-two"><div><h3>Standard indicators</h3><p>PUE, DCiE, WUE, CUE, ERF, CLF and PLF (ISO/IEC 30134, The Green Grid), Scope 2 emissions (GHG Protocol), outdoor sound propagation.</p></div><div><h3>GreenDC contribution</h3><p>Benchmark-anchored 0–100 scores for six dimensions, combined as GS = Σwᵢ·Sᵢ ÷ Σwᵢ, with weather-adjusted anomaly detection and a what-if simulator.</p></div></div>` },
      { title: "Live assessment", link: "overview", html: `<div class="s-two"><div><svg class="gauge" id="s-gauge" viewBox="0 0 220 220"></svg></div><div><p class="s-sub">${esc(A.state.profile.name)} · ${k.days} days</p>${dimBlock(r.scores)}<p class="s-sub">PUE ${fmt(k.pue, 2)} · WUE ${fmt(k.wue, 2)} L/kWh · CUE ${fmt(k.cue, 3)} kg/kWh · ${fmt0(k.co2MktT)} tCO₂e</p></div></div>` },
      { title: "Real-world check: published data", link: "cases", html: `<table class="s-table"><thead><tr><th>Case</th><th>PUE</th><th>WUE</th><th>CUE</th><th>GreenScore*</th><th>Coverage</th></tr></thead><tbody>${pub.map((p) => `<tr><td>${esc(p.c.name.replace(" (reference)", ""))} (${p.c.year})</td><td>${fmt(p.kpis.pue, 2)}${p.c.pueIsDesign ? "†" : ""}</td><td>${fmt(p.kpis.wue, 2)}</td><td>${fmt(p.kpis.cue, 3)}</td><td><b>${fmt(p.green.score, 1)}</b> ${p.green.grade.grade}</td><td>${fmt0(p.coverage * 100)} %</td></tr>`).join("")}</tbody></table><p class="s-note">* Partial GreenScore over the energy, water and carbon dimensions that public reports cover. † Design PUE; carbon not reported comparably, so coverage is lower. Leading operators score A or A+, while an industry-average facility on the world-average grid scores F.</p>` },
      { title: "Location matters", link: "location", html: `<div class="s-bars">${locs.map((l) => `<div><span>${esc(l.name)}</span><div class="bar"><i style="width:${l.gs}%;background:var(--c-location)"></i></div><b>${fmt(l.gs, 1)}</b></div>`).join("")}</div><p class="s-note">The same 2 MW facility with evaporative cooling, simulated for one year in eight regions. Grid carbon, water stress and climate alone move the GreenScore by more than 50 points.</p>` },
      { title: "Anomaly detection works better with weather adjustment", link: "evaluation", html: `<table class="s-table"><thead><tr><th>Indicator</th>${Object.values(G.DETECTION_METHODS).map((m) => `<th>${m}</th>`).join("")}</tr></thead><tbody>${["pue", "noise", "wue", "other"].map((m) => `<tr><td>${G.ANOMALY_TARGETS[m].label}</td>${Object.keys(G.DETECTION_METHODS).map((x) => `<td>F1 ${fmt(b.table[m][x].f1, 2)}</td>`).join("")}</tr>`).join("")}</tbody></table><p class="s-note">${b.datasets} simulated years (8 locations × 5 seeds) with injected faults as ground truth, threshold 3.5. Removing the temperature effect first means hot days are not mistaken for cooling faults.</p>` },
      { title: "What-if: Ashburn from C to A", link: "simulator", html: `<table class="s-table"><thead><tr><th>Step</th><th>GreenScore</th><th>MWh/yr</th><th>tCO₂e/yr</th><th>m³/yr</th></tr></thead><tbody>${path.map((p) => `<tr><td>${esc(p.label)}</td><td><b>${fmt(p.score, 1)}</b> ${p.grade}</td><td>${fmt0(p.delta.energyMWh)}</td><td>${fmt0(p.delta.co2T)}</td><td>${fmt0(p.delta.waterM3)}</td></tr>`).join("")}</tbody></table><p class="s-note">Karachi: evaporative ${fmt(kc[0].score, 1)} (${kc[0].grade}) → liquid cooling with the same upgrades ${fmt(kc[3].score, 1)} (${kc[3].grade}). Upper bound of the scale: ${fmt(best.score, 1)} (${best.grade}).</p>` },
      { title: "Is the GreenScore robust?", link: "sensitivity", html: `<div class="s-stats"><div><b>${fmt(mc.meanSpearman, 2)}</b><span>mean Spearman ρ of location rankings over ${fmt0(mc.draws)} random weightings</span></div><div><b>${pct(mc.items.find((i) => i.baseRank === 1).keepRank)}</b><span>of draws keep the same top-ranked site</span></div><div><b>±${fmt((function () { const a = G.anchorSensitivity(r.metrics, A.state.weights, { pct: 10, draws: 400 }); return (a.p95 - a.p5) / 2; })(), 1)}</b><span>GreenScore points when every benchmark anchor moves ±10 %</span></div></div><p class="s-note">Rankings are stable even when every weighting is equally likely, so the conclusions do not depend on one choice of weights.</p>` },
      { title: "Verification", link: "methodology", html: `<div class="s-stats"><div><b>${tests.filter((t) => t.pass).length} / ${tests.length}</b><span>hand-calculated checks pass, live in the browser</span></div><div><b>1e-9</b><span>agreement between the Python and JavaScript implementations</span></div><div><b>14</b><span>references, with standard indicators separated from framework-defined scores</span></div></div>` },
      { title: "Limitations and future work", html: `<div class="s-two"><div><h3>Limitations</h3><ul class="s-list small"><li>Daily, simulated operating data; public cases cover 3 of 6 dimensions</li><li>Market-based emissions use the grid average, not residual mixes</li><li>Water stress and tariffs are indicative</li><li>Simple free-field noise model</li></ul></div><div><h3>Future work</h3><ul class="s-list small"><li>Real-time sensor feeds (hourly data)</li><li>Many sites in one portfolio view</li><li>Regional datasets: Aqueduct basins, residual mixes, hourly grid carbon</li><li>Usability study with data centre operators</li></ul></div></div>` },
      { title: "Conclusion", html: `<p class="s-big">GreenDC turns routine operating data into a single, explainable view of a data centre's environmental impact and shows, in numbers, which changes help most.</p><p class="s-note">Free, open, runs in the browser. Questions welcome.</p>` },
    ];
  }
  function renderPresent() {
    const list = slides();
    slideIndex = Math.max(0, Math.min(list.length - 1, slideIndex));
    const s = list[slideIndex];
    $("#deck").innerHTML = `<div class="slide">${s.title ? `<h2 class="s-h">${esc(s.title)}</h2>` : ""}<div class="s-body">${s.html}</div>
      <div class="s-foot"><span>GreenDC</span><span>${slideIndex + 1} / ${list.length}</span>${s.link ? `<a href="#${s.link}">Open the live page</a>` : "<span></span>"}</div></div>`;
    $("#deck-progress").style.width = ((slideIndex + 1) / list.length) * 100 + "%";
    $("#deck-pos").textContent = `${slideIndex + 1} / ${list.length}`;
    const gauge = $("#s-gauge");
    if (gauge) A.drawGauge(gauge, A.state.result.green.score, A.state.result.green.grade);
  }
  function setupPresent() {
    $("#deck-author").value = presenter();
    $("#deck-author").addEventListener("input", (e) => { A.store.set(PRESENTER_KEY, e.target.value); renderPresent(); });
    const go = (d) => { slideIndex += d; renderPresent(); };
    $("#deck-prev").addEventListener("click", () => go(-1));
    $("#deck-next").addEventListener("click", () => go(1));
    $("#deck").addEventListener("click", (e) => { if (e.target.closest("a")) return; go(1); });
    document.addEventListener("keydown", (e) => {
      if (A.state.page !== "present" || /input|select|textarea/i.test(e.target.tagName)) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(1); }
      if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(-1); }
      if (e.key === "Home") { slideIndex = 0; renderPresent(); }
    });
    $("#deck-full").addEventListener("click", () => {
      const el = $("#deck-wrap");
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (el.requestFullscreen) el.requestFullscreen().catch(() => A.showMsg("#deck-msg", "Full screen is not available here. Use your browser's full-screen key (F11 or Ctrl+Cmd+F) instead.", "err"));
      } catch (e) { A.showMsg("#deck-msg", "Full screen is not available here. Use your browser's full-screen key instead.", "err"); }
    });
  }

  /* ---------------------------------------------------------- *
   * Overview: research highlights (cheap values now, the rest after warm-up)
   * ---------------------------------------------------------- */
  function renderHighlights() {
    const el = $("#ov-highlights");
    if (!el) return;
    const pub = publicResults();
    const meta = pub.find((p) => p.c.id === "meta"), ind = pub.find((p) => p.c.id === "industry");
    const tests = G.selfTest();
    const b = cache["bench-3.5"], mc = cache["mc-uniform"], path = cache.ashburn;
    const card = (href, value, label, note) => `<a class="hl" href="#${href}"><b>${value}</b><span>${label}</span><small>${note}</small></a>`;
    el.innerHTML = [
      card("cases", `${fmt(meta.green.score, 0)} vs ${fmt(ind.green.score, 0)}`, "Published data", "Meta's fleet against an industry-average facility (partial GreenScore)"),
      card("evaluation", b ? `F1 ${fmt(b.table.pue.residual.f1, 2)}` : "…", "Weather-adjusted detection", b ? `against ${fmt(b.table.pue.rolling.f1, 2)} for a rolling z-score, ${b.datasets} simulated years` : "calculating the benchmark"),
      card("sensitivity", mc ? `ρ ${fmt(mc.meanSpearman, 2)}` : "…", "Robust to weights", mc ? `mean rank correlation over ${fmt0(mc.draws)} random weightings` : "calculating"),
      card("cases", path ? `${path[0].grade} → ${path[path.length - 1].grade}` : "…", "Ashburn what-if", path ? `${fmt(path[0].score, 1)} → ${fmt(path[path.length - 1].score, 1)} in four steps` : "calculating"),
      card("methodology", `${tests.filter((t) => t.pass).length}/${tests.length}`, "Verification checks", "hand calculations pass live; Python and JavaScript agree"),
    ].join("");
  }
  const baseOverview = A.RENDER.overview;
  A.RENDER.overview = function () { baseOverview(); renderHighlights(); };

  /* ---------------------------------------------------------- *
   * Register
   * ---------------------------------------------------------- */
  A.RENDER.cases = renderCases;
  A.RENDER.sensitivity = renderSensitivity;
  A.RENDER.evaluation = renderEvaluation;
  A.RENDER.present = renderPresent;
  // Compute the slower research results in the background after load, one at a
  // time, so the Evaluation and Presentation pages open instantly.
  function warmUp() {
    const jobs = [ashburnPath, karachiCase, bestCase, locationItems, () => mcResult("uniform"), () => bench(3.5), () => once("sweep-pue", () => Object.keys(G.DETECTION_METHODS).map((m) => G.detectionSweep("pue", m)))];
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
    const next = () => {
      const job = jobs.shift();
      if (!job) { if (A.state.page === "overview") renderHighlights(); return; }
      try { job(); } catch (e) { /* ignore */ }
      idle(next);
    };
    idle(next);
  }
  function setup() {
    setTimeout(warmUp, 600);
    setupSUS();
    setupPresent();
    $("#sens-mode").addEventListener("change", renderSensitivity);
    $("#ev-threshold").addEventListener("change", renderEvaluation);
    $("#ev-metric").addEventListener("change", renderEvaluation);
    document.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-scn]");
      if (b) openScenario(b.dataset.scn, Number(b.dataset.step));
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
})();
