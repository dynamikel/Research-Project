// Run with: node tests/engine.test.js
// 1) hand-calculated reference cases, 2) internal identities on the sample dataset.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const G = require("../website/assets/engine.js");

let failures = 0;
function check(name, fn) {
  try { fn(); console.log("PASS", name); }
  catch (e) { failures++; console.log("FAIL", name, "-", e.message); }
}
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);

G.selfTest().forEach((t) => check(`hand case: ${t.name}`, () => close(t.actual, t.expected, 1e-4)));

const rows = G.parseCSV(fs.readFileSync(path.join(__dirname, "../data/sample_dataset.csv"), "utf8"));
const prof = G.profileFromLocation("virginia", "evaporative");
const a = G.analyse(rows, prof);
const k = a.metrics.kpis;

check("PUE = 1 + CLF + PLF", () => close(k.pue, 1 + k.clf + k.plf));
check("DCiE = 100 / PUE", () => close(k.dcie, 100 / k.pue));
check("CUE = PUE x weighted CI x (1 - RE)", () => close(k.cue, k.pue * (k.avgGridCI / 1000) * (1 - k.renewablePct / 100)));
check("annual PUE is energy-weighted, not a mean of daily PUE", () => close(k.pue, rows.reduce((s, r) => s + r.it_kwh + r.cooling_kwh + r.other_kwh, 0) / rows.reduce((s, r) => s + r.it_kwh, 0)));
check("scores are within 0-100", () => Object.values(a.scores).forEach((d) => assert.ok(d.score >= 0 && d.score <= 100)));
check("GreenScore is the weighted mean of dimensions", () => {
  const w = G.DEFAULT_WEIGHTS, ws = Object.values(w).reduce((s, x) => s + x, 0);
  close(a.green.score, Object.keys(w).reduce((s, key) => s + a.scores[key].score * w[key], 0) / ws);
});
check("contracted renewables do not change the location score", () => {
  const b = G.analyse(rows, Object.assign({}, prof, { renewablePct: 100 }));
  close(b.scores.location.score, a.scores.location.score);
  assert.ok(b.scores.carbon.score > a.scores.carbon.score);
});
check("empty scenario changes nothing", () => close(G.compareScenario(rows, prof, {}).delta.energyMWh, 0));
check("100 % renewables gives zero market-based emissions", () => close(G.analyse(rows, Object.assign({}, prof, { renewablePct: 100 })).metrics.kpis.co2MktT, 0));
check("weather-adjusted detector finds the injected PUE faults", () => {
  const d = a.metrics.daily;
  const f = G.detectAnomalies(d.map((x) => x.pue), { method: "residual", threshold: 3.5, x: d.map((x) => x.temp) }).map((x) => x.flag);
  const ev = G.evaluateDetection(f, d.map((x) => ["cooling_fault", "ups_fault"].includes(x.event)));
  assert.ok(ev.precision >= 0.9 && ev.recall >= 0.5, JSON.stringify(ev));
});

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
