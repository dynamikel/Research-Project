/* GreenDC user interface. All calculations come from engine.js (window.GreenDC). */
(function () {
  "use strict";
  const G = window.GreenDC;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  /* ---------------- state ---------------- */
  const state = {
    gen: { location: "virginia", coolingSystem: "evaporative", itCapacityMW: 2, economiserAdoption: 0.6, days: 365, seed: 42, injectAnomalies: true },
    rows: [],
    profile: null,
    weights: Object.assign({}, G.DEFAULT_WEIGHTS),
    levers: Object.assign({}, G.DEFAULT_LEVERS),
    source: "Simulated",
    result: null,
    page: "overview",
  };

  /* ---------------- formatting ---------------- */
  function fmt(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return "–";
    const n = d === undefined ? 1 : d;
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: n, maximumFractionDigits: n });
  }
  const fmt0 = (v) => fmt(v, 0);
  // Compact money: $1.45M, $84.2k, $950
  const money = (v) => { if (!isFinite(v)) return "–"; const a = Math.abs(v), s = v < 0 ? "−$" : "$"; return a >= 1e6 ? s + fmt(a / 1e6, 2) + "M" : a >= 1e4 ? s + fmt(a / 1e3, 1) + "k" : s + fmt(a, 0); };
  const signed = (v, d) => (isFinite(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), d) : "–");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const DIM_COLOR = { energy: "--c-energy", water: "--c-water", cooling: "--c-cooling", carbon: "--c-carbon", noise: "--c-noise", location: "--c-location" };
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function kpi(label, value, unit, note) {
    return `<div class="kpi"><span class="k-label">${label}</span><span class="k-value">${value}${unit ? `<span class="k-unit">${unit}</span>` : ""}</span>${note ? `<span class="k-note">${note}</span>` : ""}</div>`;
  }
  function calcRow(name, formula, sub) {
    return `<div class="calc-row"><span class="c-name">${name}</span><span class="c-formula">${formula}</span>${sub ? `<span class="c-sub">${sub}</span>` : ""}</div>`;
  }
  function statusPill(score) {
    if (!isFinite(score)) return `<span class="pill">No data</span>`;
    if (score >= 70) return `<span class="pill good">On track</span>`;
    if (score >= 50) return `<span class="pill warn">Watch</span>`;
    return `<span class="pill bad">Action needed</span>`;
  }
  function scoreBar(score, colorVar) {
    const w = isFinite(score) ? score : 0;
    return `<div class="bar" role="img" aria-label="${fmt(score, 0)} out of 100"><i style="width:${w}%;background:var(${colorVar || "--accent"})"></i></div>`;
  }

  /* ---------------- charts ---------------- */
  const charts = {};
  const hasChart = () => typeof window.Chart !== "undefined";
  function chartBase(opts) {
    const o = opts || {};
    const ink = css("--ink-2"), grid = css("--grid"), muted = css("--muted");
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: o.mode || "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css("--surface"), titleColor: css("--ink"), bodyColor: css("--ink-2"),
          borderColor: css("--line"), borderWidth: 1, padding: 10, boxPadding: 4,
          titleFont: { family: "IBM Plex Sans, system-ui, sans-serif" }, bodyFont: { family: "IBM Plex Mono, ui-monospace, monospace", size: 12 },
          callbacks: o.tooltip || {},
        },
      },
      scales: o.noScales ? undefined : {
        x: Object.assign({ grid: { display: false }, border: { color: css("--line") }, ticks: { color: muted, font: { family: "IBM Plex Mono, ui-monospace, monospace", size: 11 }, maxRotation: 0, autoSkipPadding: 14 } }, o.x || {}),
        y: Object.assign({ grid: { color: grid }, border: { display: false }, ticks: { color: muted, font: { family: "IBM Plex Mono, ui-monospace, monospace", size: 11 } }, title: o.yTitle ? { display: true, text: o.yTitle, color: ink, font: { family: "IBM Plex Sans, system-ui, sans-serif", size: 11 } } : undefined }, o.y || {}),
      },
    };
  }
  function draw(id, config) {
    if (!hasChart()) return;
    const el = document.getElementById(id);
    if (!el) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el, config);
  }
  function legend(items) {
    return items.map(([label, color, dashed]) => `<span><i style="background:${dashed ? "transparent" : color};${dashed ? `border-top:2px dashed ${color};height:0;width:14px` : ""}"></i>${label}</span>`).join("");
  }
  function monthLabel(m) {
    const [y, mo] = m.split("-");
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mo) - 1] + (state.result && state.result.metrics.monthly.length > 12 ? " " + y.slice(2) : "");
  }
  function rollingMean(arr, w) {
    return arr.map((_, i) => { const s = arr.slice(Math.max(0, i - w + 1), i + 1).filter(isFinite); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN; });
  }

  /* ---------------- gauge ---------------- */
  function drawGauge(svg, score, grade) {
    const cx = 110, cy = 112, r = 86, start = 135, sweep = 270;
    const pt = (deg) => { const a = (deg * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const arc = (from, to) => { const [x1, y1] = pt(from), [x2, y2] = pt(to); return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`; };
    const v = isFinite(score) ? score : 0;
    const color = v >= 70 ? "var(--good)" : v >= 50 ? "var(--warning)" : "var(--critical)";
    const ticks = [0, 25, 50, 75, 100].map((t) => {
      const a = start + (sweep * t) / 100, rad = (a * Math.PI) / 180;
      const x = cx + (r + 16) * Math.cos(rad), y = cy + (r + 16) * Math.sin(rad);
      return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--muted)" class="g-num">${t}</text>`;
    }).join("");
    svg.innerHTML = `
      <path d="${arc(start, start + sweep)}" fill="none" stroke="var(--grid)" stroke-width="14" stroke-linecap="round"/>
      ${v > 0.5 ? `<path d="${arc(start, start + (sweep * v) / 100)}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"/>` : ""}
      ${ticks}
      <text class="g-num" x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="46" font-weight="500" fill="var(--ink)">${fmt(score, 0)}</text>
      <text x="${cx}" y="${cy + 30}" text-anchor="middle" font-size="13" fill="var(--ink-2)" font-family="IBM Plex Sans, sans-serif">Grade ${grade.grade} · ${grade.label}</text>
      <text x="${cx}" y="${cy + 74}" text-anchor="middle" font-size="11" letter-spacing="1.5" fill="var(--muted)" font-family="IBM Plex Sans, sans-serif">GREENSCORE</text>`;
  }

  /* ---------------- saving ----------------
   * The working session is saved automatically in this browser
   * (localStorage). Named projects can be saved, reopened, exported to
   * a .json project file and imported on another computer. Simulated
   * datasets are stored as their generator settings (they are seeded,
   * so they regenerate identically); uploaded datasets are stored row by row.
   */
  const STORE_KEY = "greendc.workspace.v1";
  const PROJECTS_KEY = "greendc.projects.v1";
  const store = {
    get(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };
  function snapshot() {
    return {
      app: "GreenDC", version: 1, savedAt: new Date().toISOString(),
      name: state.profile.name, source: state.source, gen: state.gen,
      rows: state.source === "Simulated" ? null : state.rows,
      profile: state.profile, weights: state.weights, levers: state.levers,
      greenScore: state.result ? state.result.green.score : null,
      days: state.rows.length,
    };
  }
  function applySnapshot(snap) {
    if (!snap || snap.app !== "GreenDC" || !snap.profile) throw new Error("This is not a GreenDC project file.");
    state.gen = Object.assign({}, state.gen, snap.gen || {});
    state.rows = snap.rows && snap.rows.length ? snap.rows : G.generateDataset(state.gen);
    state.source = snap.source || (snap.rows ? "Uploaded" : "Simulated");
    state.profile = Object.assign(G.profileFromLocation(state.gen.location, state.gen.coolingSystem), snap.profile);
    state.weights = Object.assign({}, G.DEFAULT_WEIGHTS, snap.weights || {});
    state.levers = Object.assign({}, G.DEFAULT_LEVERS, { renewablePct: state.profile.renewablePct }, snap.levers || {});
    locationCache = null;
    syncGenForm();
    fillProfileForm();
    recompute();
  }
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const ok = store.set(STORE_KEY, snapshot());
      const el = $("#tb-saved");
      if (el) el.textContent = ok ? "Saved in this browser · " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Not saved: browser storage is blocked";
    }, 400);
  }
  const listProjects = () => store.get(PROJECTS_KEY) || [];

  /* ---------------- pipeline ---------------- */
  function recompute() {
    state.result = G.analyse(state.rows, state.profile, state.weights);
    renderHeader();
    renderPage(state.page);
    scheduleSave();
  }

  function generate() {
    state.rows = G.generateDataset(state.gen);
    const keepName = state.profile && state.profile._customName ? state.profile.name : null;
    state.profile = G.profileFromLocation(state.gen.location, state.gen.coolingSystem);
    state.profile.name = keepName || "GreenDC demo facility · " + G.LOCATIONS[state.gen.location].name;
    state.source = "Simulated";
    state.levers = Object.assign({}, G.DEFAULT_LEVERS, { renewablePct: state.profile.renewablePct });
    fillProfileForm();
    recompute();
  }

  function renderHeader() {
    const r = state.result, k = r.metrics.kpis;
    $("#tb-name").textContent = state.profile.name;
    $("#tb-period").textContent = `${k.period} · ${k.days} days · ${fmt(k.avgITkW / 1000, 2)} MW average IT load`;
    $("#tb-source").textContent = state.source;
    $("#tb-score").textContent = fmt(r.green.score, 0);
    $("#tb-grade").textContent = r.green.grade.grade;
    G.DIMENSIONS.forEach((d) => { const el = $(`[data-pill="${d.key}"]`); if (el) el.textContent = fmt(r.scores[d.key].score, 0); });
  }

  /* ---------------- routing ---------------- */
  const PAGES = ["overview", "data", "energy", "water", "cooling", "carbon", "noise", "location", "greenscore", "anomalies", "forecast", "simulator", "recommendations", "methodology"];
  function route() {
    const h = location.hash.replace("#", "");
    const page = PAGES.includes(h) ? h : "overview";
    state.page = page;
    $$("[data-page]").forEach((s) => { s.hidden = s.dataset.page !== page; });
    $$("#nav a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === "#" + page ? "page" : "false"));
    renderPage(page);
    window.scrollTo(0, 0);
  }
  function renderPage(page) {
    if (!state.result) return;
    const fn = RENDER[page];
    if (fn) fn();
  }

  /* ======================================================
   *  OVERVIEW
   * ====================================================== */
  function renderOverview() {
    const r = state.result, k = r.metrics.kpis;
    drawGauge($("#gauge"), r.green.score, r.green.grade);
    $("#ov-kpis").innerHTML = [
      kpi("PUE", fmt(k.pue, 2), "", `DCiE ${fmt(k.dcie, 1)} %`),
      kpi("WUE", fmt(k.wue, 2), "L/kWh", `${fmt0(k.waterM3)} m³ used`),
      kpi("CUE", fmt(k.cue, 3), "kgCO₂e/kWh", "market-based"),
      kpi("Emissions", fmt0(k.co2MktT), "tCO₂e", `${fmt0(k.co2LocT)} t location-based`),
      kpi("Facility energy", fmt0(k.totalMWh), "MWh", `${fmt0(k.itMWh)} MWh to IT`),
      kpi("Noise P95", fmt(k.noiseP95, 1), "dB(A)", `limit ${k.noiseLimit} dB(A)`),
    ].join("");
    const metricText = {
      energy: `PUE ${fmt(k.pue, 2)} · util ${fmt(k.itUtil, 0)} %`,
      water: `WUE ${fmt(k.wue, 2)} L/kWh`,
      cooling: `CLF ${fmt(k.clf, 3)} · CER ${fmt(k.cer, 1)}`,
      carbon: `CUE ${fmt(k.cue, 3)} kg/kWh`,
      noise: `P95 ${fmt(k.noiseP95, 1)} dB(A) vs ${k.noiseLimit}`,
      location: `${fmt0(state.profile.gridCI)} g/kWh · stress ${fmt(state.profile.waterStress, 1)}`,
    };
    $("#ov-dims").innerHTML = G.DIMENSIONS.map((d) => {
      const s = r.scores[d.key].score;
      return `<a class="dim-card" href="#${d.key}">
        <div class="d-top"><i style="background:var(${DIM_COLOR[d.key]})"></i><b>${d.label}</b><span class="d-score num">${fmt(s, 0)}</span></div>
        ${scoreBar(s, DIM_COLOR[d.key])}
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><span class="d-metric">${metricText[d.key]}</span>${statusPill(s)}</div>
      </a>`;
    }).join("");
    drawRadar("ov-radar", [{ label: "Current", data: G.DIMENSIONS.map((d) => r.scores[d.key].score), color: css("--accent") }]);
  }

  function drawRadar(id, sets) {
    draw(id, {
      type: "radar",
      data: {
        labels: G.DIMENSIONS.map((d) => d.label),
        datasets: sets.map((s) => ({
          label: s.label, data: s.data.map((v) => (isFinite(v) ? v : 0)),
          borderColor: s.color, backgroundColor: s.color + "26", borderWidth: 2, pointRadius: 4,
          pointBackgroundColor: s.color, pointBorderColor: css("--surface"), pointBorderWidth: 2, borderDash: s.dash || [],
        })),
      },
      options: Object.assign(chartBase({ noScales: true, mode: "nearest" }), {
        scales: { r: { min: 0, max: 100, ticks: { stepSize: 25, color: css("--muted"), backdropColor: "transparent", font: { family: "IBM Plex Mono, ui-monospace, monospace", size: 10 } }, grid: { color: css("--grid") }, angleLines: { color: css("--grid") }, pointLabels: { color: css("--ink-2"), font: { family: "IBM Plex Sans, system-ui, sans-serif", size: 12, weight: "600" } } } },
      }),
    });
  }

  /* ======================================================
   *  DATA
   * ====================================================== */
  const PROFILE_FIELDS = ["gridCI", "renewablePct", "gridRenewablePct", "waterStress", "distanceM", "noiseLimit", "priceKwh", "priceWaterM3", "carbonPrice", "fcThreshold"];
  function setupDataForms() {
    $("#f-location").innerHTML = Object.entries(G.LOCATIONS).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join("");
    $("#f-cooling").innerHTML = Object.entries(G.COOLING_SYSTEMS).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join("");
    $("#f-location").value = state.gen.location;
    $("#f-cooling").value = state.gen.coolingSystem;
    $("#btn-generate").addEventListener("click", () => {
      state.gen = {
        location: $("#f-location").value,
        coolingSystem: $("#f-cooling").value,
        itCapacityMW: clampNum($("#f-capacity").value, 0.1, 200, 2),
        economiserAdoption: clampNum($("#f-econ").value, 0, 100, 60) / 100,
        days: Math.round(clampNum($("#f-days").value, 30, 1095, 365)),
        seed: Math.round(clampNum($("#f-seed").value, 1, 1e9, 42)),
        injectAnomalies: $("#f-anom").checked,
      };
      if (state.profile) state.profile._customName = false;
      generate();
      showMsg("#upload-msg", `Generated ${state.rows.length} days for ${G.LOCATIONS[state.gen.location].name}.`, "ok");
    });
    $("#profile-form").addEventListener("input", (e) => {
      const id = e.target.id.replace("p-", "");
      if (id === "name") { state.profile.name = e.target.value || "Facility"; state.profile._customName = true; renderHeader(); return; }
      const v = Number(e.target.value);
      if (!isFinite(v) || e.target.value === "") return;
      state.profile[id] = v;
      if (id === "renewablePct") state.levers.renewablePct = v;
      recompute();
    });
    $("#f-upload").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const rows = G.parseCSV(String(reader.result));
          state.rows = rows;
          state.source = "Uploaded";
          state.profile.name = file.name.replace(/\.csv$/i, "");
          state.profile._customName = true;
          fillProfileForm();
          recompute();
          const cols = Object.keys(rows[0]);
          const missing = G.OPTIONAL_COLUMNS.filter((c) => !cols.includes(c));
          showMsg("#upload-msg", `Loaded ${rows.length} days from ${file.name}.` + (missing.length ? ` Optional columns not found: ${missing.join(", ")}.` : ""), "ok");
        } catch (err) {
          showMsg("#upload-msg", err.message, "err");
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    });
    $("#btn-template").addEventListener("click", () => {
      const sample = G.generateDataset({ days: 7, seed: 7, injectAnomalies: false });
      download("greendc_template.csv", G.toCSV(sample, G.REQUIRED_COLUMNS.concat(G.OPTIONAL_COLUMNS)), "text/csv");
    });
    $("#btn-export-data").addEventListener("click", () => download("greendc_dataset.csv", G.toCSV(state.rows, G.REQUIRED_COLUMNS.concat(G.OPTIONAL_COLUMNS)), "text/csv"));
  }
  function clampNum(v, lo, hi, dflt) { const n = Number(v); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; }
  function syncGenForm() {
    $("#f-location").value = state.gen.location;
    $("#f-cooling").value = state.gen.coolingSystem;
    $("#f-capacity").value = state.gen.itCapacityMW;
    $("#f-econ").value = Math.round(state.gen.economiserAdoption * 100);
    $("#f-days").value = state.gen.days;
    $("#f-seed").value = state.gen.seed;
    $("#f-anom").checked = !!state.gen.injectAnomalies;
  }
  function fillProfileForm() {
    $("#p-name").value = state.profile.name;
    PROFILE_FIELDS.forEach((f) => { $("#p-" + f).value = state.profile[f]; });
  }
  function showMsg(sel, text, kind) {
    const el = $(sel);
    el.textContent = text;
    el.className = "msg " + (kind || "");
    el.hidden = false;
    el.classList.remove("hidden");
  }
  function download(name, text, type) {
    try {
      const blob = new Blob([text], { type: type || "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (e) { /* downloads can be blocked in sandboxed previews */ }
  }

  /* ---------------- saved projects panel ---------------- */
  let pendingDelete = null, pendingReset = false;
  function renderProjects() {
    const list = listProjects();
    $("#proj-name").placeholder = state.profile.name;
    $("#proj-table").innerHTML = list.length ? `<thead><tr><th>Project</th><th>Data</th><th class="n">Days</th><th class="n">GreenScore</th><th>Saved</th><th></th></tr></thead>
      <tbody>${list.map((p, i) => `<tr><td>${esc(p.title)}</td><td>${esc(p.snap.source)}</td><td class="n">${p.snap.days}</td><td class="n">${fmt(p.snap.greenScore, 1)}</td><td>${new Date(p.snap.savedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td>
        <td><div class="btns" style="flex-wrap:nowrap"><button class="btn small" type="button" data-open="${i}">Open</button><button class="btn small" type="button" data-del="${i}">${pendingDelete === i ? "Confirm delete" : "Delete"}</button></div></td></tr>`).join("")}</tbody>`
      : `<tbody><tr><td style="white-space:normal;color:var(--ink-2)">No saved projects yet. Name the current analysis above and choose Save project. Your work in progress is also saved automatically.</td></tr></tbody>`;
    $("#btn-reset-all").textContent = pendingReset ? "Confirm: clear and start over" : "Start over";
  }
  function setupProjects() {
    $("#btn-save-project").addEventListener("click", () => {
      const title = ($("#proj-name").value || state.profile.name).trim();
      const list = listProjects().filter((p) => p.title !== title);
      list.unshift({ title, snap: snapshot() });
      if (store.set(PROJECTS_KEY, list)) showMsg("#proj-msg", `Saved “${title}”. It stays in this browser until you delete it.`, "ok");
      else showMsg("#proj-msg", "This browser blocks storage, so the project was not saved. Use Export project file instead.", "err");
      $("#proj-name").value = "";
      renderProjects();
    });
    $("#proj-table").addEventListener("click", (e) => {
      const t = e.target, list = listProjects();
      if (t.dataset.open !== undefined) {
        const p = list[Number(t.dataset.open)];
        applySnapshot(p.snap);
        showMsg("#proj-msg", `Opened “${p.title}”.`, "ok");
      } else if (t.dataset.del !== undefined) {
        const i = Number(t.dataset.del);
        if (pendingDelete === i) {
          const removed = list.splice(i, 1)[0];
          store.set(PROJECTS_KEY, list);
          pendingDelete = null;
          showMsg("#proj-msg", `Deleted “${removed.title}”.`, "ok");
        } else pendingDelete = i;
        renderProjects();
      }
    });
    $("#btn-export-project").addEventListener("click", () => {
      const slug = state.profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
      download(`greendc-${slug}.json`, JSON.stringify(Object.assign(snapshot(), { rows: state.rows }), null, 1), "application/json");
      showMsg("#proj-msg", "Project file downloaded. It contains the full dataset, parameters, weights and simulator settings.", "ok");
    });
    $("#f-import").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { applySnapshot(JSON.parse(String(reader.result))); showMsg("#proj-msg", `Imported ${file.name}.`, "ok"); }
        catch (err) { showMsg("#proj-msg", err.message.startsWith("This is not") ? err.message : "The file could not be read as a GreenDC project (.json).", "err"); }
        e.target.value = "";
      };
      reader.readAsText(file);
    });
    $("#btn-reset-all").addEventListener("click", () => {
      if (!pendingReset) { pendingReset = true; renderProjects(); return; }
      pendingReset = false;
      store.remove(STORE_KEY);
      state.gen = { location: "virginia", coolingSystem: "evaporative", itCapacityMW: 2, economiserAdoption: 0.6, days: 365, seed: 42, injectAnomalies: true };
      state.weights = Object.assign({}, G.DEFAULT_WEIGHTS);
      state.profile = null;
      syncGenForm();
      generate();
      showMsg("#proj-msg", "Started over with the default simulated facility. Saved projects were kept.", "ok");
    });
  }

  function renderData() {
    renderProjects();
    const rows = state.rows, k = state.result.metrics.kpis;
    const cols = G.REQUIRED_COLUMNS.concat(G.OPTIONAL_COLUMNS).filter((c) => rows[0] && c in rows[0]);
    const events = rows.filter((r) => r.event).length;
    $("#data-summary").innerHTML = [
      kpi("Days", fmt0(k.days), "", k.period),
      kpi("Columns", cols.length, "", `${G.REQUIRED_COLUMNS.length} required, ${cols.length - G.REQUIRED_COLUMNS.length} optional`),
      kpi("Avg IT load", fmt0(k.avgITkW), "kW", `${fmt0(k.avgFacilitykW)} kW facility`),
      kpi("Temperature", k.hasTemp ? "Yes" : "No", "", "enables weather models"),
      kpi("Noise data", k.hasNoise ? "Yes" : "No", "", "enables the noise dimension"),
      kpi("Labelled faults", fmt0(events), "days", "ground truth for detection"),
    ].join("");
    $("#data-count").textContent = `Showing the first 14 of ${rows.length} rows`;
    const units = { it_kwh: "kWh", cooling_kwh: "kWh", other_kwh: "kWh", water_l: "L", temp_c: "°C", it_util_pct: "%", noise_dba: "dB(A)", grid_ci: "g/kWh" };
    $("#data-table").innerHTML = `<thead><tr>${cols.map((c) => `<th class="${c === "date" || c === "event" ? "" : "n"}">${c}${units[c] ? ` (${units[c]})` : ""}</th>`).join("")}</tr></thead>
      <tbody>${rows.slice(0, 14).map((r) => `<tr>${cols.map((c) => c === "date" || c === "event" ? `<td>${esc(r[c] || "")}</td>` : `<td class="n">${fmt(r[c], c === "water_l" ? 0 : 1)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  }

  /* ======================================================
   *  DIMENSION PAGES
   * ====================================================== */
  function scoreCalc(key) {
    const sc = state.result.scores[key];
    const rows = sc.parts.map((p) => {
      if (!isFinite(p.value)) return calcRow(`S(${p.name})`, "not available from this dataset", "Excluded; remaining weights are renormalised");
      return calcRow(`S(${p.name})`, `100 × (x − worst) ÷ (best − worst)`,
        `100 × (${fmt(p.value, p.fmt)} − ${p.worst}) ÷ (${p.best} − ${p.worst}) = <b>${fmt(p.score, 1)}</b>`);
    });
    const valid = sc.parts.filter((p) => isFinite(p.score));
    const wsum = valid.reduce((s, p) => s + p.weight, 0);
    if (sc.parts.length > 1) {
      rows.push(calcRow(`${cap(key)} score`, sc.parts.map((p) => `${fmt(p.weight, 2)}·S(${p.name})`).join(" + ") + (valid.length < sc.parts.length ? "  (renormalised)" : ""),
        valid.map((p) => `${fmt(p.weight / wsum, 2)} × ${fmt(p.score, 1)}`).join(" + ") + ` = <b>${fmt(sc.score, 1)}</b>`));
    }
    return rows.join("");
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function dimShell(key, eyebrow, title, lede) {
    const s = state.result.scores[key].score;
    return `<div class="page-head">
        <div class="eyebrow"><i class="swatch" style="background:var(${DIM_COLOR[key]})"></i>${eyebrow}</div>
        <h1>${title}</h1>
        <p class="lede">${lede}</p>
      </div>
      <div class="panel" style="flex-direction:row;align-items:center;gap:18px;flex-wrap:wrap">
        <div style="font-family:var(--f-mono);font-size:2.4rem;line-height:1">${fmt(s, 0)}<span style="font-size:1rem;color:var(--muted)"> / 100</span></div>
        <div style="flex:1;min-width:160px;display:flex;flex-direction:column;gap:6px"><span style="font-size:0.8rem;color:var(--ink-2)">${cap(key)} dimension score · weight ${state.weights[key]} in the GreenScore</span>${scoreBar(s, DIM_COLOR[key])}</div>
        ${statusPill(s)}
      </div>`;
  }

  function renderEnergy() {
    const r = state.result, k = r.metrics.kpis, p = state.profile, m = r.metrics.monthly, d = r.metrics.daily;
    $("#page-energy").innerHTML = dimShell("energy", "Dimension 1 · Energy consumption", "Energy consumption & PUE",
      "How much electricity the facility draws, and how much of it reaches IT equipment rather than cooling and power-distribution overhead.") + `
      <div class="kpis">
        ${kpi("Facility energy", fmt0(k.totalMWh), "MWh")}
        ${kpi("IT energy", fmt0(k.itMWh), "MWh")}
        ${kpi("PUE", fmt(k.pue, 3), "", `daily range ${fmt(k.pueMin, 2)}–${fmt(k.pueMax, 2)}`)}
        ${kpi("DCiE", fmt(k.dcie, 1), "%")}
        ${kpi("Average IT load", fmt0(k.avgITkW), "kW")}
        ${kpi("IT utilisation", fmt(k.itUtil, 1), "%")}
        ${kpi("Energy cost", money(k.energyCost), "", `at $${fmt(p.priceKwh, 2)}/kWh`)}
      </div>
      <div class="split">
        <div class="panel">
          <div class="panel-head"><h3>Monthly energy by component</h3><div class="legend">${legend([["IT", css("--c-energy")], ["Cooling", css("--c-cooling")], ["Distribution & lighting", css("--c-other")]])}</div></div>
          <div class="chart"><canvas id="en-monthly" aria-label="Monthly energy stacked by component"></canvas></div>
        </div>
        <div class="panel"><h3>Worked calculation</h3><div class="calc">
          ${calcRow("Total facility energy", "E_total = E_IT + E_cooling + E_other", `${fmt0(k.itMWh)} + ${fmt0(k.coolingMWh)} + ${fmt0(k.otherMWh)} = <b>${fmt0(k.totalMWh)} MWh</b>`)}
          ${calcRow("Power Usage Effectiveness", "PUE = E_total ÷ E_IT", `${fmt0(k.totalMWh)} ÷ ${fmt0(k.itMWh)} = <b>${fmt(k.pue, 3)}</b>`)}
          ${calcRow("DCiE", "DCiE = E_IT ÷ E_total × 100", `${fmt0(k.itMWh)} ÷ ${fmt0(k.totalMWh)} × 100 = <b>${fmt(k.dcie, 1)} %</b>`)}
          ${calcRow("Load factors (Green Grid)", "CLF = E_cooling ÷ E_IT,  PLF = E_other ÷ E_IT", `CLF ${fmt(k.clf, 3)}, PLF ${fmt(k.plf, 3)} → 1 + CLF + PLF = <b>${fmt(1 + k.clf + k.plf, 3)}</b> (equals PUE)`)}
          ${calcRow("Overhead energy", "E_overhead = E_total − E_IT", `${fmt0(k.totalMWh)} − ${fmt0(k.itMWh)} = <b>${fmt0(k.totalMWh - k.itMWh)} MWh</b> (${fmt((1 - 1 / k.pue) * 100, 1)} % of the total)`)}
          ${calcRow("Energy cost", "C = E_total × price", `${fmt0(k.totalMWh * 1000)} kWh × $${fmt(p.priceKwh, 2)} = <b>$${fmt0(k.energyCost)}</b>`)}
          ${scoreCalc("energy")}
        </div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Daily PUE</h3><div class="legend">${legend([["Daily PUE", css("--c-energy")], ["7-day mean", css("--ink-2")], ["Benchmark 1.56", css("--muted"), true]])}</div></div>
        <div class="chart"><canvas id="en-pue" aria-label="Daily PUE line chart"></canvas></div>
      </div>`;
    draw("en-monthly", {
      type: "bar",
      data: { labels: m.map((x) => monthLabel(x.month)), datasets: [
        { label: "IT", data: m.map((x) => x.itMWh), backgroundColor: css("--c-energy"), borderColor: css("--surface"), borderWidth: { top: 2 }, borderRadius: 0, stack: "s" },
        { label: "Cooling", data: m.map((x) => x.coolingMWh), backgroundColor: css("--c-cooling"), borderColor: css("--surface"), borderWidth: { top: 2 }, stack: "s" },
        { label: "Distribution & lighting", data: m.map((x) => x.otherMWh), backgroundColor: css("--c-other"), borderColor: css("--surface"), borderWidth: { top: 2 }, borderRadius: { topLeft: 4, topRight: 4 }, stack: "s" },
      ] },
      options: chartBase({ yTitle: "MWh", x: { stacked: true }, y: { stacked: true }, tooltip: { label: (c) => `${c.dataset.label}: ${fmt0(c.parsed.y)} MWh` } }),
    });
    const pue = d.map((x) => x.pue);
    draw("en-pue", {
      type: "line",
      data: { labels: d.map((x) => x.date), datasets: [
        { label: "Daily PUE", data: pue, borderColor: css("--c-energy"), borderWidth: 1.5, pointRadius: 0, tension: 0 },
        { label: "7-day mean", data: rollingMean(pue, 7), borderColor: css("--ink-2"), borderWidth: 2, pointRadius: 0, tension: 0.2 },
        { label: "Benchmark", data: pue.map(() => 1.56), borderColor: css("--muted"), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
      ] },
      options: chartBase({ x: { ticks: { color: css("--muted"), maxTicksLimit: 8, font: { family: "IBM Plex Mono, ui-monospace, monospace", size: 11 } } }, tooltip: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y, 3)}` } }),
    });
  }

  function renderWater() {
    const r = state.result, k = r.metrics.kpis, p = state.profile, m = r.metrics.monthly, d = r.metrics.daily;
    $("#page-water").innerHTML = dimShell("water", "Dimension 2 · Water usage", "Water usage & WUE",
      "Site water consumed for cooling and humidification, normalised by IT energy, plus the water embedded in electricity generation and the local water stress.") + `
      <div class="kpis">
        ${kpi("Water consumed", fmt0(k.waterM3), "m³", `${fmt0(k.waterM3 / k.days)} m³/day`)}
        ${kpi("WUE (site)", fmt(k.wue, 3), "L/kWh", "industry avg ≈ 1.8")}
        ${kpi("WUE (source)", fmt(k.wueSource, 2), "L/kWh", "incl. power-plant water")}
        ${kpi("Water stress", fmt(p.waterStress, 1), "/ 5", "WRI Aqueduct scale")}
        ${kpi("Stress-weighted", fmt0(k.waterStressWeightedM3), "m³ eq.")}
        ${kpi("Water cost", money(k.waterCost), "", `at $${fmt(p.priceWaterM3, 2)}/m³`)}
      </div>
      <div class="split">
        <div class="panel">
          <div class="panel-head"><h3>Monthly water consumption</h3><p>m³ per month</p></div>
          <div class="chart"><canvas id="wa-monthly" aria-label="Monthly water consumption"></canvas></div>
        </div>
        <div class="panel"><h3>Worked calculation</h3><div class="calc">
          ${calcRow("Water Usage Effectiveness (site)", "WUE = water (L) ÷ E_IT (kWh)", `${fmt0(k.waterM3 * 1000)} ÷ ${fmt0(k.itMWh * 1000)} = <b>${fmt(k.wue, 3)} L/kWh</b>`)}
          ${calcRow("WUE (source-inclusive)", "WUE_src = (water + 1.8 × E_total) ÷ E_IT", `(${fmt0(k.waterM3 * 1000)} + 1.8 × ${fmt0(k.totalMWh * 1000)}) ÷ ${fmt0(k.itMWh * 1000)} = <b>${fmt(k.wueSource, 2)} L/kWh</b>`)}
          ${calcRow("Stress-weighted footprint", "W_ws = water × (1 + stress ÷ 5)", `${fmt0(k.waterM3)} × (1 + ${fmt(p.waterStress, 1)} ÷ 5) = <b>${fmt0(k.waterStressWeightedM3)} m³ eq.</b>`)}
          ${calcRow("Water cost", "C = water (m³) × price", `${fmt0(k.waterM3)} × $${fmt(p.priceWaterM3, 2)} = <b>$${fmt0(k.waterCost)}</b>`)}
          ${scoreCalc("water")}
        </div></div>
      </div>
      ${k.hasTemp ? `<div class="panel">
        <div class="panel-head"><h3>Daily WUE vs outdoor temperature</h3><p>Evaporative cooling uses more water on hot days</p></div>
        <div class="chart"><canvas id="wa-scatter" aria-label="Scatter of WUE against temperature"></canvas></div>
      </div>` : ""}`;
    draw("wa-monthly", {
      type: "bar",
      data: { labels: m.map((x) => monthLabel(x.month)), datasets: [{ label: "Water", data: m.map((x) => x.waterM3), backgroundColor: css("--c-water"), borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 36 }] },
      options: chartBase({ yTitle: "m³", tooltip: { label: (c) => `Water: ${fmt0(c.parsed.y)} m³` } }),
    });
    if (k.hasTemp) scatter("wa-scatter", d.map((x) => ({ x: x.temp, y: x.wue, date: x.date })), css("--c-water"), "°C", "WUE (L/kWh)", 2);
  }

  function scatter(id, pts, color, xTitle, yTitle, digits, extra) {
    draw(id, {
      type: "scatter",
      data: { datasets: [{ label: yTitle, data: pts, backgroundColor: color + "99", borderColor: css("--surface"), borderWidth: 1, pointRadius: 4, pointHoverRadius: 6 }].concat(extra || []) },
      options: chartBase({ mode: "nearest", x: { type: "linear", title: { display: true, text: xTitle, color: css("--ink-2") }, grid: { color: css("--grid") } }, yTitle,
        tooltip: { label: (c) => (c.raw.date ? c.raw.date + ": " : "") + `${fmt(c.parsed.x, 1)} ${xTitle} → ${fmt(c.parsed.y, digits)}` } }),
    });
  }

  function renderCooling() {
    const r = state.result, k = r.metrics.kpis, p = state.profile, m = r.metrics.monthly, d = r.metrics.daily;
    const cool = k.hasTemp ? d.filter((x) => x.temp < p.fcThreshold) : [];
    $("#page-cooling").innerHTML = dimShell("cooling", "Dimension 3 · Cooling efficiency", "Cooling efficiency",
      "Cooling is usually the largest overhead. These indicators show how much energy is spent removing each kWh of IT heat and how well the economiser uses cool weather.") + `
      <div class="kpis">
        ${kpi("Cooling energy", fmt0(k.coolingMWh), "MWh")}
        ${kpi("Cooling Load Factor", fmt(k.clf, 3), "")}
        ${kpi("CER (system COP)", fmt(k.cer, 2), "", "kWh heat per kWh cooling")}
        ${kpi("Share of facility energy", fmt(k.coolingShare, 1), "%")}
        ${kpi("pPUE cooling", fmt(k.pPUEcooling, 3), "")}
        ${kpi("Free-cooling days", fmt(k.freeCoolingDaysPct, 0), "%", `below ${fmt(p.fcThreshold, 1)} °C`)}
        ${kpi("Free-cooling utilisation", fmt(k.freeCoolingUtilisationPct, 0), "%", "cool days with CLF < 0.15")}
      </div>
      <div class="split">
        <div class="panel">
          <div class="panel-head"><h3>Daily CLF vs outdoor temperature</h3><div class="legend">${legend([["Daily CLF", css("--c-cooling")], ["Economiser threshold", css("--muted"), true]])}</div></div>
          ${k.hasTemp ? `<div class="chart tall"><canvas id="co-scatter" aria-label="Scatter of cooling load factor against temperature"></canvas></div>` : `<p class="msg">Add a temp_c column to see the weather relationship.</p>`}
        </div>
        <div class="panel"><h3>Worked calculation</h3><div class="calc">
          ${calcRow("Cooling Load Factor", "CLF = E_cooling ÷ E_IT", `${fmt0(k.coolingMWh)} ÷ ${fmt0(k.itMWh)} = <b>${fmt(k.clf, 3)}</b>`)}
          ${calcRow("Cooling Efficiency Ratio", "CER = E_IT ÷ E_cooling", `${fmt0(k.itMWh)} ÷ ${fmt0(k.coolingMWh)} = <b>${fmt(k.cer, 2)}</b>`)}
          ${calcRow("Cooling share", "E_cooling ÷ E_total × 100", `${fmt0(k.coolingMWh)} ÷ ${fmt0(k.totalMWh)} × 100 = <b>${fmt(k.coolingShare, 1)} %</b>`)}
          ${calcRow("Partial PUE (cooling)", "pPUE = (E_IT + E_cooling) ÷ E_IT", `(${fmt0(k.itMWh)} + ${fmt0(k.coolingMWh)}) ÷ ${fmt0(k.itMWh)} = <b>${fmt(k.pPUEcooling, 3)}</b>`)}
          ${k.hasTemp ? calcRow("Free-cooling utilisation", "FCU = cool days with CLF < 0.15 ÷ cool days", `${cool.filter((x) => x.clf < 0.15).length} ÷ ${cool.length} = <b>${fmt(k.freeCoolingUtilisationPct, 1)} %</b>`) : ""}
          ${scoreCalc("cooling")}
        </div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Monthly Cooling Load Factor</h3><p>Lower is better</p></div>
        <div class="chart short"><canvas id="co-monthly" aria-label="Monthly cooling load factor"></canvas></div>
      </div>`;
    if (k.hasTemp) {
      const ys = d.map((x) => x.clf);
      const lo = Math.min(...ys), hi = Math.max(...ys);
      scatter("co-scatter", d.map((x) => ({ x: x.temp, y: x.clf, date: x.date })), css("--c-cooling"), "°C", "CLF", 3, [{
        type: "line", label: "Threshold", data: [{ x: p.fcThreshold, y: lo }, { x: p.fcThreshold, y: hi }], borderColor: css("--muted"), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0,
      }]);
    }
    draw("co-monthly", {
      type: "line",
      data: { labels: m.map((x) => monthLabel(x.month)), datasets: [{ label: "CLF", data: m.map((x) => x.clf), borderColor: css("--c-cooling"), backgroundColor: css("--c-cooling") + "22", fill: true, borderWidth: 2, pointRadius: 3, tension: 0.25 }] },
      options: chartBase({ tooltip: { label: (c) => `CLF: ${fmt(c.parsed.y, 3)}` } }),
    });
  }

  function renderCarbon() {
    const r = state.result, k = r.metrics.kpis, p = state.profile, m = r.metrics.monthly;
    const cars = (k.co2MktT * k.annualise) / G.ASSUMPTIONS.carTonnesPerYear;
    $("#page-carbon").innerHTML = dimShell("carbon", "Dimension 4 · Carbon emissions", "Carbon emissions & CUE",
      "Scope 2 emissions from purchased electricity, by the GHG Protocol location-based method (grid average) and market-based method (after renewable contracts).") + `
      <div class="kpis">
        ${kpi("Location-based", fmt0(k.co2LocT), "tCO₂e")}
        ${kpi("Market-based", fmt0(k.co2MktT), "tCO₂e")}
        ${kpi("CUE", fmt(k.cue, 3), "kgCO₂e/kWh", `location-based ${fmt(k.cueLoc, 3)}`)}
        ${kpi("Average grid intensity", fmt0(k.avgGridCI), "g/kWh")}
        ${kpi("Renewable energy", fmt0(k.renewableMWh), "MWh", `ERF ${fmt(k.erf, 2)} (contracted)`)}
        ${kpi("Carbon cost", money(k.carbonCost), "", `at $${fmt0(k.carbonPrice)}/t`)}
        ${kpi("Equivalent cars", fmt0(cars), "per year", "4.6 tCO₂e per car-year")}
      </div>
      <div class="split">
        <div class="panel">
          <div class="panel-head"><h3>Monthly Scope 2 emissions</h3><div class="legend">${legend([["Location-based", css("--c-other")], ["Market-based", css("--c-carbon")]])}</div></div>
          <div class="chart"><canvas id="ca-monthly" aria-label="Monthly emissions"></canvas></div>
        </div>
        <div class="panel"><h3>Worked calculation</h3><div class="calc">
          ${calcRow("Location-based emissions", "CO₂_loc = Σ E_total,d × CI_d ÷ 10⁶", `${fmt0(k.totalMWh * 1000)} kWh × ${fmt(k.avgGridCI, 1)} g/kWh ÷ 10⁶ = <b>${fmt(k.co2LocT, 1)} t</b>`)}
          ${calcRow("Market-based emissions", "CO₂_mkt = CO₂_loc × (1 − RE%)", `${fmt(k.co2LocT, 1)} × (1 − ${fmt(k.renewablePct / 100, 2)}) = <b>${fmt(k.co2MktT, 1)} t</b>`)}
          ${calcRow("Carbon Usage Effectiveness", "CUE = CO₂_mkt (kg) ÷ E_IT (kWh)", `${fmt0(k.co2MktT * 1000)} ÷ ${fmt0(k.itMWh * 1000)} = <b>${fmt(k.cue, 4)} kg/kWh</b>`)}
          ${calcRow("Identity check", "CUE = PUE × CI × (1 − RE%)", `${fmt(k.pue, 3)} × ${fmt(k.avgGridCI / 1000, 4)} × ${fmt(1 - k.renewablePct / 100, 2)} = <b>${fmt(k.pue * (k.avgGridCI / 1000) * (1 - k.renewablePct / 100), 4)}</b>`)}
          ${calcRow("Renewable Energy Factor (ISO/IEC 30134-3)", "ERF = E_renewable ÷ E_total", `${fmt0(k.renewableMWh)} ÷ ${fmt0(k.totalMWh)} = <b>${fmt(k.erf, 3)}</b>`)}
          ${calcRow("Carbon cost", "C = CO₂_mkt × carbon price", `${fmt(k.co2MktT, 1)} × $${fmt0(k.carbonPrice)} = <b>$${fmt0(k.carbonCost)}</b>`)}
          ${scoreCalc("carbon")}
        </div></div>
      </div>`;
    draw("ca-monthly", {
      type: "bar",
      data: { labels: m.map((x) => monthLabel(x.month)), datasets: [
        { label: "Location-based", data: m.map((x) => x.co2LocT), backgroundColor: css("--c-other"), borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 22 },
        { label: "Market-based", data: m.map((x) => x.co2MktT), backgroundColor: css("--c-carbon"), borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 22 },
      ] },
      options: chartBase({ yTitle: "tCO₂e", tooltip: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y, 1)} t` } }),
    });
  }

  function renderNoise() {
    const r = state.result, k = r.metrics.kpis, p = state.profile, d = r.metrics.daily;
    const lwImplied = k.noiseP95 + 20 * Math.log10(p.distanceM) + 8;
    $("#page-noise").innerHTML = dimShell("noise", "Dimension 5 · Noise pollution", "Noise pollution",
      "Chillers, dry coolers and generators create a constant low-frequency hum. GreenDC compares the level at the nearest home or school with the local limit.") + `
      ${k.hasNoise ? `<div class="kpis">
        ${kpi("Mean level", fmt(k.noiseMean, 1), "dB(A)")}
        ${kpi("95th percentile", fmt(k.noiseP95, 1), "dB(A)")}
        ${kpi("Maximum", fmt(k.noiseMax, 1), "dB(A)")}
        ${kpi("Limit", fmt0(p.noiseLimit), "dB(A)")}
        ${kpi("Margin", signed(k.noiseMargin, 1), "dB", k.noiseMargin >= 0 ? "below limit" : "above limit")}
        ${kpi("Days above limit", fmt0(k.noiseExceedDays), "", `of ${k.days}`)}
        ${kpi("Implied plant Lw", fmt(lwImplied, 1), "dB(A)", `from P95 at ${fmt0(p.distanceM)} m`)}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Daily level at the nearest receiver</h3><div class="legend">${legend([["Daily level", css("--c-noise")], ["Limit", css("--critical"), true]])}</div></div>
        <div class="chart"><canvas id="no-daily" aria-label="Daily noise level"></canvas></div>
      </div>` : `<p class="msg">This dataset has no noise_dba column, so the noise dimension is excluded from the GreenScore. The acoustic calculator below still works.</p>`}
      <div class="grid grid-2">
        <div class="panel"><h3>Worked calculation</h3><div class="calc">
          ${k.hasNoise ? calcRow("Noise margin", "margin = limit − P95(daily Lp)", `${p.noiseLimit} − ${fmt(k.noiseP95, 2)} = <b>${signed(k.noiseMargin, 2)} dB</b>`) : ""}
          ${k.hasNoise ? calcRow("Implied sound power", "Lw = Lp + 20·log₁₀(r) + 8", `${fmt(k.noiseP95, 1)} + 20·log₁₀(${fmt0(p.distanceM)}) + 8 = <b>${fmt(lwImplied, 1)} dB(A)</b>`) : ""}
          ${scoreCalc("noise")}
        </div></div>
        <div class="panel">
          <div class="panel-head"><h3>Acoustic calculator</h3><p>Plan new plant or check a site</p></div>
          <form class="form" id="ac-form">
            <div class="field"><label for="ac-lw">Sound power per unit (dB(A))</label><input id="ac-lw" type="number" step="1" value="94"></div>
            <div class="field"><label for="ac-n">Number of units</label><input id="ac-n" type="number" min="1" step="1" value="${Math.max(2, Math.ceil((state.gen.itCapacityMW * 1000) / 450))}"></div>
            <div class="field"><label for="ac-r">Distance to receiver (m)</label><input id="ac-r" type="number" min="1" step="1" value="${p.distanceM}"></div>
            <div class="field"><label for="ac-att">Barrier / enclosure (dB)</label><input id="ac-att" type="number" min="0" step="1" value="0"></div>
          </form>
          <div class="calc" id="ac-out"></div>
        </div>
      </div>`;
    const calcAc = () => {
      const lw = Number($("#ac-lw").value), n = Math.max(1, Number($("#ac-n").value)), rr = Math.max(1, Number($("#ac-r").value)), att = Number($("#ac-att").value) || 0;
      const lwTot = G.combineLevels(new Array(n).fill(lw));
      const lp = G.soundPressureAt(lwTot, rr) - att;
      const rNeeded = Math.pow(10, (lwTot - att - 8 - p.noiseLimit) / 20);
      $("#ac-out").innerHTML =
        calcRow("Combined sound power", "Lw_tot = Lw + 10·log₁₀(N)", `${fmt(lw, 1)} + 10·log₁₀(${n}) = <b>${fmt(lwTot, 1)} dB(A)</b>`) +
        calcRow("Level at receiver", "Lp = Lw_tot − 20·log₁₀(r) − 8 − A_barrier", `${fmt(lwTot, 1)} − 20·log₁₀(${rr}) − 8 − ${att} = <b>${fmt(lp, 1)} dB(A)</b>`) +
        calcRow("Compliance", `limit ${p.noiseLimit} dB(A)`, lp <= p.noiseLimit ? `<b>Complies</b> with ${fmt(p.noiseLimit - lp, 1)} dB to spare` : `<b>Exceeds</b> by ${fmt(lp - p.noiseLimit, 1)} dB`) +
        calcRow("Distance needed to comply", "r = 10^((Lw_tot − A − 8 − limit) ÷ 20)", `<b>${fmt0(rNeeded)} m</b>`);
    };
    $("#ac-form").addEventListener("input", calcAc);
    calcAc();
    if (k.hasNoise) {
      draw("no-daily", {
        type: "line",
        data: { labels: d.map((x) => x.date), datasets: [
          { label: "Daily level", data: d.map((x) => x.noise), borderColor: css("--c-noise"), borderWidth: 1.5, pointRadius: 0 },
          { label: "Limit", data: d.map(() => p.noiseLimit), borderColor: css("--critical"), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
        ] },
        options: chartBase({ yTitle: "dB(A)", x: { ticks: { color: css("--muted"), maxTicksLimit: 8, font: { family: "IBM Plex Mono, ui-monospace, monospace", size: 11 } } }, tooltip: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y, 1)} dB(A)` } }),
      });
    }
  }

  let locationCache = null;
  function locationComparison() {
    const key = JSON.stringify([state.gen.itCapacityMW, state.gen.coolingSystem, state.gen.economiserAdoption, state.gen.seed, state.weights]);
    if (locationCache && locationCache.key === key) return locationCache.rows;
    const rows = Object.keys(G.LOCATIONS).map((loc) => {
      const data = G.generateDataset(Object.assign({}, state.gen, { location: loc, days: 365, injectAnomalies: false }));
      const prof = G.profileFromLocation(loc, state.gen.coolingSystem);
      const a = G.analyse(data, prof, state.weights);
      return { loc, name: G.LOCATIONS[loc].name, gs: a.green.score, grade: a.green.grade.grade, pue: a.metrics.kpis.pue, wue: a.metrics.kpis.wue, cue: a.metrics.kpis.cue, co2: a.metrics.kpis.co2MktT, locScore: a.scores.location.score };
    }).sort((a, b) => b.gs - a.gs);
    locationCache = { key, rows };
    return rows;
  }

  function renderLocation() {
    const r = state.result, k = r.metrics.kpis, p = state.profile;
    const parts = r.scores.location.parts;
    const comp = locationComparison();
    $("#page-location").innerHTML = dimShell("location", "Dimension 6 · Location-based impact", "Location-based environmental impact",
      "Where a data centre is built fixes much of its footprint: the carbon intensity of the grid, the scarcity of water, how many hours outside air can cool the hall, and how close the neighbours are.") + `
      <div class="kpis">
        ${kpi("Grid intensity", fmt0(p.gridCI), "gCO₂e/kWh")}
        ${kpi("Grid renewables", fmt0(p.gridRenewablePct), "%", "regional generation mix")}
        ${kpi("Water stress", fmt(p.waterStress, 1), "/ 5")}
        ${kpi("Free-cooling climate", fmt(k.freeCoolingDaysPct, 0), "% days")}
        ${kpi("Nearest receiver", fmt0(p.distanceM), "m")}
      </div>
      <div class="split">
        <div class="panel">
          <h3>Location sub-scores</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>Factor</th><th class="n">Value</th><th class="n">Best</th><th class="n">Worst</th><th class="n">Score</th><th style="width:30%"></th></tr></thead>
            <tbody>${parts.map((x) => `<tr><td>${x.name}</td><td class="n">${fmt(x.value, x.fmt)} ${x.unit}</td><td class="n">${x.best}</td><td class="n">${x.worst}</td><td class="n">${fmt(x.score, 1)}</td><td>${scoreBar(x.score, "--c-location")}</td></tr>`).join("")}</tbody>
          </table></div>
        </div>
        <div class="panel"><h3>Worked calculation</h3><div class="calc">${scoreCalc("location")}</div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Same facility, eight locations</h3><p>${fmt(state.gen.itCapacityMW, 1)} MW, ${esc(G.COOLING_SYSTEMS[state.gen.coolingSystem].name.toLowerCase())}, one simulated year each</p></div>
        <div class="chart short"><canvas id="lo-compare" aria-label="GreenScore by location"></canvas></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Location</th><th class="n">GreenScore</th><th>Grade</th><th class="n">Location score</th><th class="n">PUE</th><th class="n">WUE</th><th class="n">CUE</th><th class="n">tCO₂e / yr</th></tr></thead>
          <tbody>${comp.map((c) => `<tr${c.loc === p.locationKey && state.source === "Simulated" ? ' style="font-weight:600"' : ""}><td>${esc(c.name)}${c.loc === p.locationKey && state.source === "Simulated" ? " · current" : ""}</td><td class="n">${fmt(c.gs, 1)}</td><td>${c.grade}</td><td class="n">${fmt(c.locScore, 1)}</td><td class="n">${fmt(c.pue, 2)}</td><td class="n">${fmt(c.wue, 2)}</td><td class="n">${fmt(c.cue, 3)}</td><td class="n">${fmt0(c.co2)}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>`;
    draw("lo-compare", {
      type: "bar",
      data: { labels: comp.map((c) => c.name.split(",")[0]), datasets: [{ label: "GreenScore", data: comp.map((c) => c.gs), backgroundColor: comp.map((c) => (c.loc === p.locationKey ? css("--c-location") : css("--c-location") + "88")), borderRadius: 4, maxBarThickness: 34 }] },
      options: chartBase({ y: { min: 0, max: 100 }, tooltip: { label: (c) => `GreenScore: ${fmt(c.parsed.y, 1)}` } }),
    });
  }

  /* ======================================================
   *  GREENSCORE
   * ====================================================== */
  function setupWeights() {
    $("#weights").innerHTML = G.DIMENSIONS.map((d) => `<div class="lever">
        <label for="w-${d.key}"><i class="swatch" style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(${DIM_COLOR[d.key]});margin-right:6px"></i>${d.label}</label>
        <output id="wo-${d.key}" for="w-${d.key}"></output>
        <input type="range" id="w-${d.key}" min="0" max="50" step="1">
      </div>`).join("");
    $("#weights").addEventListener("input", (e) => {
      const key = e.target.id.replace("w-", "");
      state.weights[key] = Number(e.target.value);
      locationCache = null;
      recompute();
    });
    $("#btn-reset-weights").addEventListener("click", () => { state.weights = Object.assign({}, G.DEFAULT_WEIGHTS); locationCache = null; recompute(); });
  }

  function renderGreenScore() {
    const r = state.result, g = r.green;
    const wsum = G.DIMENSIONS.reduce((s, d) => s + state.weights[d.key], 0);
    G.DIMENSIONS.forEach((d) => {
      $("#w-" + d.key).value = state.weights[d.key];
      $("#wo-" + d.key).textContent = `${state.weights[d.key]} · ${fmt(wsum ? (state.weights[d.key] / wsum) * 100 : 0, 0)} %`;
    });
    drawGauge($("#gauge-2"), g.score, g.grade);
    const valid = g.items.filter((i) => isFinite(i.score) && i.weight > 0);
    $("#gs-sub").innerHTML = `(${valid.map((i) => `${i.weight}×${fmt(i.score, 1)}`).join(" + ")}) ÷ ${valid.reduce((s, i) => s + i.weight, 0)} = <b>${fmt(g.score, 1)}</b>`;
    $("#gs-table").innerHTML = `<thead><tr><th>Dimension</th><th class="n">Score</th><th class="n">Weight</th><th class="n">Share</th><th class="n">Contribution</th><th>Status</th><th style="width:28%"></th></tr></thead>
      <tbody>${g.items.map((i) => `<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(${DIM_COLOR[i.key]});margin-right:8px"></i>${i.label}</td><td class="n">${fmt(i.score, 1)}</td><td class="n">${i.weight}</td><td class="n">${fmt(i.normWeight * 100, 1)} %</td><td class="n">${fmt(i.contribution, 2)}</td><td>${statusPill(i.score)}</td><td>${scoreBar(i.score, DIM_COLOR[i.key])}</td></tr>`).join("")}
      <tr><td><b>GreenScore</b></td><td class="n"><b>${fmt(g.score, 1)}</b></td><td class="n">${wsum}</td><td class="n">100 %</td><td class="n"><b>${fmt(g.score, 2)}</b></td><td colspan="2">Grade ${g.grade.grade} · ${g.grade.label}</td></tr></tbody>`;
    $("#gs-sub-table").innerHTML = `<thead><tr><th>Dimension</th><th>Indicator</th><th class="n">Value</th><th class="n">Best (100)</th><th class="n">Worst (0)</th><th class="n">Weight</th><th class="n">Score</th></tr></thead>
      <tbody>${G.DIMENSIONS.map((d) => r.scores[d.key].parts.map((x, j) => `<tr><td>${j === 0 ? d.label : ""}</td><td>${x.name}</td><td class="n">${fmt(x.value, x.fmt)} ${x.unit}</td><td class="n">${x.best}</td><td class="n">${x.worst}</td><td class="n">${fmt(x.weight, 2)}</td><td class="n">${fmt(x.score, 1)}</td></tr>`).join("")).join("")}</tbody>`;
    $("#grade-table").innerHTML = `<thead><tr><th>Grade</th><th>Label</th><th class="n">GreenScore from</th></tr></thead><tbody>${G.GRADES.map((x) => `<tr${x.grade === g.grade.grade ? ' style="font-weight:600"' : ""}><td>${x.grade}</td><td>${x.label}${x.grade === g.grade.grade ? " · this facility" : ""}</td><td class="n">${x.min}</td></tr>`).join("")}</tbody>`;
  }

  /* ======================================================
   *  ANOMALIES
   * ====================================================== */
  const ANOM_METRICS = {
    pue: { label: "PUE", get: (d) => d.pue, digits: 3, events: ["cooling_fault", "ups_fault"] },
    clf: { label: "Cooling Load Factor", get: (d) => d.clf, digits: 3, events: ["cooling_fault"] },
    wue: { label: "WUE (L/kWh)", get: (d) => d.wue, digits: 3, events: ["water_leak"] },
    noise: { label: "Boundary noise (dB(A))", get: (d) => d.noise, digits: 1, events: ["noise_spike"] },
    it: { label: "IT energy (kWh)", get: (d) => d.it, digits: 0, events: ["it_surge"] },
    other: { label: "Distribution losses (kWh)", get: (d) => d.other, digits: 0, events: ["ups_fault"] },
  };
  function renderAnomalies() {
    const r = state.result, d = r.metrics.daily, k = r.metrics.kpis;
    const metric = $("#a-metric").value, cfg = ANOM_METRICS[metric];
    let method = $("#a-method").value;
    const threshold = clampNum($("#a-threshold").value, 1, 8, 3.5), win = Math.round(clampNum($("#a-window").value, 7, 60, 14));
    let note = "";
    if (method === "residual" && !k.hasTemp) { method = "rolling"; note = "No temperature column, so the rolling z-score is used instead. "; }
    const values = d.map(cfg.get);
    if (!values.every(isFinite)) {
      $("#anom-kpis").innerHTML = ""; $("#anom-table").innerHTML = "";
      $("#anom-method-note").textContent = "This indicator is not available in the dataset.";
      if (charts["anom-chart"]) charts["anom-chart"].destroy();
      return;
    }
    const res = G.detectAnomalies(values, { method, window: win, threshold, x: d.map((x) => x.temp) });
    const flags = res.map((x) => x.flag);
    const hasTruth = state.rows.some((x) => x.event);
    const truth = d.map((x) => cfg.events.includes(x.event));
    const ev = G.evaluateDetection(flags, truth);
    const nFlag = flags.filter(Boolean).length;
    $("#anom-kpis").innerHTML = [
      kpi("Days flagged", fmt0(nFlag), "", `${fmt((nFlag / d.length) * 100, 1)} % of days`),
      hasTruth ? kpi("Injected faults", fmt0(truth.filter(Boolean).length), "days", cfg.events.join(", ").replace(/_/g, " ")) : "",
      hasTruth ? kpi("Precision", isFinite(ev.precision) ? fmt(ev.precision * 100, 0) : "–", "%", `${ev.tp} true, ${ev.fp} false alarms`) : "",
      hasTruth ? kpi("Recall", fmt(ev.recall * 100, 0), "%", `${ev.fn} faults missed`) : "",
      hasTruth ? kpi("F1 score", isFinite(ev.f1) ? fmt(ev.f1, 2) : "–", "") : "",
    ].join("");
    const methodText = { residual: `Fit ${cfg.label} = β₀ + β₁·T, then robust z = (residual − median) ÷ (1.4826 × MAD); flag |z| > ${threshold}.`, rolling: `z = (x − mean of previous ${win} days) ÷ their standard deviation; flag |z| > ${threshold}.`, iqr: `Flag values outside Q1 − ${fmt(threshold / 2, 2)}·IQR and Q3 + ${fmt(threshold / 2, 2)}·IQR across the whole period.` };
    $("#anom-method-note").textContent = note + methodText[method];
    $("#anom-title").textContent = `Daily ${cfg.label}`;
    $("#anom-legend").innerHTML = legend([["Observed", css("--accent")], ["Expected", css("--muted"), true], ["Flagged", css("--critical")]]);
    const flagged = d.map((x, i) => ({ x, i, r: res[i] })).filter((o) => o.r.flag);
    $("#anom-table").innerHTML = flagged.length ? `<thead><tr><th>Date</th><th class="n">Observed</th><th class="n">Expected</th><th class="n">Deviation</th><th class="n">Score</th>${k.hasTemp ? '<th class="n">Temp (°C)</th>' : ""}${hasTruth ? "<th>Injected event</th>" : ""}</tr></thead>
      <tbody>${flagged.map((o) => `<tr><td>${o.x.date}</td><td class="n">${fmt(values[o.i], cfg.digits)}</td><td class="n">${fmt(o.r.expected, cfg.digits)}</td><td class="n">${signed(((values[o.i] - o.r.expected) / o.r.expected) * 100, 1)} %</td><td class="n">${fmt(o.r.score, 2)}</td>${k.hasTemp ? `<td class="n">${fmt(o.x.temp, 1)}</td>` : ""}${hasTruth ? `<td>${o.x.event ? `<span class="pill ${truth[o.i] ? "bad" : "warn"}">${o.x.event.replace(/_/g, " ")}</span>` : '<span style="color:var(--muted)">none (false alarm)</span>'}</td>` : ""}</tr>`).join("")}</tbody>`
      : `<tbody><tr><td>No days exceed the threshold. Lower it to see weaker deviations.</td></tr></tbody>`;
    draw("anom-chart", {
      type: "line",
      data: { labels: d.map((x) => x.date), datasets: [
        { label: "Observed", data: values, borderColor: css("--accent"), borderWidth: 1.5, pointRadius: 0, order: 2 },
        { label: "Expected", data: res.map((x) => x.expected), borderColor: css("--muted"), borderDash: [4, 4], borderWidth: 1.25, pointRadius: 0, order: 3 },
        { label: "Flagged", data: values.map((v, i) => (flags[i] ? v : null)), showLine: false, pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: css("--critical"), pointBorderColor: css("--surface"), pointBorderWidth: 2, order: 1 },
      ] },
      options: chartBase({ x: { ticks: { color: css("--muted"), maxTicksLimit: 8, font: { family: "IBM Plex Mono, ui-monospace, monospace", size: 11 } } }, tooltip: { label: (c) => (c.parsed.y == null ? null : `${c.dataset.label}: ${fmt(c.parsed.y, cfg.digits)}`) } }),
    });
  }

  /* ======================================================
   *  PREDICTIVE MODEL
   * ====================================================== */
  const FC_TARGETS = {
    pue: { label: "PUE", get: (d) => d.pue, digits: 3, unit: "" },
    cooling: { label: "Cooling energy", get: (d) => d.cooling, digits: 0, unit: "kWh/day" },
    wue: { label: "WUE", get: (d) => d.wue, digits: 3, unit: "L/kWh" },
    noise: { label: "Boundary noise", get: (d) => d.noise, digits: 1, unit: "dB(A)" },
  };
  function renderForecast() {
    const r = state.result, d = r.metrics.daily, k = r.metrics.kpis;
    const t = FC_TARGETS[$("#fc-target").value];
    if (!k.hasTemp) {
      $("#fc-kpis").innerHTML = ""; $("#fc-calc").innerHTML = `<p class="msg">The predictive model needs a temp_c column.</p>`;
      if (charts["fc-chart"]) charts["fc-chart"].destroy();
      return;
    }
    const xs = d.map((x) => x.temp), ys = d.map(t.get);
    const reg = G.linearRegression(xs, ys);
    if (!reg) { $("#fc-calc").innerHTML = `<p class="msg">${t.label} is not available in this dataset.</p>`; $("#fc-kpis").innerHTML = ""; return; }
    const T = Number($("#fc-temp").value) || 0, dT = Number($("#fc-warming").value) || 0;
    const yhat = reg.predict(T);
    let warmText = `Mean ${t.label} changes by ${signed(reg.slope * dT, t.digits)} ${t.unit}`;
    let extraMWh = NaN, extraCO2 = NaN;
    if ($("#fc-target").value === "pue") {
      extraMWh = d.reduce((s, x) => s + x.it * reg.slope * dT, 0) / 1000 * k.annualise;
      extraCO2 = d.reduce((s, x) => s + x.it * reg.slope * dT * x.ci, 0) / 1e6 * (1 - k.renewablePct / 100) * k.annualise;
      warmText = `${signed(extraMWh, 0)} MWh/yr and ${signed(extraCO2, 0)} tCO₂e/yr`;
    } else if ($("#fc-target").value === "cooling") {
      extraMWh = (reg.slope * dT * 365) / 1000;
      warmText = `${signed(extraMWh, 0)} MWh/yr of cooling energy`;
    }
    $("#fc-kpis").innerHTML = [
      kpi("Prediction at " + fmt(T, 1) + " °C", fmt(yhat, t.digits), t.unit),
      kpi("Slope", signed(reg.slope, t.digits === 0 ? 0 : 4), (t.unit ? t.unit : "") + " per °C"),
      kpi("R²", fmt(reg.r2, 3), "", reg.r2 > 0.7 ? "strong fit" : reg.r2 > 0.4 ? "moderate fit" : "weak fit"),
      kpi("RMSE", fmt(reg.rmse, t.digits === 0 ? 0 : 4), t.unit),
      kpi(`Warming +${fmt(dT, 1)} °C`, warmText.split(" and ")[0], "", warmText.includes(" and ") ? warmText.split(" and ")[1] : ""),
    ].join("");
    $("#fc-calc").innerHTML =
      calcRow("Model", "ŷ = β₀ + β₁·T", `ŷ = ${fmt(reg.intercept, 4)} ${reg.slope >= 0 ? "+" : "−"} ${fmt(Math.abs(reg.slope), 5)}·T`) +
      calcRow("Slope", "β₁ = Σ(T − T̄)(y − ȳ) ÷ Σ(T − T̄)²", `<b>${fmt(reg.slope, 5)}</b> per °C, from n = ${reg.n} days`) +
      calcRow("Intercept", "β₀ = ȳ − β₁·T̄", `<b>${fmt(reg.intercept, 4)}</b>`) +
      calcRow("Goodness of fit", "R² = 1 − SS_res ÷ SS_tot", `<b>${fmt(reg.r2, 3)}</b>, RMSE ${fmt(reg.rmse, 4)}`) +
      calcRow("Point forecast", `ŷ(${fmt(T, 1)} °C)`, `${fmt(reg.intercept, 4)} + ${fmt(reg.slope, 5)} × ${fmt(T, 1)} = <b>${fmt(yhat, t.digits)} ${t.unit}</b>`) +
      calcRow("Climate scenario", `Δy = β₁ × ${fmt(dT, 1)} °C on every day`, `<b>${warmText}</b>`);
    $("#fc-title").textContent = `${t.label} vs outdoor temperature`;
    $("#fc-legend").innerHTML = legend([["Daily observations", css("--accent")], ["OLS fit", css("--ink")]]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    draw("fc-chart", {
      type: "scatter",
      data: { datasets: [
        { label: "Observed", data: d.map((x) => ({ x: x.temp, y: t.get(x), date: x.date })), backgroundColor: css("--accent") + "80", borderColor: css("--surface"), borderWidth: 1, pointRadius: 4 },
        { type: "line", label: "Fit", data: [{ x: xmin, y: reg.predict(xmin) }, { x: xmax, y: reg.predict(xmax) }], borderColor: css("--ink"), borderWidth: 2, pointRadius: 0 },
        { label: "Forecast", data: [{ x: T, y: yhat }], backgroundColor: css("--critical"), pointRadius: 7, pointStyle: "rectRot", borderColor: css("--surface"), borderWidth: 2 },
      ] },
      options: chartBase({ mode: "nearest", x: { type: "linear", title: { display: true, text: "Outdoor temperature (°C)", color: css("--ink-2") }, grid: { color: css("--grid") } }, yTitle: t.label + (t.unit ? ` (${t.unit})` : ""),
        tooltip: { label: (c) => `${c.raw.date ? c.raw.date + ": " : c.dataset.label + ": "}${fmt(c.parsed.x, 1)} °C → ${fmt(c.parsed.y, t.digits)}` } }),
    });
  }

  /* ======================================================
   *  SIMULATOR
   * ====================================================== */
  const LEVERS = [
    { key: "setpointDelta", label: "Raise supply-air setpoint", min: 0, max: 6, step: 0.5, unit: "°C", help: "ASHRAE recommended inlet range is 18–27 °C. Assumes 4 % less cooling energy and 2 % less water per °C" },
    { key: "economiserBoost", label: "Extend economiser (free cooling)", min: 0, max: 100, step: 5, unit: "%", help: "Share of mechanical cooling removed on days below the threshold" },
    { key: "itReduction", label: "Virtualise and consolidate servers", min: 0, max: 30, step: 1, unit: "%", help: "IT energy saved; cooling, losses and water scale with it" },
    { key: "lossReduction", label: "Cut distribution & lighting losses", min: 0, max: 60, step: 5, unit: "%", help: "Eco-mode UPS, high-efficiency transformers, LED lighting" },
    { key: "renewablePct", label: "Renewable electricity supply", min: 0, max: 100, step: 5, unit: "%", help: "PPA, green tariff or on-site solar (market-based Scope 2)" },
    { key: "waterReuse", label: "Water reuse / closed loop", min: 0, max: 90, step: 5, unit: "%", help: "Potable water avoided; assumes up to 7.5 % more cooling energy at 100 %" },
    { key: "noiseMitigation", label: "Acoustic mitigation", min: 0, max: 15, step: 1, unit: "dB", help: "Enclosures, low-noise fans, barriers" },
  ];
  const PRESETS = {
    "Quick wins": { setpointDelta: 2, economiserBoost: 30, lossReduction: 20 },
    "Deep retrofit": { setpointDelta: 4, economiserBoost: 70, itReduction: 15, lossReduction: 40, waterReuse: 50, noiseMitigation: 8 },
    "Net-zero path": { setpointDelta: 3, economiserBoost: 60, itReduction: 10, lossReduction: 30, renewablePct: 100, waterReuse: 30 },
  };
  function setupSimulator() {
    $("#levers").innerHTML = LEVERS.map((l) => `<div class="lever">
      <label for="l-${l.key}">${l.label}</label><output id="lo-${l.key}" for="l-${l.key}"></output>
      <input type="range" id="l-${l.key}" min="${l.min}" max="${l.max}" step="${l.step}">
      <small>${l.help}</small></div>`).join("");
    $("#levers").addEventListener("input", (e) => { state.levers[e.target.id.replace("l-", "")] = Number(e.target.value); renderSimulator(); });
    $("#presets").innerHTML = Object.keys(PRESETS).map((p) => `<button class="btn small" type="button" data-preset="${p}">${p}</button>`).join("") + `<button class="btn small" type="button" data-preset="reset">Reset</button>`;
    $("#presets").addEventListener("click", (e) => {
      const name = e.target.dataset && e.target.dataset.preset;
      if (!name) return;
      state.levers = Object.assign({}, G.DEFAULT_LEVERS, { renewablePct: state.profile.renewablePct }, name === "reset" ? {} : PRESETS[name]);
      renderSimulator();
    });
  }
  function renderSimulator() {
    if (state.levers.renewablePct == null) state.levers.renewablePct = state.profile.renewablePct;
    LEVERS.forEach((l) => { $("#l-" + l.key).value = state.levers[l.key]; $("#lo-" + l.key).textContent = `${l.key === "setpointDelta" ? "+" : ""}${state.levers[l.key]} ${l.unit}`; });
    const c = G.compareScenario(state.rows, state.profile, state.levers, state.weights);
    const D = c.delta, kb = c.base.metrics.kpis, ks = c.scen.metrics.kpis;
    $("#sim-kpis").innerHTML = [
      kpi("Energy saved", signed(D.energyMWh, 0), "MWh/yr"),
      kpi("Emissions avoided", signed(D.co2T, 0), "tCO₂e/yr"),
      kpi("Water saved", signed(D.waterM3, 0), "m³/yr"),
      kpi("Cost saved", money(D.totalCost), "/yr", "energy + water + carbon"),
      kpi("GreenScore", fmt(c.scen.green.score, 1), "", `${signed(D.greenScore, 1)} points`),
      kpi("Grade", c.scen.green.grade.grade, "", `from ${c.base.green.grade.grade}`),
    ].join("");
    $("#sim-legend").innerHTML = legend([["Baseline", css("--c-other")], ["Scenario", css("--accent")]]);
    draw("sim-chart", {
      type: "bar",
      data: { labels: G.DIMENSIONS.map((d) => d.label), datasets: [
        { label: "Baseline", data: G.DIMENSIONS.map((d) => c.base.scores[d.key].score), backgroundColor: css("--c-other"), borderRadius: 4, maxBarThickness: 20 },
        { label: "Scenario", data: G.DIMENSIONS.map((d) => c.scen.scores[d.key].score), backgroundColor: css("--accent"), borderRadius: 4, maxBarThickness: 20 },
      ] },
      options: chartBase({ y: { min: 0, max: 100 }, tooltip: { label: (x) => `${x.dataset.label}: ${fmt(x.parsed.y, 1)}` } }),
    });
    const rows = [
      ["Facility energy (MWh)", kb.totalMWh, ks.totalMWh, 0, true],
      ["IT energy (MWh)", kb.itMWh, ks.itMWh, 0, true],
      ["Cooling energy (MWh)", kb.coolingMWh, ks.coolingMWh, 0, true],
      ["PUE", kb.pue, ks.pue, 3, true],
      ["WUE (L/kWh)", kb.wue, ks.wue, 3, true],
      ["Water (m³)", kb.waterM3, ks.waterM3, 0, true],
      ["CLF", kb.clf, ks.clf, 3, true],
      ["CUE (kgCO₂e/kWh)", kb.cue, ks.cue, 3, true],
      ["Market-based emissions (tCO₂e)", kb.co2MktT, ks.co2MktT, 0, true],
      ["Noise P95 (dB(A))", kb.noiseP95, ks.noiseP95, 1, true],
      ["Energy cost (USD)", kb.energyCost, ks.energyCost, 0, true],
      ["Water cost (USD)", kb.waterCost, ks.waterCost, 0, true],
    ].concat(G.DIMENSIONS.map((d) => [`${d.label} score`, c.base.scores[d.key].score, c.scen.scores[d.key].score, 1, false]))
      .concat([["GreenScore", c.base.green.score, c.scen.green.score, 1, false]]);
    $("#sim-table").innerHTML = `<thead><tr><th>Indicator (for the dataset period)</th><th class="n">Baseline</th><th class="n">Scenario</th><th class="n">Change</th></tr></thead><tbody>${rows.map(([n, a, b, dg, lowerBetter]) => {
      const ch = b - a, good = lowerBetter ? ch < 0 : ch > 0;
      const cls = Math.abs(ch) < 1e-9 || !isFinite(ch) ? "" : good ? "delta-up" : "delta-down";
      return `<tr${n === "GreenScore" ? ' style="font-weight:600"' : ""}><td>${n}</td><td class="n">${fmt(a, dg)}</td><td class="n">${fmt(b, dg)}</td><td class="n ${cls}">${signed(ch, dg)}${isFinite(a) && a !== 0 && lowerBetter ? ` (${signed((ch / a) * 100, 1)} %)` : ""}</td></tr>`;
    }).join("")}</tbody>`;
  }

  /* ======================================================
   *  RECOMMENDATIONS
   * ====================================================== */
  let recCache = null;
  function renderRecommendations() {
    const recs = G.recommendations(state.rows, state.profile, state.weights);
    recCache = recs;
    $("#recs").innerHTML = recs.length ? recs.map((r, i) => `<div class="rec">
        <div>
          <h3><span class="dim-tag" style="background:var(${DIM_COLOR[r.dimension]})">${r.dimension}</span>${esc(r.title)}</h3>
          <p>${esc(r.why)}</p>
          ${r.delta ? `<div class="savings">
            <span>Energy <b>${signed(r.delta.energyMWh, 0)} MWh/yr</b></span>
            <span>CO₂e <b>${signed(r.delta.co2T, 0)} t/yr</b></span>
            <span>Water <b>${signed(r.delta.waterM3, 0)} m³/yr</b></span>
            <span>Cost <b>${r.delta.totalCost < 0 ? "−" : ""}$${fmt0(Math.abs(r.delta.totalCost))}/yr</b></span>
            <span>Effort <b>${r.effort}</b></span>
          </div>` : `<div class="savings"><span>Effort <b>${r.effort}</b></span></div>`}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
          ${r.delta ? `<div class="gain">${signed(r.delta.greenScore, 1)}<small>GreenScore points</small></div><button class="btn small" type="button" data-rec="${i}">Open in simulator</button>` : ""}
        </div>
      </div>`).join("") : `<p>All indicators are within good-practice ranges. Use the simulator to test further improvements.</p>`;
  }
  function setupRecommendations() {
    $("#recs").addEventListener("click", (e) => {
      const i = e.target.dataset && e.target.dataset.rec;
      if (i === undefined || !recCache) return;
      state.levers = Object.assign({}, G.DEFAULT_LEVERS, { renewablePct: state.profile.renewablePct }, recCache[i].levers);
      location.hash = "#simulator";
    });
    const report = () => {
      const r = state.result;
      return JSON.stringify({
        framework: "GreenDC", generated: new Date().toISOString(), source: state.source,
        facility: state.profile, simulation: state.source === "Simulated" ? state.gen : undefined,
        weights: state.weights,
        greenScore: { score: r.green.score, grade: r.green.grade },
        dimensions: Object.fromEntries(G.DIMENSIONS.map((d) => [d.key, r.scores[d.key]])),
        kpis: r.metrics.kpis,
        monthly: r.metrics.monthly,
        recommendations: G.recommendations(state.rows, state.profile, state.weights).map((x) => ({ dimension: x.dimension, title: x.title, why: x.why, effort: x.effort, levers: x.levers, annualSavings: x.delta })),
      }, (k, v) => (typeof v === "number" && !isFinite(v) ? null : v), 2);
    };
    $("#btn-export-report").addEventListener("click", () => download("greendc_report.json", report(), "application/json"));
    $("#btn-export-metrics").addEventListener("click", () => {
      const cols = ["date", "it", "cooling", "other", "total", "water", "temp", "util", "noise", "ci", "pue", "dcie", "wue", "clf", "cer", "cue", "co2Loc", "co2Mkt", "event"];
      download("greendc_daily_indicators.csv", G.toCSV(state.result.metrics.daily.map((d) => Object.fromEntries(cols.map((c) => [c, typeof d[c] === "number" ? +d[c].toFixed(5) : d[c]]))), cols), "text/csv");
    });
    $("#btn-copy-report").addEventListener("click", () => {
      const text = report();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => showMsg("#export-msg", "Report copied to the clipboard.", "ok"), () => showMsg("#export-msg", "The clipboard is blocked here. Use Download report instead.", "err"));
      } else showMsg("#export-msg", "The clipboard is not available here. Use Download report instead.", "err");
    });
  }

  /* ======================================================
   *  METHODOLOGY
   * ====================================================== */
  function renderMethodology() {
    const tests = G.selfTest();
    const passed = tests.filter((t) => t.pass).length;
    $("#val-summary").innerHTML = `<span class="pill ${passed === tests.length ? "good" : "bad"}">${passed} of ${tests.length} checks pass</span>`;
    $("#val-table").innerHTML = `<thead><tr><th>Check</th><th>Hand calculation</th><th class="n">Expected</th><th class="n">GreenDC result</th><th>Result</th></tr></thead><tbody>${tests.map((t) => `<tr><td>${esc(t.name)}</td><td class="mono">${esc(t.working)}</td><td class="n">${fmt(t.expected, 4)}</td><td class="n">${fmt(t.actual, 4)}</td><td>${t.pass ? '<span class="pill good">Pass</span>' : '<span class="pill bad">Fail</span>'}</td></tr>`).join("")}</tbody>`;
    const A = G.ASSUMPTIONS;
    $("#assump-table").innerHTML = `<thead><tr><th>Assumption</th><th class="n">Value</th><th>Used in</th></tr></thead><tbody>
      <tr><td>Cooling energy saved per °C setpoint rise</td><td class="n">${fmt(A.coolingSavingPerDegC * 100, 1)} %</td><td>Simulator</td></tr>
      <tr><td>Water saved per °C setpoint rise</td><td class="n">${fmt(A.waterSavingPerDegC * 100, 1)} %</td><td>Simulator</td></tr>
      <tr><td>Residual cooling with full economiser (CLF floor)</td><td class="n">${fmt(A.economiserFloorCLF, 2)}</td><td>Simulator</td></tr>
      <tr><td>Extra cooling energy at 100 % water reuse</td><td class="n">${fmt(A.waterReusePenalty * 100, 1)} %</td><td>Simulator</td></tr>
      <tr><td>Energy water intensity factor (EWIF)</td><td class="n">${fmt(A.waterEnergyFactor, 1)} L/kWh</td><td>Source WUE</td></tr>
      <tr><td>Passenger car emissions</td><td class="n">${fmt(A.carTonnesPerYear, 1)} t/yr</td><td>Carbon equivalence</td></tr>
      <tr><td>Carbon price (default, editable per facility)</td><td class="n">$${G.CARBON_PRICE_PER_T}/t</td><td>Cost of carbon</td></tr>
      <tr><td>Free-cooling threshold (daily mean outdoor temperature)</td><td class="n">18 °C</td><td>Cooling and location scores</td></tr>
      <tr><td>Free-cooling day counts as used when CLF is below</td><td class="n">0.15</td><td>Cooling score</td></tr>
    </tbody>`;
    const B = G.BENCHMARKS;
    const names = { pue: "PUE", itUtil: "IT utilisation", wue: "WUE (site)", clf: "Cooling Load Factor", cue: "CUE (market-based)", noiseMargin: "Noise margin", gridCI: "Grid carbon intensity", waterStress: "Water stress", freeCooling: "Free-cooling days", renewables: "Grid renewable share", distance: "Distance to receivers" };
    $("#bench-table").innerHTML = `<thead><tr><th>Indicator</th><th class="n">Best (100)</th><th class="n">Worst (0)</th><th>Unit</th><th>Context</th></tr></thead><tbody>${Object.entries(B).map(([k, b]) => `<tr><td>${names[k]}</td><td class="n">${b.best}</td><td class="n">${b.worst}</td><td>${b.unit || "–"}</td><td style="white-space:normal;min-width:240px">${b.note}</td></tr>`).join("")}</tbody>`;
  }

  const RENDER = {
    overview: renderOverview, data: renderData, energy: renderEnergy, water: renderWater, cooling: renderCooling,
    carbon: renderCarbon, noise: renderNoise, location: renderLocation, greenscore: renderGreenScore,
    anomalies: renderAnomalies, forecast: renderForecast, simulator: renderSimulator,
    recommendations: renderRecommendations, methodology: renderMethodology,
  };

  /* ---------------- boot ---------------- */
  function boot() {
    setupDataForms();
    setupWeights();
    setupSimulator();
    setupRecommendations();
    $("#anom-form").addEventListener("input", renderAnomalies);
    $("#anom-form").addEventListener("change", renderAnomalies);
    $("#fc-form").addEventListener("input", renderForecast);
    $("#fc-form").addEventListener("change", renderForecast);
    setupProjects();
    const saved = store.get(STORE_KEY);
    let restored = false;
    if (saved) { try { applySnapshot(saved); restored = true; } catch (e) { restored = false; } }
    if (!restored) generate();
    window.addEventListener("hashchange", route);
    route();
    // Re-draw charts when the theme changes so they pick up the new tokens.
    const rerender = () => renderPage(state.page);
    if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerender);
    new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
