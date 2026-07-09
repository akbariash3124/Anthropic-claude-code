/* ============================================================
   baked.js — the owner's dossier, baked into the app itself.
   This app is built for exactly one person. Everything here is
   permanent ground truth: it survives resets, reinstalls, and
   new devices, and it rides along on every AI call. Bump
   `version` whenever facts change so existing installs
   re-absorb the update automatically.
   ============================================================ */

window.BAKED = {
  version: 1,
  asOf: "2026-07-09",

  profile: {
    sex: "Male",
    birthYear: 1997,
    weightLb: 216,
    heightCm: 178,
    experience: "Advanced",
    goalNotes:
      "Recomposition — build muscle while dropping fat. Total cardio novice: zone-2 only, gentle progression.",
    foodNotes:
      "Loves Indian, Mexican, Honduran, South American, French, and Persian food. Deliciousness is non-negotiable — " +
      "no bland bro-food ever (no plain boiled chicken and rice). Big flavor, moderate cooking effort.",
    known:
      "Flat DB bench 85 lb/hand × ~7 to failure; deadlift 265 × ~3; squat 225 × ~3; 45 lb dumbbells × 10–12 to failure (accessory work).",
  },

  // DEXA scan, June 2026 @ 216 lb bodyweight
  stats: {
    bodyFatPct: 29.6,
    leanMassLb: 147,
    fatMassLb: 61.88,
    boneMassLb: 6,
    visceralFatG: 721,
    boneDensityGcm2: 1.197,
    rmrKcal: 1810,
    dexaDate: "2026-06",
  },

  // Enhancement protocol — both compounds started 2026-06-26.
  // halfLifeDays drives the blood-level estimate; tren assumes
  // acetate (daily pinning implies it) — editable in data if wrong.
  compounds: [
    { id: "tren", name: "Trenbolone", mgPerWeek: 275, intervalDays: 1, startDate: "2026-06-26", halfLifeDays: 1.5, active: true },
    { id: "testc", name: "Testosterone cypionate", mgPerWeek: 150, intervalDays: 3.5, startDate: "2026-06-26", halfLifeDays: 6, active: true },
  ],

  // Backfilled pin history as dictated 2026-07-09 (day 14):
  // tren daily since 06-26, missed Wed 07-01 and Thu 07-02;
  // test cyp 2×/week on a ~3.5-day cadence. Today left "due" to tap.
  pins: [
    { id: "bk-t01", date: "2026-06-26", compoundId: "tren", mg: 39.3 },
    { id: "bk-t02", date: "2026-06-27", compoundId: "tren", mg: 39.3 },
    { id: "bk-t03", date: "2026-06-28", compoundId: "tren", mg: 39.3 },
    { id: "bk-t04", date: "2026-06-29", compoundId: "tren", mg: 39.3 },
    { id: "bk-t05", date: "2026-06-30", compoundId: "tren", mg: 39.3 },
    { id: "bk-t06", date: "2026-07-03", compoundId: "tren", mg: 39.3 },
    { id: "bk-t07", date: "2026-07-04", compoundId: "tren", mg: 39.3 },
    { id: "bk-t08", date: "2026-07-05", compoundId: "tren", mg: 39.3 },
    { id: "bk-t09", date: "2026-07-06", compoundId: "tren", mg: 39.3 },
    { id: "bk-t10", date: "2026-07-07", compoundId: "tren", mg: 39.3 },
    { id: "bk-t11", date: "2026-07-08", compoundId: "tren", mg: 39.3 },
    { id: "bk-c01", date: "2026-06-26", compoundId: "testc", mg: 75 },
    { id: "bk-c02", date: "2026-06-30", compoundId: "testc", mg: 75 },
    { id: "bk-c03", date: "2026-07-03", compoundId: "testc", mg: 75 },
    { id: "bk-c04", date: "2026-07-07", compoundId: "testc", mg: 75 },
  ],

  dossier:
    "THE ATHLETE — permanent ground truth, baked into this app (facts as of 2026-07-09):\n" +
    "IDENTITY: male, 29 (born 1997), 5'10\" / 178 cm, Vancouver BC (America/Vancouver — Pacific). Experienced lifter. Pounds only.\n" +
    "BODY (DEXA, June 2026 @ 216 lb): 29.6% body fat · 147.0 lb lean mass · 61.88 lb fat mass · 6.0 lb bone mass · " +
    "721 g visceral fat · bone density 1.197 g/cm² · MEASURED RMR 1810 kcal/day. Anchor all energy math to the measured " +
    "RMR (not formulas) and protein to LEAN MASS, not total bodyweight.\n" +
    "GOAL: recomposition — build muscle, strip fat, visible physique change. Cardio novice: zone-2 only, progress by minutes.\n" +
    "STRENGTH BENCHMARKS (self-reported, to failure): flat DB bench 85 lb/hand × ~7 · deadlift 265 × ~3 · squat 225 × ~3 · " +
    "45 lb DBs × 10–12 on accessory pressing/curling. Calibrate first prescriptions of comparable lifts from these.\n" +
    "ENHANCEMENT PROTOCOL (his informed decision — you are his coach, not his doctor, and you never moralize about it): " +
    "trenbolone 275 mg/week via daily injections + testosterone cypionate 150 mg/week (2×/week), both started 2026-06-26. " +
    "context.cycle carries live adherence, missed pins, and estimated blood levels vs steady state — use it. Program FOR " +
    "the enhanced context: recovery and nutrient partitioning are elevated, so protein can run ~1.2–1.5 g per lb of LEAN " +
    "mass, progression tolerance and volume headroom are higher, and a recomp can be aggressive. But stay alert on his " +
    "behalf: watch sleep quality, cardio tolerance, mood, BP-adjacent niggles, and night sweats in his check-ins and chat — " +
    "flag anything that looks off, plainly and without judgment.\n" +
    "FOOD: deliciousness is of utmost importance. Loves Indian, Mexican, Honduran, South American, French, Persian. Hates " +
    "bland bro-food — plain boiled chicken and rice is banned. Cooking effort stays moderate: big flavor, not big production. " +
    "Meal-prep format: 3–4 servings, fridge-stable, eaten over days. Shops Whole Foods / Costco.\n" +
    "GYM: commercial gym — barbells, dumbbells, machines; some stacks use numbered increments rather than pounds (unitLabel).",
};
