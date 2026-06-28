/* ============================================================
   engine.test.js — CHECKPOINT 1
   The 21 spec test vectors as assertions. Run: `node engine.test.js`
   Expected values are pre-computed from the spec; if output
   disagrees, the implementation is wrong.
   ============================================================ */

const E = require("./engine.js");

let pass = 0, fail = 0;
const approx = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

function check(n, desc, got, want, isApprox = false) {
  const ok = isApprox ? approx(got, want) : got === want;
  if (ok) { pass++; console.log(`✓ #${n} ${desc} = ${got}`); }
  else { fail++; console.log(`✗ #${n} ${desc} -> got ${got}, want ${want}`); }
}
function checkObj(n, desc, got, wants) {
  const parts = Object.entries(wants).map(([k, v]) => {
    const ok = typeof v === "number" ? approx(got[k], v) : got[k] === v;
    return `${k}=${got[k]}${ok ? "" : `(want ${v})`}`;
  });
  const ok = Object.entries(wants).every(([k, v]) =>
    typeof v === "number" ? approx(got[k], v) : got[k] === v);
  if (ok) { pass++; console.log(`✓ #${n} ${desc} { ${parts.join(", ")} }`); }
  else { fail++; console.log(`✗ #${n} ${desc} { ${parts.join(", ")} }`); }
}

// 1–4 estimate1RM
checkObj(1, "estimate1RM(50,8,2)", E.estimate1RM(50, 8, 2), { oneRM: 66.67, effectiveReps: 10, trusted: true });
checkObj(2, "estimate1RM(100,3,1)", E.estimate1RM(100, 3, 1), { oneRM: 113.33, effectiveReps: 4, trusted: true });
checkObj(3, "estimate1RM(40,12,3)", E.estimate1RM(40, 12, 3), { oneRM: 60.0, effectiveReps: 15, trusted: false });
checkObj(4, "estimate1RM(60,5,0)", E.estimate1RM(60, 5, 0), { oneRM: 70.0, effectiveReps: 5, trusted: true });

// 5–7 updateEstimate
check(5, "updateEstimate(60,70)", E.updateEstimate(60, 70), 63, true);
check(6, "updateEstimate(60,50)", E.updateEstimate(60, 50), 57, true);
check(7, "updateEstimate(100,100)", E.updateEstimate(100, 100), 100, true);

// 8–10 roundToIncrement
check(8, "roundToIncrement(53.336,2.5)", E.roundToIncrement(53.336, 2.5), 52.5, true);
check(9, "roundToIncrement(64,5)", E.roundToIncrement(64, 5), 65, true);
check(10, "roundToIncrement(6.6,2)", E.roundToIncrement(6.6, 2), 6, true);

// 11–12 prescribe
checkObj(11, "prescribe(66.67,'hypertrophy','barbell',false)",
  E.prescribe(66.67, "hypertrophy", "barbell", false), { totalLoad: 52.5, repLow: 8, repHigh: 12 });
checkObj(12, "prescribe(70,'strength','barbell',false)",
  E.prescribe(70, "strength", "barbell", false), { totalLoad: 62.5, repLow: 4, repHigh: 6 });

// 13 seedFromCoefficient
check(13, "seedFromCoefficient(60,0.22)", E.seedFromCoefficient(60, 0.22), 13.2, true);

// 14–15 dumbbell conversions
check(14, "toDisplayLoad(13.2,'dumbbell_pair')", E.toDisplayLoad(13.2, "dumbbell_pair"), 6, true);
check(15, "toTotalLoad(6,'dumbbell_pair')", E.toTotalLoad(6, "dumbbell_pair"), 12, true);

// 16–18 nextProgression
checkObj(16, "nextProgression add_load",
  E.nextProgression({ hitAllSetsAtRepHigh: true, minRirAcrossSets: 1, missedRepLow: false,
    prescribedWeightTotal: 50, repHigh: 12, mode: "hypertrophy", loadType: "barbell", isLowerBarbell: false }),
  { action: "add_load", nextWeightTotal: 52.5 });
checkObj(17, "nextProgression hold_push_reps",
  E.nextProgression({ hitAllSetsAtRepHigh: false, minRirAcrossSets: 1, missedRepLow: false,
    prescribedWeightTotal: 50, repHigh: 12, mode: "hypertrophy", loadType: "barbell", isLowerBarbell: false }),
  { action: "hold_push_reps", nextWeightTotal: 50 });
checkObj(18, "nextProgression hold_retry",
  E.nextProgression({ hitAllSetsAtRepHigh: false, minRirAcrossSets: 1, missedRepLow: true,
    prescribedWeightTotal: 50, repHigh: 12, mode: "hypertrophy", loadType: "barbell", isLowerBarbell: false }),
  { action: "hold_retry", nextWeightTotal: 50 });

// 19–21 checkDeload
checkObj(19, "checkDeload stall",
  E.checkDeload({ addedLoadFlags: [false, false, false], storedHistory: [60, 60, 60], weeksSinceLastDeload: 2 }),
  { deload: true, reason: "stall" });
checkObj(20, "checkDeload regression",
  E.checkDeload({ storedHistory: [100, 98, 95, 89], addedLoadFlags: [true, false, false, false], weeksSinceLastDeload: 2 }),
  { deload: true, reason: "regression" });
checkObj(21, "checkDeload time",
  E.checkDeload({ storedHistory: [60, 61, 62], addedLoadFlags: [true, true, true], weeksSinceLastDeload: 9 }),
  { deload: true, reason: "time" });

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
