/*
 * GreenDC calculation engine
 * --------------------------------------------------------------
 * Pure functions only: no DOM access. The same file runs in the
 * browser (window.GreenDC) and in Node (module.exports) so the
 * calculations can be tested and reproduced outside the website.
 * The Python reference implementation in /python/greendc.py mirrors
 * every formula here.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GreenDC = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------------------------------------------------- *
   * 1. Constants, benchmarks and location presets
   * ---------------------------------------------------------- */

  const DIMENSIONS = [
    { key: "energy",   label: "Energy" },
    { key: "water",    label: "Water" },
    { key: "cooling",  label: "Cooling" },
    { key: "carbon",   label: "Carbon" },
    { key: "noise",    label: "Noise" },
    { key: "location", label: "Location" },
  ];

  const DEFAULT_WEIGHTS = { energy: 25, water: 15, cooling: 15, carbon: 25, noise: 10, location: 10 };

  // Score normalisation anchors: value at which the score is 100 ("best")
  // and value at which it is 0 ("worst"). Linear in between, clamped.
  const BENCHMARKS = {
    pue:        { best: 1.10, worst: 2.00, unit: "",        note: "Uptime Institute global average ≈ 1.56 (2024)" },
    itUtil:     { best: 80,   worst: 20,   unit: "%",       note: "Average server utilisation in enterprise DCs is often 20–40 %" },
    wue:        { best: 0.0,  worst: 2.5,  unit: "L/kWh",   note: "Industry average WUE ≈ 1.8 L/kWh" },
    clf:        { best: 0.05, worst: 0.60, unit: "",        note: "Cooling Load Factor = cooling energy ÷ IT energy" },
    cue:        { best: 0.0,  worst: 0.70, unit: "kgCO₂e/kWh", note: "CUE of a coal-heavy grid at PUE 1.6 ≈ 1.3" },
    noiseMargin:{ best: 10,   worst: -10,  unit: "dB",      note: "Margin = local limit − 95th-percentile level at the nearest receiver" },
    gridCI:     { best: 50,   worst: 800,  unit: "gCO₂e/kWh", note: "Nordic hydro ≈ 30–50, coal-heavy grids ≈ 700–900" },
    waterStress:{ best: 0,    worst: 5,    unit: "0–5",     note: "WRI Aqueduct baseline water stress scale" },
    freeCooling:{ best: 100,  worst: 0,    unit: "% days",  note: "Share of days below the economiser threshold" },
    renewables: { best: 100,  worst: 0,    unit: "%",       note: "Contracted or on-site renewable share" },
    distance:   { best: 1000, worst: 50,   unit: "m",       note: "Distance to the nearest noise-sensitive receiver" },
  };

  const GRADES = [
    { min: 90, grade: "A+", label: "Exemplary" },
    { min: 80, grade: "A",  label: "Leading" },
    { min: 70, grade: "B",  label: "Good" },
    { min: 60, grade: "C",  label: "Fair" },
    { min: 50, grade: "D",  label: "Needs improvement" },
    { min: 40, grade: "E",  label: "Poor" },
    { min: 0,  grade: "F",  label: "Critical" },
  ];

  // Indicative regional values for simulation. They are rounded public
  // figures meant for research demonstration, not certified data.
  const LOCATIONS = {
    stockholm: { name: "Stockholm, Sweden",     tempMean: 7.5,  tempAmp: 9.5, hemisphere: "N", gridCI: 40,  renewablePct: 70, waterStress: 0.6, distanceM: 600, noiseLimit: 45, priceKwh: 0.09, priceWaterM3: 2.6 },
    dublin:    { name: "Dublin, Ireland",       tempMean: 10.0, tempAmp: 5.0, hemisphere: "N", gridCI: 290, renewablePct: 40, waterStress: 1.2, distanceM: 350, noiseLimit: 45, priceKwh: 0.22, priceWaterM3: 2.2 },
    virginia:  { name: "Ashburn, Virginia, US", tempMean: 13.5, tempAmp: 11.5, hemisphere: "N", gridCI: 370, renewablePct: 25, waterStress: 2.1, distanceM: 250, noiseLimit: 50, priceKwh: 0.08, priceWaterM3: 1.6 },
    phoenix:   { name: "Phoenix, Arizona, US",  tempMean: 24.0, tempAmp: 10.0, hemisphere: "N", gridCI: 380, renewablePct: 20, waterStress: 4.6, distanceM: 400, noiseLimit: 50, priceKwh: 0.10, priceWaterM3: 1.9 },
    singapore: { name: "Singapore",             tempMean: 27.8, tempAmp: 1.0, hemisphere: "N", gridCI: 410, renewablePct: 5,  waterStress: 2.8, distanceM: 150, noiseLimit: 55, priceKwh: 0.21, priceWaterM3: 2.0 },
    karachi:   { name: "Karachi, Pakistan",     tempMean: 26.5, tempAmp: 5.5, hemisphere: "N", gridCI: 430, renewablePct: 15, waterStress: 4.4, distanceM: 120, noiseLimit: 55, priceKwh: 0.14, priceWaterM3: 0.6 },
    mumbai:    { name: "Mumbai, India",         tempMean: 27.5, tempAmp: 2.5, hemisphere: "N", gridCI: 710, renewablePct: 12, waterStress: 3.9, distanceM: 120, noiseLimit: 55, priceKwh: 0.11, priceWaterM3: 0.5 },
    sydney:    { name: "Sydney, Australia",     tempMean: 18.5, tempAmp: 5.0, hemisphere: "S", gridCI: 620, renewablePct: 30, waterStress: 2.5, distanceM: 300, noiseLimit: 50, priceKwh: 0.18, priceWaterM3: 2.4 },
  };

  // Cooling architectures used by the simulator.
  const COOLING_SYSTEMS = {
    evaporative: { name: "Chillers + evaporative cooling towers", copFactor: 1.15, waterBase: 0.40, waterSlope: 0.075, fcOffset: 0,  lwUnit: 94 },
    aircooled:   { name: "Air-cooled chillers + dry coolers",      copFactor: 0.90, waterBase: 0.04, waterSlope: 0.004, fcOffset: 0,  lwUnit: 97 },
    liquid:      { name: "Direct-to-chip liquid cooling",          copFactor: 1.60, waterBase: 0.25, waterSlope: 0.030, fcOffset: 8,  lwUnit: 90 },
  };

  const CARBON_PRICE_PER_T = 85; // USD per tonne CO2e, used to value carbon savings

  /* ---------------------------------------------------------- *
   * 2. Small numeric helpers
   * ---------------------------------------------------------- */

  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : NaN);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function std(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1));
  }
  function quantile(a, q) {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y);
    const pos = (s.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  // Linear score: 100 at `best`, 0 at `worst`, clamped to [0, 100].
  function linearScore(value, best, worst) {
    if (!isFinite(value)) return NaN;
    return clamp(((value - worst) / (best - worst)) * 100, 0, 100);
  }
  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(rand) {
    const u = 1 - rand(), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const db2lin = (db) => Math.pow(10, db / 10);
  const lin2db = (x) => 10 * Math.log10(x);

  /* ---------------------------------------------------------- *
   * 3. Physics-informed simulated dataset
   * ---------------------------------------------------------- */

  // Fraction of the day the economiser (free cooling) can carry the load.
  function freeCoolingFraction(tempC, thresholdC) {
    return 1 / (1 + Math.exp((tempC - thresholdC) / 1.8));
  }
  // Mechanical cooling coefficient of performance falls as outdoor air warms.
  function chillerCOP(tempC, copFactor) {
    return Math.max(1.8, 6.0 - 0.13 * (tempC - 10)) * copFactor;
  }

  /**
   * Generate one year (or `days`) of daily operating data.
   * opts: { location, itCapacityMW, coolingSystem, economiserAdoption (0-1),
   *         days, seed, startDate, injectAnomalies }
   */
  function generateDataset(opts) {
    const o = Object.assign({
      location: "virginia", itCapacityMW: 2, coolingSystem: "evaporative",
      economiserAdoption: 0.6, days: 365, seed: 42, startDate: "2025-01-01",
      injectAnomalies: true, coolingUnits: null,
    }, opts || {});
    const loc = LOCATIONS[o.location] || LOCATIONS.virginia;
    const cs = COOLING_SYSTEMS[o.coolingSystem] || COOLING_SYSTEMS.evaporative;
    const rand = mulberry32(o.seed);
    const start = new Date(o.startDate + "T00:00:00Z");
    const peakDay = loc.hemisphere === "S" ? 15 : 200;
    const fcThreshold = 18 + cs.fcOffset;
    const units = o.coolingUnits || Math.max(2, Math.ceil((o.itCapacityMW * 1000) / 450));
    const lwTotal = cs.lwUnit + lin2db(units); // dB(A) sound power of the whole plant

    // Plan injected anomalies (ground truth for detector evaluation).
    const events = {};
    if (o.injectAnomalies) {
      const kinds = ["cooling_fault", "water_leak", "noise_spike", "cooling_fault", "it_surge", "water_leak", "noise_spike", "ups_fault"];
      kinds.forEach((kind, i) => {
        const day = Math.floor(((i + 0.5) / kinds.length) * o.days + (rand() - 0.5) * 20);
        const len = kind === "it_surge" ? 1 : 1 + Math.floor(rand() * 3);
        for (let k = 0; k < len; k++) {
          const d = clamp(day + k, 14, o.days - 1);
          events[d] = kind;
        }
      });
    }

    const rows = [];
    for (let d = 0; d < o.days; d++) {
      const date = new Date(start.getTime() + d * 86400000);
      const doy = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86400000);
      const weekday = date.getUTCDay();
      const temp = loc.tempMean + loc.tempAmp * Math.cos((2 * Math.PI * (doy - peakDay)) / 365) + gaussian(rand) * 2.2;

      // IT utilisation: base + weekday effect + slow growth + noise
      let util = 0.55 + (weekday >= 1 && weekday <= 5 ? 0.04 : -0.03) + 0.08 * (d / o.days) + gaussian(rand) * 0.02;
      util = clamp(util, 0.1, 0.98);
      // Linear server power model: P = P_idle + (P_max - P_idle) * u, idle = 50 %
      let itKwh = o.itCapacityMW * 1000 * 24 * (0.5 + 0.5 * util);

      const f = freeCoolingFraction(temp, fcThreshold) * o.economiserAdoption;
      const cop = chillerCOP(temp, cs.copFactor);
      let coolingKwh = itKwh * ((1 - f) / cop + f * 0.04 + 0.07); // + CRAH/pump fan energy
      let otherKwh = itKwh * (0.085 + gaussian(rand) * 0.003) + o.itCapacityMW * 1000 * 24 * 0.005;
      let waterL = itKwh * (cs.waterBase + cs.waterSlope * Math.max(0, temp - 5)) * (1 - 0.6 * f) * (1 + gaussian(rand) * 0.04);
      waterL = Math.max(0, waterL);

      // Fan law: sound power changes by 50·log10(speed ratio)
      const fanSpeed = clamp(0.55 + 0.45 * (1 - f) * clamp((temp + 5) / 40, 0, 1) + 0.15 * util, 0.3, 1.1);
      let noise = soundPressureAt(lwTotal + 50 * Math.log10(fanSpeed), loc.distanceM) + gaussian(rand) * 0.8;
      const gridCI = loc.gridCI * (1 + 0.06 * Math.sin((2 * Math.PI * doy) / 365) + gaussian(rand) * 0.04);

      const ev = events[d] || "";
      if (ev === "cooling_fault") coolingKwh *= 1.55;
      if (ev === "water_leak") waterL *= 2.1;
      if (ev === "noise_spike") noise += 9;
      if (ev === "it_surge") { itKwh *= 1.18; coolingKwh *= 1.18; }
      if (ev === "ups_fault") otherKwh *= 1.9;

      rows.push({
        date: date.toISOString().slice(0, 10),
        it_kwh: round(itKwh, 1),
        cooling_kwh: round(coolingKwh, 1),
        other_kwh: round(otherKwh, 1),
        water_l: round(waterL, 0),
        temp_c: round(temp, 1),
        it_util_pct: round(util * 100, 1),
        noise_dba: round(noise, 1),
        grid_ci: round(gridCI, 1),
        event: ev,
      });
    }
    return rows;
  }

  function round(v, n) { const p = Math.pow(10, n); return Math.round(v * p) / p; }

  /* ---------------------------------------------------------- *
   * 4. Acoustics
   * ---------------------------------------------------------- */

  // Hemispherical free-field propagation from a point source on the ground:
  //   Lp = Lw − 20·log10(r) − 8
  function soundPressureAt(lw, distanceM) {
    return lw - 20 * Math.log10(Math.max(1, distanceM)) - 8;
  }
  // Logarithmic sum of several sources: L = 10·log10(Σ 10^(Li/10))
  function combineLevels(levels) { return lin2db(sum(levels.map(db2lin))); }

  /* ---------------------------------------------------------- *
   * 5. CSV import / export
   * ---------------------------------------------------------- */

  const REQUIRED_COLUMNS = ["date", "it_kwh", "cooling_kwh", "other_kwh", "water_l"];
  const OPTIONAL_COLUMNS = ["temp_c", "it_util_pct", "noise_dba", "grid_ci", "event"];

  function parseCSV(text) {
    const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length);
    if (lines.length < 2) throw new Error("The file needs a header row and at least one data row.");
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
    if (missing.length) throw new Error("Missing required column(s): " + missing.join(", ") + ". Download the template to see the expected layout.");
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",");
      const r = {};
      header.forEach((h, j) => {
        const raw = (cells[j] || "").trim();
        if (h === "date" || h === "event") r[h] = raw;
        else r[h] = raw === "" ? NaN : Number(raw);
      });
      if (!r.date || !isFinite(r.it_kwh) || r.it_kwh <= 0) continue;
      ["cooling_kwh", "other_kwh", "water_l"].forEach((k) => { if (!isFinite(r[k])) r[k] = 0; });
      rows.push(r);
    }
    if (!rows.length) throw new Error("No valid rows found. Check that it_kwh is a positive number.");
    rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    return rows;
  }

  function toCSV(rows, columns) {
    const cols = columns || Object.keys(rows[0] || {});
    const esc = (v) => (v === undefined || v === null || (typeof v === "number" && !isFinite(v)) ? "" : String(v));
    return [cols.join(",")].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(","))).join("\n");
  }

  /* ---------------------------------------------------------- *
   * 6. Core sustainability indicators
   * ---------------------------------------------------------- */

  /**
   * profile: { gridCI, renewablePct, waterStress, distanceM, noiseLimit,
   *            priceKwh, priceWaterM3, fcThreshold, waterEnergyFactor }
   */
  function computeMetrics(rows, profile) {
    const p = profile;
    const ren = clamp((p.renewablePct || 0) / 100, 0, 1);
    const daily = rows.map((r) => {
      const total = r.it_kwh + r.cooling_kwh + r.other_kwh;
      const ci = isFinite(r.grid_ci) ? r.grid_ci : p.gridCI; // g/kWh
      const co2Loc = (total * ci) / 1000;                    // kg, location-based
      const co2Mkt = co2Loc * (1 - ren);                      // kg, market-based
      return {
        date: r.date,
        month: r.date.slice(0, 7),
        it: r.it_kwh, cooling: r.cooling_kwh, other: r.other_kwh, total,
        water: r.water_l,
        temp: r.temp_c, util: r.it_util_pct, noise: r.noise_dba, ci,
        pue: total / r.it_kwh,
        dcie: (r.it_kwh / total) * 100,
        wue: r.water_l / r.it_kwh,
        clf: r.cooling_kwh / r.it_kwh,
        cer: r.cooling_kwh > 0 ? r.it_kwh / r.cooling_kwh : NaN,
        cueLoc: co2Loc / r.it_kwh,
        cue: co2Mkt / r.it_kwh,
        co2Loc, co2Mkt,
        event: r.event || "",
      };
    });

    const T = {
      it: sum(daily.map((d) => d.it)),
      cooling: sum(daily.map((d) => d.cooling)),
      other: sum(daily.map((d) => d.other)),
      water: sum(daily.map((d) => d.water)),
      co2Loc: sum(daily.map((d) => d.co2Loc)),
      co2Mkt: sum(daily.map((d) => d.co2Mkt)),
    };
    T.total = T.it + T.cooling + T.other;
    const days = daily.length;
    const annualise = 365 / days;

    const hasTemp = daily.every((d) => isFinite(d.temp));
    const hasUtil = daily.every((d) => isFinite(d.util));
    const hasNoise = daily.every((d) => isFinite(d.noise));
    const fcThreshold = p.fcThreshold || 18;

    let freeCoolingDaysPct = NaN, freeCoolingUtilisationPct = NaN;
    if (hasTemp) {
      const cool = daily.filter((d) => d.temp < fcThreshold);
      freeCoolingDaysPct = (cool.length / days) * 100;
      freeCoolingUtilisationPct = cool.length ? (cool.filter((d) => d.clf < 0.15).length / cool.length) * 100 : NaN;
    }

    const noiseValues = hasNoise ? daily.map((d) => d.noise) : [];
    const noiseP95 = hasNoise ? quantile(noiseValues, 0.95) : NaN;
    const waterEnergyFactor = p.waterEnergyFactor != null ? p.waterEnergyFactor : 1.8; // L per kWh at the power plant

    const k = {
      days,
      period: daily.length ? daily[0].date + " → " + daily[days - 1].date : "",
      itMWh: T.it / 1000,
      coolingMWh: T.cooling / 1000,
      otherMWh: T.other / 1000,
      totalMWh: T.total / 1000,
      avgITkW: T.it / (days * 24),
      avgFacilitykW: T.total / (days * 24),
      pue: T.total / T.it,                                     // Green Grid: energy-weighted
      dcie: (T.it / T.total) * 100,
      pueMin: Math.min(...daily.map((d) => d.pue)),
      pueMax: Math.max(...daily.map((d) => d.pue)),
      itUtil: hasUtil ? mean(daily.map((d) => d.util)) : NaN,
      waterM3: T.water / 1000,
      wue: T.water / T.it,                                      // site WUE, L/kWh
      wueSource: (T.water + waterEnergyFactor * T.total) / T.it, // incl. water at the power plant
      waterStressWeightedM3: (T.water / 1000) * (1 + (p.waterStress || 0) / 5),
      clf: T.cooling / T.it,
      cer: T.cooling > 0 ? T.it / T.cooling : NaN,
      coolingShare: (T.cooling / T.total) * 100,
      pPUEcooling: (T.it + T.cooling) / T.it,
      freeCoolingDaysPct, freeCoolingUtilisationPct,
      co2LocT: T.co2Loc / 1000,
      co2MktT: T.co2Mkt / 1000,
      cue: T.co2Mkt / T.it,
      cueLoc: T.co2Loc / T.it,
      avgGridCI: (T.co2Loc * 1000) / T.total,
      renewablePct: ren * 100,
      renewableMWh: (T.total * ren) / 1000,
      noiseMean: hasNoise ? mean(noiseValues) : NaN,
      noiseP95,
      noiseMax: hasNoise ? Math.max(...noiseValues) : NaN,
      noiseLimit: p.noiseLimit,
      noiseMargin: p.noiseLimit - noiseP95,
      noiseExceedDays: hasNoise ? noiseValues.filter((v) => v > p.noiseLimit).length : NaN,
      energyCost: T.total * (p.priceKwh || 0),
      waterCost: (T.water / 1000) * (p.priceWaterM3 || 0),
      carbonCost: (T.co2Mkt / 1000) * CARBON_PRICE_PER_T,
      annualise,
      hasTemp, hasUtil, hasNoise,
    };

    // Monthly aggregation for charts
    const months = {};
    daily.forEach((d) => {
      const m = months[d.month] || (months[d.month] = { month: d.month, it: 0, cooling: 0, other: 0, total: 0, water: 0, co2Loc: 0, co2Mkt: 0, temp: [], noise: [] });
      m.it += d.it; m.cooling += d.cooling; m.other += d.other; m.total += d.total;
      m.water += d.water; m.co2Loc += d.co2Loc; m.co2Mkt += d.co2Mkt;
      if (isFinite(d.temp)) m.temp.push(d.temp);
      if (isFinite(d.noise)) m.noise.push(d.noise);
    });
    const monthly = Object.values(months).map((m) => ({
      month: m.month,
      itMWh: m.it / 1000, coolingMWh: m.cooling / 1000, otherMWh: m.other / 1000,
      pue: m.total / m.it, wue: m.water / m.it, clf: m.cooling / m.it,
      co2LocT: m.co2Loc / 1000, co2MktT: m.co2Mkt / 1000, waterM3: m.water / 1000,
      temp: m.temp.length ? mean(m.temp) : NaN,
      noise: m.noise.length ? mean(m.noise) : NaN,
    }));

    return { daily, monthly, kpis: k, profile: p };
  }

  /* ---------------------------------------------------------- *
   * 7. Dimension scores and the GreenScore
   * ---------------------------------------------------------- */

  function weightedAverage(parts) {
    const valid = parts.filter((x) => isFinite(x.score));
    const w = sum(valid.map((x) => x.weight));
    return w ? sum(valid.map((x) => x.score * x.weight)) / w : NaN;
  }

  function scoreDimensions(metrics) {
    const k = metrics.kpis, p = metrics.profile, B = BENCHMARKS;
    const sub = (name, value, bench, weight, fmt) => ({ name, value, score: linearScore(value, bench.best, bench.worst), weight, best: bench.best, worst: bench.worst, unit: bench.unit, fmt });

    const energyParts = [sub("PUE", k.pue, B.pue, 0.8, 2), sub("IT utilisation", k.itUtil, B.itUtil, 0.2, 1)];
    const waterParts = [sub("WUE (site)", k.wue, B.wue, 1.0, 2)];
    const coolingParts = [sub("Cooling Load Factor", k.clf, B.clf, 0.75, 3), sub("Free-cooling utilisation", k.freeCoolingUtilisationPct, { best: 100, worst: 0, unit: "%" }, 0.25, 1)];
    const carbonParts = [sub("CUE (market-based)", k.cue, B.cue, 1.0, 3)];
    const noiseParts = [sub("Noise margin to limit", k.noiseMargin, B.noiseMargin, 1.0, 1)];
    const locationParts = [
      sub("Grid carbon intensity", p.gridCI, B.gridCI, 1, 0),
      sub("Water stress", p.waterStress, B.waterStress, 1, 1),
      sub("Free-cooling climate", k.freeCoolingDaysPct, B.freeCooling, 1, 1),
      sub("Renewable availability", p.renewablePct, B.renewables, 1, 0),
      sub("Distance to receivers", p.distanceM, B.distance, 1, 0),
    ];
    const dims = {
      energy: energyParts, water: waterParts, cooling: coolingParts,
      carbon: carbonParts, noise: noiseParts, location: locationParts,
    };
    const out = {};
    Object.keys(dims).forEach((key) => { out[key] = { parts: dims[key], score: weightedAverage(dims[key]) }; });
    return out;
  }

  function greenScore(scores, weights) {
    const w = weights || DEFAULT_WEIGHTS;
    const items = DIMENSIONS.map((d) => ({ key: d.key, label: d.label, score: scores[d.key].score, weight: w[d.key] || 0 }));
    const valid = items.filter((i) => isFinite(i.score) && i.weight > 0);
    const wsum = sum(valid.map((i) => i.weight));
    const total = wsum ? sum(valid.map((i) => i.score * i.weight)) / wsum : NaN;
    items.forEach((i) => { i.normWeight = wsum && isFinite(i.score) ? i.weight / wsum : 0; i.contribution = i.normWeight * (isFinite(i.score) ? i.score : 0); });
    return { score: total, items, grade: gradeFor(total) };
  }

  function gradeFor(score) {
    if (!isFinite(score)) return { grade: "–", label: "Not enough data" };
    return GRADES.find((g) => score >= g.min);
  }

  /* ---------------------------------------------------------- *
   * 8. Predictive analytics: ordinary least squares
   * ---------------------------------------------------------- */

  function linearRegression(xs, ys) {
    const pts = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => isFinite(x) && isFinite(y));
    const n = pts.length;
    if (n < 3) return null;
    const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
    let sxy = 0, sxx = 0, syy = 0;
    pts.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
    const slope = sxx ? sxy / sxx : 0;
    const intercept = my - slope * mx;
    const ssRes = sum(pts.map(([x, y]) => (y - (intercept + slope * x)) ** 2));
    const r2 = syy ? 1 - ssRes / syy : 0;
    const rmse = Math.sqrt(ssRes / n);
    return { slope, intercept, r2, rmse, n, predict: (x) => intercept + slope * x };
  }

  /* ---------------------------------------------------------- *
   * 9. Anomaly detection
   * ---------------------------------------------------------- */

  /**
   * values: number[]; opts: { method: "rolling"|"iqr"|"residual", window, threshold, x }
   * Returns per-point { score, flag, expected }.
   */
  function detectAnomalies(values, opts) {
    const o = Object.assign({ method: "rolling", window: 14, threshold: 3, x: null }, opts || {});
    const n = values.length;
    const out = new Array(n);
    if (o.method === "iqr") {
      const clean = values.filter(isFinite);
      const q1 = quantile(clean, 0.25), q3 = quantile(clean, 0.75), iqr = q3 - q1;
      const k = o.threshold / 2; // threshold 3 → 1.5×IQR (Tukey fences)
      const lo = q1 - k * iqr, hi = q3 + k * iqr;
      const med = quantile(clean, 0.5);
      for (let i = 0; i < n; i++) {
        const v = values[i];
        const dist = v > hi ? (v - q3) / (iqr || 1) : v < lo ? (q1 - v) / (iqr || 1) : 0;
        out[i] = { score: dist * 2, flag: isFinite(v) && (v > hi || v < lo), expected: med, lo, hi };
      }
    } else if (o.method === "residual" && o.x) {
      // Remove the weather-driven component first, then z-score the residuals robustly.
      const reg = linearRegression(o.x, values);
      const res = values.map((v, i) => v - reg.predict(o.x[i]));
      const med = quantile(res.filter(isFinite), 0.5);
      const mad = quantile(res.filter(isFinite).map((r) => Math.abs(r - med)), 0.5) * 1.4826 || 1e-9;
      for (let i = 0; i < n; i++) {
        const z = (res[i] - med) / mad;
        out[i] = { score: z, flag: Math.abs(z) > o.threshold, expected: reg.predict(o.x[i]) + med };
      }
    } else {
      // Trailing rolling z-score; the current point is excluded from its own baseline.
      for (let i = 0; i < n; i++) {
        const win = values.slice(Math.max(0, i - o.window), i).filter(isFinite);
        if (win.length < Math.min(7, o.window)) { out[i] = { score: 0, flag: false, expected: values[i] }; continue; }
        const m = mean(win), s = std(win) || 1e-9;
        const z = (values[i] - m) / s;
        out[i] = { score: z, flag: Math.abs(z) > o.threshold, expected: m };
      }
    }
    return out;
  }

  // Precision / recall against injected events (only available for simulated data).
  function evaluateDetection(flags, truth) {
    let tp = 0, fp = 0, fn = 0;
    flags.forEach((f, i) => {
      if (f && truth[i]) tp++;
      else if (f && !truth[i]) fp++;
      else if (!f && truth[i]) fn++;
    });
    const precision = tp + fp ? tp / (tp + fp) : NaN;
    const recall = tp + fn ? tp / (tp + fn) : NaN;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : NaN;
    return { tp, fp, fn, precision, recall, f1 };
  }

  /* ---------------------------------------------------------- *
   * 10. What-if simulator
   * ---------------------------------------------------------- */

  const DEFAULT_LEVERS = {
    setpointDelta: 0,      // °C raise of supply-air temperature (ASHRAE A1 allows up to 27 °C)
    economiserBoost: 0,    // % of remaining cooling removed on economiser-eligible days
    itReduction: 0,        // % IT energy saved by virtualisation / consolidation
    lossReduction: 0,      // % of power-distribution and lighting losses removed (UPS, LED)
    renewablePct: null,    // target renewable share; null keeps the current value
    waterReuse: 0,         // % potable water avoided (closed loop, recycled water)
    noiseMitigation: 0,    // dB(A) reduction from enclosures, low-noise fans, barriers
  };

  function applyScenario(rows, profile, levers) {
    const L = Object.assign({}, DEFAULT_LEVERS, levers || {});
    const fcThreshold = (profile.fcThreshold || 18) + L.setpointDelta;
    const newRows = rows.map((r) => {
      const it = r.it_kwh * (1 - L.itReduction / 100);
      const scale = it / r.it_kwh;              // heat to remove scales with IT energy
      let cooling = r.cooling_kwh * scale;
      // ≈4 % cooling energy saved per °C setpoint increase (rule of thumb 2–5 %).
      cooling *= Math.max(0, 1 - 0.04 * L.setpointDelta);
      if (isFinite(r.temp_c) && r.temp_c < fcThreshold && L.economiserBoost > 0) {
        const floor = it * 0.07;
        cooling = Math.max(floor, cooling - (L.economiserBoost / 100) * Math.max(0, cooling - floor));
      }
      // Moving away from evaporative cooling costs some extra fan/chiller energy.
      cooling *= 1 + 0.15 * (L.waterReuse / 100) * 0.5;
      const other = r.other_kwh * scale * (1 - L.lossReduction / 100);
      const water = r.water_l * scale * Math.max(0, 1 - 0.02 * L.setpointDelta) * (1 - L.waterReuse / 100);
      return Object.assign({}, r, {
        it_kwh: it, cooling_kwh: cooling, other_kwh: other, water_l: water,
        noise_dba: isFinite(r.noise_dba) ? r.noise_dba - L.noiseMitigation : r.noise_dba,
      });
    });
    const newProfile = Object.assign({}, profile, {
      renewablePct: L.renewablePct == null ? profile.renewablePct : L.renewablePct,
      fcThreshold,
    });
    return { rows: newRows, profile: newProfile };
  }

  function compareScenario(rows, profile, levers, weights) {
    const base = analyse(rows, profile, weights);
    const sc = applyScenario(rows, profile, levers);
    const scen = analyse(sc.rows, sc.profile, weights);
    const a = base.metrics.kpis.annualise;
    const kb = base.metrics.kpis, ks = scen.metrics.kpis;
    const delta = {
      energyMWh: (kb.totalMWh - ks.totalMWh) * a,
      waterM3: (kb.waterM3 - ks.waterM3) * a,
      co2T: (kb.co2MktT - ks.co2MktT) * a,
      energyCost: (kb.energyCost - ks.energyCost) * a,
      waterCost: (kb.waterCost - ks.waterCost) * a,
      carbonCost: (kb.carbonCost - ks.carbonCost) * a,
      greenScore: scen.green.score - base.green.score,
    };
    delta.totalCost = delta.energyCost + delta.waterCost + delta.carbonCost;
    return { base, scen, delta };
  }

  /* ---------------------------------------------------------- *
   * 11. Recommendations (each one is quantified by the simulator)
   * ---------------------------------------------------------- */

  function recommendations(rows, profile, weights) {
    const base = analyse(rows, profile, weights);
    const k = base.metrics.kpis;
    const recs = [];
    const add = (dim, title, why, levers, effort) => {
      const c = compareScenario(rows, profile, levers, weights);
      recs.push({ dimension: dim, title, why, levers, effort, delta: c.delta });
    };
    if (k.pue > 1.25) add("cooling", "Raise the supply-air setpoint by 2 °C", `Annual PUE is ${k.pue.toFixed(2)}. ASHRAE A1 allows supply air up to 27 °C; each degree typically cuts cooling energy by 2–5 %.`, { setpointDelta: 2 }, "Low");
    if (k.hasTemp && k.freeCoolingDaysPct > 10 && (k.freeCoolingUtilisationPct < 70 || !isFinite(k.freeCoolingUtilisationPct)))
      add("cooling", "Use the economiser on more cool days", `${k.freeCoolingDaysPct.toFixed(0)} % of days are below the economiser threshold, but only ${isFinite(k.freeCoolingUtilisationPct) ? k.freeCoolingUtilisationPct.toFixed(0) : "0"} % of them run with near-zero mechanical cooling.`, { economiserBoost: 60 }, "Medium");
    if (!k.hasUtil || k.itUtil < 70) add("energy", "Consolidate and virtualise under-used servers", `Average IT utilisation is ${isFinite(k.itUtil) ? k.itUtil.toFixed(0) + " %" : "unknown"}. Idle servers still draw about half of peak power.`, { itReduction: 10 }, "Medium");
    if (k.otherMWh / k.itMWh > 0.05) add("energy", "Upgrade UPS to eco-mode and lighting to LED with sensors", `Distribution and lighting losses are ${((k.otherMWh / k.itMWh) * 100).toFixed(1)} % of IT energy.`, { lossReduction: 40 }, "Medium");
    if (k.renewablePct < 80) add("carbon", `Raise renewable supply to ${Math.min(100, Math.round(k.renewablePct + 40))} %`, `Market-based CUE is ${k.cue.toFixed(3)} kgCO₂e/kWh on a grid averaging ${k.avgGridCI.toFixed(0)} g/kWh. A PPA or on-site solar cuts Scope 2 emissions directly.`, { renewablePct: Math.min(100, Math.round(k.renewablePct + 40)) }, "High");
    if (k.wue > 0.5) add("water", "Switch to closed-loop or recycled water for cooling", `Site WUE is ${k.wue.toFixed(2)} L/kWh${profile.waterStress >= 3 ? " in a high water-stress region" : ""}. Reusing grey or treated water avoids potable consumption.`, { waterReuse: 50 }, profile.waterStress >= 3 ? "Medium" : "High");
    if (k.hasNoise && k.noiseMargin < 5) add("noise", "Fit acoustic enclosures and low-noise fans", `The 95th-percentile level at the nearest receiver is ${k.noiseP95.toFixed(1)} dB(A) against a ${profile.noiseLimit} dB(A) limit (${k.noiseExceedDays} days above it).`, { noiseMitigation: 8 }, "Medium");
    if (profile.gridCI > 500 || profile.waterStress > 4) recs.push({ dimension: "location", title: "Consider siting for future capacity", why: `The grid averages ${profile.gridCI} gCO₂e/kWh and water stress is ${profile.waterStress}/5. Future expansion in a cooler, low-carbon region would raise the location score.`, levers: null, effort: "Strategic", delta: null });
    recs.sort((a, b) => (b.delta ? b.delta.greenScore : -1) - (a.delta ? a.delta.greenScore : -1));
    return recs;
  }

  /* ---------------------------------------------------------- *
   * 12. One-call analysis pipeline
   * ---------------------------------------------------------- */

  function analyse(rows, profile, weights) {
    const metrics = computeMetrics(rows, profile);
    const scores = scoreDimensions(metrics);
    const green = greenScore(scores, weights);
    return { metrics, scores, green };
  }

  function profileFromLocation(key, coolingSystem) {
    const loc = LOCATIONS[key] || LOCATIONS.virginia;
    const cs = COOLING_SYSTEMS[coolingSystem] || COOLING_SYSTEMS.evaporative;
    return {
      locationKey: key, name: loc.name, gridCI: loc.gridCI, renewablePct: loc.renewablePct,
      waterStress: loc.waterStress, distanceM: loc.distanceM, noiseLimit: loc.noiseLimit,
      priceKwh: loc.priceKwh, priceWaterM3: loc.priceWaterM3,
      fcThreshold: 18 + cs.fcOffset, waterEnergyFactor: 1.8,
    };
  }

  return {
    DIMENSIONS, DEFAULT_WEIGHTS, BENCHMARKS, GRADES, LOCATIONS, COOLING_SYSTEMS, DEFAULT_LEVERS,
    CARBON_PRICE_PER_T, REQUIRED_COLUMNS, OPTIONAL_COLUMNS,
    generateDataset, parseCSV, toCSV, computeMetrics, scoreDimensions, greenScore, gradeFor,
    linearRegression, detectAnomalies, evaluateDetection, applyScenario, compareScenario,
    recommendations, analyse, profileFromLocation, soundPressureAt, combineLevels,
    linearScore, quantile, mean, std, freeCoolingFraction, chillerCOP,
  };
});
