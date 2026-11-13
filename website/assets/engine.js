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
    waterStress:{ best: 0,    worst: 5,    unit: "/ 5",     note: "WRI Aqueduct baseline water stress scale" },
    freeCooling:{ best: 100,  worst: 0,    unit: "% days",  note: "Share of days below the economiser threshold" },
    renewables: { best: 100,  worst: 0,    unit: "%",       note: "Renewable share of the regional grid" },
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

  // Regional presets.
  //   gridCI and gridRenewablePct: national 2024 values, Our World in Data energy
  //     dataset (Ember and Energy Institute), rounded. US presets use the US national value.
  //   waterStress: indicative, based on WRI Aqueduct 4.0 categories; verify per site.
  //   renewablePct (contracted), prices, distance, noise limit, climate: indicative
  //     assumptions for demonstration.
  //   gridCI           average grid emission factor, gCO2e/kWh
  //   renewablePct     renewable electricity the FACILITY contracts (PPA, green tariff, on-site)
  //   gridRenewablePct renewable share of the REGIONAL grid (used only in the location score)
  //   waterStress      WRI Aqueduct baseline water stress, 0-5
  const LOCATIONS = {
    stockholm: { name: "Stockholm, Sweden",     tempMean: 7.5,  tempAmp: 9.5, hemisphere: "N", gridCI: 35,  renewablePct: 70, gridRenewablePct: 69, waterStress: 0.6, distanceM: 600, noiseLimit: 45, priceKwh: 0.09, priceWaterM3: 2.6 },
    dublin:    { name: "Dublin, Ireland",       tempMean: 10.0, tempAmp: 5.0, hemisphere: "N", gridCI: 271, renewablePct: 40, gridRenewablePct: 47, waterStress: 1.2, distanceM: 350, noiseLimit: 45, priceKwh: 0.22, priceWaterM3: 2.2 },
    virginia:  { name: "Ashburn, Virginia, US", tempMean: 13.5, tempAmp: 11.5, hemisphere: "N", gridCI: 384, renewablePct: 25, gridRenewablePct: 24, waterStress: 2.1, distanceM: 250, noiseLimit: 50, priceKwh: 0.08, priceWaterM3: 1.6 },
    phoenix:   { name: "Phoenix, Arizona, US",  tempMean: 24.0, tempAmp: 10.0, hemisphere: "N", gridCI: 384, renewablePct: 20, gridRenewablePct: 24, waterStress: 4.6, distanceM: 400, noiseLimit: 50, priceKwh: 0.10, priceWaterM3: 1.9 },
    singapore: { name: "Singapore",             tempMean: 27.8, tempAmp: 1.0, hemisphere: "N", gridCI: 499, renewablePct: 5, gridRenewablePct: 5,  waterStress: 2.8, distanceM: 150, noiseLimit: 55, priceKwh: 0.21, priceWaterM3: 2.0 },
    karachi:   { name: "Karachi, Pakistan",     tempMean: 26.5, tempAmp: 5.5, hemisphere: "N", gridCI: 374, renewablePct: 15, gridRenewablePct: 37, waterStress: 4.4, distanceM: 120, noiseLimit: 55, priceKwh: 0.14, priceWaterM3: 0.6 },
    mumbai:    { name: "Mumbai, India",         tempMean: 27.5, tempAmp: 2.5, hemisphere: "N", gridCI: 705, renewablePct: 12, gridRenewablePct: 20, waterStress: 3.9, distanceM: 120, noiseLimit: 55, priceKwh: 0.11, priceWaterM3: 0.5 },
    sydney:    { name: "Sydney, Australia",     tempMean: 18.5, tempAmp: 5.0, hemisphere: "S", gridCI: 554, renewablePct: 30, gridRenewablePct: 35, waterStress: 2.5, distanceM: 300, noiseLimit: 50, priceKwh: 0.18, priceWaterM3: 2.4 },
  };

  const REGIONAL_SOURCES = {
    gridCI: { label: "Grid carbon intensity", source: "Our World in Data energy dataset (Ember; Energy Institute), 2024, national", status: "cited" },
    gridRenewablePct: { label: "Grid renewable share", source: "Our World in Data energy dataset (Ember; Energy Institute), 2024, national, excludes nuclear", status: "cited" },
    waterStress: { label: "Baseline water stress", source: "Indicative, consistent with WRI Aqueduct 4.0 categories; check the Aqueduct country and basin values for a real site", status: "indicative" },
    climate: { label: "Temperature profile", source: "Indicative annual mean and seasonal amplitude", status: "indicative" },
    renewablePct: { label: "Contracted renewables", source: "Facility assumption", status: "assumption" },
    prices: { label: "Electricity and water prices", source: "Indicative commercial tariffs", status: "indicative" },
    distanceM: { label: "Distance to receivers, noise limit", source: "Facility assumption; limits indicative of night-time planning limits", status: "assumption" },
  };

  /* Published fleet-level figures used as real-data case studies.
   * Values are as reported by each company for the year shown. Where a
   * figure is derived by GreenDC, `derived` says how. Unknown values are
   * null and that dimension is excluded (coverage is reported). */
  const PUBLIC_CASES = [
    {
      id: "industry", name: "Industry average (reference)", year: "2024", pue: 1.56, wue: 1.8, gridCI: 471, renewablePct: 0,
      notes: "PUE: Uptime Institute Global Data Center Survey 2024. WUE: Shehabi et al. (2016), LBNL US data center report. Grid: world average 2024, Our World in Data (Ember). No renewable contracts assumed.",
      derived: "CUE = PUE × grid intensity",
    },
    {
      id: "google", name: "Google data centre fleet", year: "2023", pue: 1.10, wue: null, energyTWh: 24.0, waterBillionGal: 6.1, gridCI: 393, renewablePct: 64,
      notes: "Google 2024 Environmental Report (2023 data): fleet TTM PUE 1.10, data centre electricity >24 TWh, data centre water consumption 6.1 billion gallons, 64 % hourly carbon-free energy (CFE). Grid: US average 2023, Our World in Data (Ember).",
      derived: "WUE = 6.1 bn gal × 3.785 L ÷ (24 TWh ÷ 1.10). CFE % used in place of contracted renewables. Grid intensity assumed US average because most of the fleet is in the US.",
    },
    {
      id: "meta", name: "Meta data centre fleet", year: "2023", pue: 1.09, wue: 0.20, gridCI: 393, renewablePct: 100,
      notes: "Meta 2024 Sustainability Report (2023 data): average PUE 1.09, WUE 0.20 L/kWh, operations supported by 100 % renewable energy. Grid: US average 2023, Our World in Data (Ember).",
      derived: "Market-based CUE is zero because all electricity is matched with renewables.",
    },
    {
      id: "microsoft", name: "Microsoft datacenter fleet", year: "FY2024", pue: 1.12, pueIsDesign: true, wue: 0.30, gridCI: null, renewablePct: null,
      notes: "Microsoft: average WUE 0.30 L/kWh (water withdrawal basis); newest-generation design PUE 1.12 (no fleet operating PUE found). No comparable renewable share used.",
      derived: "PUE is a design value, so its energy score is indicative only. Carbon is excluded.",
    },
  ];

  // Cooling architectures used by the simulator.
  const COOLING_SYSTEMS = {
    evaporative: { name: "Chillers + evaporative cooling towers", copFactor: 1.15, waterBase: 0.40, waterSlope: 0.075, fcOffset: 0,  lwUnit: 94 },
    aircooled:   { name: "Air-cooled chillers + dry coolers",      copFactor: 0.90, waterBase: 0.04, waterSlope: 0.004, fcOffset: 0,  lwUnit: 97 },
    liquid:      { name: "Direct-to-chip liquid cooling",          copFactor: 1.60, waterBase: 0.25, waterSlope: 0.030, fcOffset: 8,  lwUnit: 90 },
  };

  const CARBON_PRICE_PER_T = 85; // default USD per tonne CO2e (editable per facility), used to value carbon

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
    const waterEnergyFactor = p.waterEnergyFactor != null ? p.waterEnergyFactor : ASSUMPTIONS.waterEnergyFactor; // L per kWh at the power plant

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
      plf: T.other / T.it,                                      // Power Load Factor (Green Grid)
      erf: ren,                                                 // Renewable Energy Factor (ISO/IEC 30134-3)
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
      carbonPrice: p.carbonPrice != null ? p.carbonPrice : CARBON_PRICE_PER_T,
      carbonCost: (T.co2Mkt / 1000) * (p.carbonPrice != null ? p.carbonPrice : CARBON_PRICE_PER_T),
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

  function scoreDimensions(metrics, benchmarks) {
    const k = metrics.kpis, p = metrics.profile, B = benchmarks || BENCHMARKS;
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
      sub("Grid renewable share", p.gridRenewablePct != null ? p.gridRenewablePct : p.renewablePct, B.renewables, 1, 0),
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

  // Simulator coefficients. These are modelling assumptions, not measured values;
  // they are listed on the Methodology page and can be changed here.
  const ASSUMPTIONS = {
    coolingSavingPerDegC: 0.04,   // fraction of cooling energy saved per °C setpoint rise
    waterSavingPerDegC: 0.02,     // fraction of water saved per °C setpoint rise
    economiserFloorCLF: 0.07,     // fan/pump energy that remains when the economiser carries the load
    waterReusePenalty: 0.075,     // extra cooling energy at 100 % water reuse (less evaporative cooling)
    waterEnergyFactor: 1.8,       // L of water consumed per kWh generated (EWIF, US average)
    carTonnesPerYear: 4.6,        // tCO2e emitted by a typical passenger car per year (US EPA)
  };

  const DEFAULT_LEVERS = {
    setpointDelta: 0,      // °C raise of supply-air temperature (ASHRAE recommended inlet range 18-27 °C)
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
      cooling *= Math.max(0, 1 - ASSUMPTIONS.coolingSavingPerDegC * L.setpointDelta);
      if (isFinite(r.temp_c) && r.temp_c < fcThreshold && L.economiserBoost > 0) {
        const floor = it * ASSUMPTIONS.economiserFloorCLF;
        cooling = Math.max(floor, cooling - (L.economiserBoost / 100) * Math.max(0, cooling - floor));
      }
      // Moving away from evaporative cooling costs some extra fan/chiller energy.
      cooling *= 1 + ASSUMPTIONS.waterReusePenalty * (L.waterReuse / 100);
      const other = r.other_kwh * scale * (1 - L.lossReduction / 100);
      const water = r.water_l * scale * Math.max(0, 1 - ASSUMPTIONS.waterSavingPerDegC * L.setpointDelta) * (1 - L.waterReuse / 100);
      return Object.assign({}, r, {
        it_kwh: it, cooling_kwh: cooling, other_kwh: other, water_l: water,
        noise_dba: isFinite(r.noise_dba) ? r.noise_dba - L.noiseMitigation : r.noise_dba,
        // Consolidation runs the same work on fewer servers, so utilisation rises: u' = u ÷ (1 − r)
        it_util_pct: isFinite(r.it_util_pct) ? Math.min(100, r.it_util_pct / (1 - L.itReduction / 100)) : r.it_util_pct,
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
    if (k.pue > 1.25) add("cooling", "Raise the supply-air setpoint by 2 °C", `Annual PUE is ${k.pue.toFixed(2)}. The ASHRAE recommended inlet range is 18–27 °C, so many halls can run warmer. The simulator assumes 4 % less cooling energy per °C.`, { setpointDelta: 2 }, "Low");
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
      locationKey: key, name: loc.name, gridCI: loc.gridCI, renewablePct: loc.renewablePct, gridRenewablePct: loc.gridRenewablePct,
      carbonPrice: CARBON_PRICE_PER_T,
      waterStress: loc.waterStress, distanceM: loc.distanceM, noiseLimit: loc.noiseLimit,
      priceKwh: loc.priceKwh, priceWaterM3: loc.priceWaterM3,
      fcThreshold: 18 + cs.fcOffset, waterEnergyFactor: 1.8,
    };
  }

  /* ---------------------------------------------------------- *
   * 13. Annual (published) data mode
   * ---------------------------------------------------------- */

  const NAN = NaN;
  function analyseAnnual(c, weights) {
    const pue = c.pue != null ? c.pue : NAN;
    let wue = c.wue != null ? c.wue : NAN;
    if (!isFinite(wue) && c.energyTWh && c.waterBillionGal && isFinite(pue)) {
      wue = (c.waterBillionGal * 1e9 * 3.78541) / ((c.energyTWh * 1e9) / pue);
    }
    const ren = c.renewablePct != null ? c.renewablePct / 100 : NAN;
    const cue = isFinite(pue) && c.gridCI != null && isFinite(ren) ? pue * (c.gridCI / 1000) * (1 - ren) : NAN;
    const kpis = {
      pue, wue, cue, itUtil: NAN, clf: NAN, freeCoolingUtilisationPct: NAN, freeCoolingDaysPct: NAN, noiseMargin: NAN,
      dcie: isFinite(pue) ? 100 / pue : NAN,
    };
    const profile = { gridCI: NAN, waterStress: NAN, renewablePct: NAN, gridRenewablePct: NAN, distanceM: NAN };
    const scores = scoreDimensions({ kpis, profile });
    const green = greenScore(scores, weights);
    const w = weights || DEFAULT_WEIGHTS, wsum = DIMENSIONS.reduce((s, d) => s + w[d.key], 0);
    const coverage = DIMENSIONS.filter((d) => isFinite(scores[d.key].score)).reduce((s, d) => s + w[d.key], 0) / wsum;
    return { kpis, scores, green, coverage };
  }

  /* ---------------------------------------------------------- *
   * 14. Sensitivity analysis
   * ---------------------------------------------------------- */

  function gammaSample(alpha, rand) {
    // Marsaglia & Tsang (2000); boost alpha < 1
    if (alpha < 1) return gammaSample(alpha + 1, rand) * Math.pow(rand(), 1 / alpha);
    const d = alpha - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = gaussian(rand); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = rand();
      if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  function dirichlet(alphas, rand) {
    const g = alphas.map((a) => gammaSample(a, rand));
    const t = sum(g);
    return g.map((x) => x / t);
  }
  function scoreVector(scores) { return DIMENSIONS.map((d) => scores[d.key].score); }
  function gsFromVector(vec, wvec) {
    let s = 0, w = 0;
    vec.forEach((v, i) => { if (isFinite(v)) { s += v * wvec[i]; w += wvec[i]; } });
    return w ? s / w : NaN;
  }
  // One-at-a-time: each weight from 0 to 2x its default while the others keep theirs.
  function weightOAT(scores, weights) {
    const w = weights || DEFAULT_WEIGHTS, base = DIMENSIONS.map((d) => w[d.key]), vec = scoreVector(scores);
    const baseGS = gsFromVector(vec, base);
    return DIMENSIONS.map((d, i) => {
      const lo = base.slice(); lo[i] = 0;
      const hi = base.slice(); hi[i] = base[i] * 2;
      return { key: d.key, label: d.label, low: gsFromVector(vec, lo), high: gsFromVector(vec, hi), base: baseGS };
    });
  }
  function ranks(values) {
    const order = values.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const r = new Array(values.length);
    order.forEach(([, i], k) => { r[i] = k + 1; });
    return r;
  }
  function spearman(r1, r2) {
    const n = r1.length;
    const d2 = r1.reduce((s, r, i) => s + (r - r2[i]) ** 2, 0);
    return 1 - (6 * d2) / (n * (n * n - 1));
  }
  /**
   * Monte Carlo over weights. items: [{ name, scores }].
   * mode "default": Dirichlet centred on the default weights (concentration kappa);
   * mode "uniform": every weighting equally likely.
   */
  function monteCarloWeights(items, opts) {
    const o = Object.assign({ draws: 2000, seed: 7, mode: "default", kappa: 30, weights: DEFAULT_WEIGHTS }, opts || {});
    const rand = mulberry32(o.seed);
    const base = DIMENSIONS.map((d) => o.weights[d.key]);
    const bsum = sum(base);
    const alphas = o.mode === "uniform" ? base.map(() => 1) : base.map((b) => Math.max(0.05, (b / bsum) * o.kappa));
    const vecs = items.map((it) => scoreVector(it.scores));
    const baseGS = vecs.map((v) => gsFromVector(v, base));
    const baseRank = ranks(baseGS);
    const baseGrade = baseGS.map((g) => gradeFor(g).grade);
    const samples = items.map(() => []);
    const rankCount = items.map(() => new Array(items.length).fill(0));
    let rhoSum = 0, sameOrder = 0;
    const gradeSame = items.map(() => 0);
    for (let k = 0; k < o.draws; k++) {
      const w = dirichlet(alphas, rand);
      const gs = vecs.map((v) => gsFromVector(v, w));
      const r = ranks(gs);
      gs.forEach((g, i) => { samples[i].push(g); rankCount[i][r[i] - 1]++; if (gradeFor(g).grade === baseGrade[i]) gradeSame[i]++; });
      const rho = spearman(r, baseRank);
      rhoSum += rho;
      if (rho === 1) sameOrder++;
    }
    return {
      mode: o.mode, draws: o.draws, alphas,
      items: items.map((it, i) => ({
        name: it.name, base: baseGS[i], baseRank: baseRank[i], baseGrade: baseGrade[i],
        mean: mean(samples[i]), p5: quantile(samples[i], 0.05), p95: quantile(samples[i], 0.95),
        min: Math.min(...samples[i]), max: Math.max(...samples[i]),
        keepRank: rankCount[i][baseRank[i] - 1] / o.draws,
        keepGrade: gradeSame[i] / o.draws,
        rankDist: rankCount[i].map((c) => c / o.draws),
      })),
      meanSpearman: rhoSum / o.draws,
      sameOrder: sameOrder / o.draws,
    };
  }
  // Benchmark anchors: shift every best/worst anchor by up to ±pct of its span.
  function anchorSensitivity(metrics, weights, opts) {
    const o = Object.assign({ draws: 1000, pct: 10, seed: 11 }, opts || {});
    const rand = mulberry32(o.seed);
    const out = [];
    for (let k = 0; k < o.draws; k++) {
      const B = {};
      Object.entries(BENCHMARKS).forEach(([key, b]) => {
        const span = b.best - b.worst, j = (o.pct / 100) * span;
        B[key] = Object.assign({}, b, { best: b.best + (rand() * 2 - 1) * j, worst: b.worst + (rand() * 2 - 1) * j });
      });
      out.push(greenScore(scoreDimensions(metrics, B), weights).score);
    }
    return { pct: o.pct, draws: o.draws, mean: mean(out), p5: quantile(out, 0.05), p95: quantile(out, 0.95), min: Math.min(...out), max: Math.max(...out) };
  }

  /* ---------------------------------------------------------- *
   * 15. Detection benchmark
   * ---------------------------------------------------------- */

  const ANOMALY_TARGETS = {
    pue:   { label: "PUE", get: (d) => d.pue, digits: 3, events: ["cooling_fault", "ups_fault"] },
    clf:   { label: "Cooling Load Factor", get: (d) => d.clf, digits: 3, events: ["cooling_fault"] },
    wue:   { label: "WUE (L/kWh)", get: (d) => d.wue, digits: 3, events: ["water_leak"] },
    noise: { label: "Boundary noise (dB(A))", get: (d) => d.noise, digits: 1, events: ["noise_spike"] },
    it:    { label: "IT energy (kWh)", get: (d) => d.it, digits: 0, events: ["it_surge"] },
    other: { label: "Distribution losses (kWh)", get: (d) => d.other, digits: 0, events: ["ups_fault"] },
  };
  const DETECTION_METHODS = { residual: "Weather-adjusted residual", rolling: "Rolling z-score", iqr: "IQR fences" };

  function benchmarkDetection(opts) {
    const o = Object.assign({ seeds: [1, 2, 3, 4, 5], locations: Object.keys(LOCATIONS), coolingSystem: "evaporative", threshold: 3.5, window: 14 }, opts || {});
    const acc = {};
    Object.keys(ANOMALY_TARGETS).forEach((m) => { acc[m] = {}; Object.keys(DETECTION_METHODS).forEach((k) => { acc[m][k] = { tp: 0, fp: 0, fn: 0 }; }); });
    let datasets = 0;
    o.locations.forEach((loc) => o.seeds.forEach((seed) => {
      const rows = generateDataset({ location: loc, coolingSystem: o.coolingSystem, seed, injectAnomalies: true });
      const d = computeMetrics(rows, profileFromLocation(loc, o.coolingSystem)).daily;
      const temps = d.map((x) => x.temp);
      datasets++;
      Object.entries(ANOMALY_TARGETS).forEach(([m, t]) => {
        const vals = d.map(t.get), truth = d.map((x) => t.events.includes(x.event));
        Object.keys(DETECTION_METHODS).forEach((method) => {
          const f = detectAnomalies(vals, { method, threshold: o.threshold, window: o.window, x: temps }).map((x) => x.flag);
          const e = evaluateDetection(f, truth);
          acc[m][method].tp += e.tp; acc[m][method].fp += e.fp; acc[m][method].fn += e.fn;
        });
      });
    }));
    const fin = (a) => { const p = a.tp + a.fp ? a.tp / (a.tp + a.fp) : NaN, r = a.tp + a.fn ? a.tp / (a.tp + a.fn) : NaN; return Object.assign({}, a, { precision: p, recall: r, f1: p + r ? (2 * p * r) / (p + r) : NaN }); };
    const table = {};
    Object.keys(acc).forEach((m) => { table[m] = {}; Object.keys(acc[m]).forEach((k) => { table[m][k] = fin(acc[m][k]); }); });
    return { datasets, days: datasets * 365, threshold: o.threshold, table };
  }

  // Precision/recall as the threshold changes, pooled over several datasets.
  function detectionSweep(metric, method, opts) {
    const o = Object.assign({ seeds: [1, 2, 3], locations: ["virginia", "karachi", "stockholm"], thresholds: [1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8] }, opts || {});
    const t = ANOMALY_TARGETS[metric];
    const sets = [];
    o.locations.forEach((loc) => o.seeds.forEach((seed) => {
      const d = computeMetrics(generateDataset({ location: loc, seed }), profileFromLocation(loc, "evaporative")).daily;
      sets.push({ vals: d.map(t.get), truth: d.map((x) => t.events.includes(x.event)), temps: d.map((x) => x.temp) });
    }));
    return o.thresholds.map((th) => {
      let tp = 0, fp = 0, fn = 0;
      sets.forEach((s) => { const e = evaluateDetection(detectAnomalies(s.vals, { method, threshold: th, x: s.temps }).map((x) => x.flag), s.truth); tp += e.tp; fp += e.fp; fn += e.fn; });
      const p = tp + fp ? tp / (tp + fp) : NaN, r = tp + fn ? tp / (tp + fn) : 0;
      return { threshold: th, precision: p, recall: r, f1: p + r ? (2 * p * r) / (p + r) : NaN };
    });
  }

  /* ---------------------------------------------------------- *
   * 16. Usability: System Usability Scale (Brooke, 1996)
   * ---------------------------------------------------------- */

  const SUS_ITEMS = [
    "I think that I would like to use this system frequently.",
    "I found the system unnecessarily complex.",
    "I thought the system was easy to use.",
    "I think that I would need the support of a technical person to be able to use this system.",
    "I found the various functions in this system were well integrated.",
    "I thought there was too much inconsistency in this system.",
    "I would imagine that most people would learn to use this system very quickly.",
    "I found the system very cumbersome to use.",
    "I felt very confident using the system.",
    "I needed to learn a lot of things before I could get going with this system.",
  ];
  // Odd items: answer − 1. Even items: 5 − answer. Sum × 2.5 gives 0–100.
  function susScore(answers) {
    if (!answers || answers.length !== 10 || answers.some((a) => !(a >= 1 && a <= 5))) return NaN;
    return answers.reduce((s, a, i) => s + (i % 2 === 0 ? a - 1 : 5 - a), 0) * 2.5;
  }
  // Adjective scale after Bangor, Kortum & Miller (2009).
  function susAdjective(score) {
    if (!isFinite(score)) return "–";
    if (score >= 85.5) return "Excellent";
    if (score >= 72.6) return "Good";
    if (score >= 52) return "OK";
    if (score >= 39.2) return "Poor";
    return "Awful";
  }

  /* ---------------------------------------------------------- *
   * 17. Verification: hand-calculated reference cases
   * ---------------------------------------------------------- *
   * Each case states inputs whose answer was worked out by hand. The
   * website shows these live on the Methodology page; tests/ runs them
   * in Node and Python.
   */
  function selfTest() {
    const tol = (a, b, t) => Math.abs(a - b) <= (t || 1e-6) * Math.max(1, Math.abs(b));
    const rows = [
      { date: "2025-01-01", it_kwh: 1000, cooling_kwh: 300, other_kwh: 100, water_l: 1500, grid_ci: 400, temp_c: 10, it_util_pct: 50, noise_dba: 40 },
      { date: "2025-01-02", it_kwh: 1000, cooling_kwh: 200, other_kwh: 100, water_l: 500, grid_ci: 500, temp_c: 20, it_util_pct: 70, noise_dba: 44 },
    ];
    const prof = { gridCI: 450, renewablePct: 25, gridRenewablePct: 25, waterStress: 2.5, distanceM: 525, noiseLimit: 50, priceKwh: 0.1, priceWaterM3: 2, fcThreshold: 18, waterEnergyFactor: 1.8, carbonPrice: 100 };
    const k = computeMetrics(rows, prof).kpis;
    const reg = linearRegression([0, 1, 2, 3, 4], [2, 5, 8, 11, 14]);
    const robust = detectAnomalies([1, 2, 3, 4, 100], { method: "residual", threshold: 3.5, x: [0, 0, 0, 0, 0] });
    const gs = greenScore({ energy: { score: 100 }, water: { score: 0 }, cooling: { score: 50 }, carbon: { score: 50 }, noise: { score: 50 }, location: { score: 50 } }, DEFAULT_WEIGHTS);
    const cases = [
      ["PUE", "(2000 + 500 + 200) ÷ 2000", k.pue, 1.35],
      ["DCiE", "2000 ÷ 2700 × 100", k.dcie, 74.0740741],
      ["PUE = 1 + CLF + PLF", "1 + 0.25 + 0.10", 1 + k.clf + k.plf, 1.35],
      ["WUE (site)", "2000 L ÷ 2000 kWh", k.wue, 1.0],
      ["WUE (source)", "(2000 + 1.8 × 2700) ÷ 2000", k.wueSource, 3.43],
      ["Cooling Efficiency Ratio", "2000 ÷ 500", k.cer, 4.0],
      ["Location-based CO₂ (t)", "(1400 × 400 + 1300 × 500) ÷ 10⁶", k.co2LocT, 1.21],
      ["Market-based CO₂ (t)", "1.21 × (1 − 0.25)", k.co2MktT, 0.9075],
      ["CUE", "907.5 kg ÷ 2000 kWh", k.cue, 0.45375],
      ["Energy-weighted grid CI", "1 210 000 g ÷ 2700 kWh", k.avgGridCI, 448.148148],
      ["Carbon cost", "0.9075 t × $100", k.carbonCost, 90.75],
      ["Free-cooling days", "1 of 2 days below 18 °C", k.freeCoolingDaysPct, 50],
      ["Linear score", "100 × (1.55 − 2.00) ÷ (1.10 − 2.00)", linearScore(1.55, 1.1, 2.0), 50],
      ["Linear score is clamped", "PUE 2.4 is worse than the worst anchor", linearScore(2.4, 1.1, 2.0), 0],
      ["Sound pressure at 100 m", "100 − 20·log₁₀(100) − 8", soundPressureAt(100, 100), 52],
      ["Two equal sources", "10·log₁₀(2 × 10⁹)", combineLevels([90, 90]), 93.0103],
      ["95th percentile", "P95 of 1…21", quantile(Array.from({ length: 21 }, (_, i) => i + 1), 0.95), 20],
      ["OLS slope", "y = 2 + 3x", reg.slope, 3],
      ["OLS intercept", "y = 2 + 3x", reg.intercept, 2],
      ["OLS R²", "perfect line", reg.r2, 1],
      ["Robust z (MAD)", "(100 − 3) ÷ (1.4826 × 1)", robust[4].score, 97 / 1.4826],
      ["GreenScore", "(25×100 + 15×0 + 60×50) ÷ 100", gs.score, 55],
      ["SUS, neutral answers", "all answers 3 → 10 × 2 × 2.5", susScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), 50],
      ["SUS, best answers", "odd 5, even 1 → 10 × 4 × 2.5", susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]), 100],
      ["Spearman ρ, reversed ranks", "1 − 6·Σd² ÷ (n(n²−1)), n = 4", spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1],
      ["Derived WUE (Google 2023)", "6.1e9 × 3.78541 ÷ (24e9 ÷ 1.10)", analyseAnnual(PUBLIC_CASES[1]).kpis.wue, (6.1e9 * 3.78541) / (24e9 / 1.1)],
    ];
    return cases.map(([name, working, actual, expected]) => ({ name, working, actual, expected, pass: tol(actual, expected, 1e-4) }));
  }

  return {
    ASSUMPTIONS, selfTest, REGIONAL_SOURCES, PUBLIC_CASES, analyseAnnual,
    weightOAT, monteCarloWeights, anchorSensitivity, spearman, ranks, dirichlet,
    ANOMALY_TARGETS, DETECTION_METHODS, benchmarkDetection, detectionSweep,
    SUS_ITEMS, susScore, susAdjective,
    DIMENSIONS, DEFAULT_WEIGHTS, BENCHMARKS, GRADES, LOCATIONS, COOLING_SYSTEMS, DEFAULT_LEVERS,
    CARBON_PRICE_PER_T, REQUIRED_COLUMNS, OPTIONAL_COLUMNS,
    generateDataset, parseCSV, toCSV, computeMetrics, scoreDimensions, greenScore, gradeFor,
    linearRegression, detectAnomalies, evaluateDetection, applyScenario, compareScenario,
    recommendations, analyse, profileFromLocation, soundPressureAt, combineLevels,
    linearScore, quantile, mean, std, freeCoolingFraction, chillerCOP,
  };
});
