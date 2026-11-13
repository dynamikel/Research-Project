// Regenerates the sample dataset and the importable scenario project files.
// Run with: node scripts/make_scenarios.js
const fs = require("fs");
const path = require("path");
const G = require("../website/assets/engine.js");
const out = path.join(__dirname, "..", "data");
fs.mkdirSync(path.join(out, "scenarios"), { recursive: true });

const sample = G.generateDataset({});
fs.writeFileSync(path.join(out, "sample_dataset.csv"), G.toCSV(sample, G.REQUIRED_COLUMNS.concat(G.OPTIONAL_COLUMNS)) + "\n");

const google = G.generateGoogleDataset();
fs.writeFileSync(path.join(out, "google_2023_calibrated.csv"), G.toCSV(google, G.REQUIRED_COLUMNS.concat(G.OPTIONAL_COLUMNS)) + "\n");
const ga = G.analyse(google, G.profileGoogle());
console.log("google_2023_calibrated.csv".padEnd(34), "PUE", ga.metrics.kpis.pue.toFixed(3), "GreenScore", ga.green.score.toFixed(1), ga.green.grade.grade);

function project(file, gen, patch, levers) {
  const rows = G.generateDataset(gen);
  const profile = Object.assign(G.profileFromLocation(gen.location, gen.coolingSystem), patch);
  const allLevers = Object.assign({}, G.DEFAULT_LEVERS, { renewablePct: profile.renewablePct }, levers);
  const c = G.compareScenario(rows, profile, allLevers);
  const snap = {
    app: "GreenDC", version: 1, savedAt: new Date().toISOString(), name: profile.name, source: "Simulated",
    gen, rows: null, profile, weights: G.DEFAULT_WEIGHTS, levers: allLevers, greenScore: c.base.green.score, days: rows.length,
  };
  fs.writeFileSync(path.join(out, "scenarios", file), JSON.stringify(snap, null, 1) + "\n");
  console.log(file.padEnd(34), "baseline", c.base.green.score.toFixed(1), c.base.green.grade.grade, "→ scenario", c.scen.green.score.toFixed(1), c.scen.green.grade.grade);
}

const base = { itCapacityMW: 2, economiserAdoption: 0.6, days: 365, seed: 42, injectAnomalies: true };
project("ashburn-c-to-a.json", Object.assign({ location: "virginia", coolingSystem: "evaporative" }, base),
  { name: "Ashburn: path from grade C to A" }, { renewablePct: 100, noiseMitigation: 8, waterReuse: 50, setpointDelta: 2 });
project("karachi-liquid-retrofit.json", Object.assign({ location: "karachi", coolingSystem: "liquid" }, base),
  { name: "Karachi: liquid cooling with deep retrofit" }, { setpointDelta: 4, economiserBoost: 70, itReduction: 15, lossReduction: 40, renewablePct: 100, waterReuse: 50, noiseMitigation: 8 });
project("greendc-best-case.json", { location: "stockholm", coolingSystem: "aircooled", itCapacityMW: 2, economiserAdoption: 1, days: 365, seed: 42, injectAnomalies: false },
  { name: "GreenDC best case · ideal Nordic site", gridCI: 20, gridRenewablePct: 100, waterStress: 0, distanceM: 1500 },
  { setpointDelta: 6, economiserBoost: 100, itReduction: 30, lossReduction: 60, renewablePct: 100, waterReuse: 90, noiseMitigation: 15 });
