/* ============================================================
   engine.js — THE LOCKED MODEL (Section 1 of the build spec)

   Pure, deterministic functions. ZERO framework / DB / network /
   DOM dependencies, so the math is auditable and unit-testable in
   isolation. NO LLM is involved anywhere in this file — every
   weight and rep target is plain arithmetic.

   Units: the spec is unit-agnostic arithmetic. This app runs the
   engine natively in POUNDS (lb): the spec's numeric constants
   (2.5 / 5 / 2 increments, etc.) are pounds here. All 21 spec test
   vectors pass verbatim because they are pure numbers.
   ============================================================ */

const Engine = (function () {
  "use strict";

  /* ---------- §1.2 percentage → rep table ---------- */
  const PCT_TABLE = {
    1: 100, 2: 95, 3: 93, 4: 90, 5: 87, 6: 85,
    7: 83, 8: 80, 9: 77, 10: 75, 11: 72, 12: 70,
  };

  /* ---------- §1.3 goal modes (default = hypertrophy) ---------- */
  const MODES = {
    strength:    { repLow: 4,  repHigh: 6  },
    hypertrophy: { repLow: 8,  repHigh: 12 },
    endurance:   { repLow: 12, repHigh: 15 },
  };

  /* ---------- §1.4 exercise-coefficient table ----------
     coeff = exercise 1RM as a fraction of its pattern reference lift.
     loadType controls per-hand <-> total conversion (§1.6).            */
  const EXERCISES = [
    // vertical_push
    { name: "Overhead Press",        pattern: "vertical_push",   coeff: 1.00, loadType: "barbell",          isReference: true },
    { name: "Dumbbell Shoulder Press", pattern: "vertical_push", coeff: 0.90, loadType: "dumbbell_pair" },
    { name: "Arnold Press",          pattern: "vertical_push",   coeff: 0.85, loadType: "dumbbell_pair" },
    { name: "Lateral Raise",         pattern: "vertical_push",   coeff: 0.22, loadType: "dumbbell_pair" },
    { name: "Front Raise",           pattern: "vertical_push",   coeff: 0.25, loadType: "dumbbell_pair" },
    // horizontal_push
    { name: "Bench Press",           pattern: "horizontal_push", coeff: 1.00, loadType: "barbell",          isReference: true },
    { name: "Dumbbell Bench",        pattern: "horizontal_push", coeff: 0.90, loadType: "dumbbell_pair" },
    { name: "Incline Barbell Bench", pattern: "horizontal_push", coeff: 0.85, loadType: "barbell" },
    { name: "Push-up",               pattern: "horizontal_push", coeff: null, loadType: "bodyweight" },
    { name: "Tricep Pushdown",       pattern: "horizontal_push", coeff: 0.30, loadType: "machine" },
    // vertical_pull
    { name: "Weighted Pull-up",      pattern: "vertical_pull",   coeff: 1.00, loadType: "bodyweight_loaded", isReference: true },
    { name: "Pulldown",              pattern: "vertical_pull",   coeff: 0.85, loadType: "machine" },
    { name: "Pull-up",               pattern: "vertical_pull",   coeff: null, loadType: "bodyweight" },
    { name: "Straight-arm Pulldown", pattern: "vertical_pull",   coeff: 0.35, loadType: "machine" },
    // horizontal_pull
    { name: "Barbell Row",           pattern: "horizontal_pull", coeff: 1.00, loadType: "barbell",          isReference: true },
    { name: "Dumbbell Row",          pattern: "horizontal_pull", coeff: 0.90, loadType: "dumbbell_pair" },
    { name: "Cable Row",             pattern: "horizontal_pull", coeff: 0.85, loadType: "machine" },
    { name: "Face Pull",             pattern: "horizontal_pull", coeff: 0.30, loadType: "machine" },
    { name: "Bicep Curl",            pattern: "horizontal_pull", coeff: 0.40, loadType: "barbell" },
    // squat
    { name: "Back Squat",            pattern: "squat",           coeff: 1.00, loadType: "barbell",          isReference: true },
    { name: "Front Squat",           pattern: "squat",           coeff: 0.80, loadType: "barbell" },
    { name: "Leg Press",             pattern: "squat",           coeff: 1.80, loadType: "machine" },
    { name: "Goblet Squat",          pattern: "squat",           coeff: 0.50, loadType: "dumbbell_single" },
    { name: "Leg Extension",         pattern: "squat",           coeff: 0.45, loadType: "machine" },
    // hinge
    { name: "Deadlift",              pattern: "hinge",           coeff: 1.00, loadType: "barbell",          isReference: true },
    { name: "Romanian Deadlift",     pattern: "hinge",           coeff: 0.80, loadType: "barbell" },
    { name: "Hip Thrust",            pattern: "hinge",           coeff: 0.90, loadType: "barbell" },
    { name: "Leg Curl",              pattern: "hinge",           coeff: 0.35, loadType: "machine" },
  ];

  const PATTERNS = ["vertical_push", "horizontal_push", "vertical_pull", "horizontal_pull", "squat", "hinge"];

  // Patterns trained as "lower body" (heavier plate jumps).
  const LOWER_PATTERNS = new Set(["squat", "hinge"]);
  const isLowerPattern = (pattern) => LOWER_PATTERNS.has(pattern);

  function referenceExercise(pattern) {
    return EXERCISES.find((e) => e.pattern === pattern && e.isReference) || null;
  }
  function getExercise(name) {
    if (!name) return null;
    const n = name.trim().toLowerCase();
    return EXERCISES.find((e) => e.name.toLowerCase() === n) || null;
  }

  /* ---------- §1.1 1RM estimator — Epley with RIR folding ---------- */
  function estimate1RM(weight, reps, rir) {
    const effectiveReps = reps + rir;
    const oneRM = weight * (1 + effectiveReps / 30);
    const trusted = effectiveReps <= 12 && reps >= 1;
    return { oneRM, effectiveReps, trusted };
  }

  /* ---------- §1.2 pct lookup for a given rep count ---------- */
  function pctForReps(reps) {
    const r = Math.max(1, Math.min(12, Math.round(reps)));
    return PCT_TABLE[r];
  }

  /* ---------- §1.6 plate rounding + load-type conversion ---------- */
  function roundToIncrement(value, increment) {
    return Math.round(value / increment) * increment;
  }

  // Increment used to round a TOTAL load for a given exercise type.
  function roundIncrementFor(loadType, isLower) {
    switch (loadType) {
      case "dumbbell_pair":   return 4;   // 2 per hand
      case "dumbbell_single": return 2;
      case "machine":         return 2.5;
      case "bodyweight_loaded": return 2.5;
      case "barbell":         return isLower ? 5 : 2.5;
      default:                return 2.5;
    }
  }

  // Engine is canonical in TOTAL load. UI shows per-hand for paired dumbbells.
  function toTotalLoad(displayLoad, loadType) {
    return loadType === "dumbbell_pair" ? displayLoad * 2 : displayLoad;
  }
  function toDisplayLoad(totalLoad, loadType) {
    return loadType === "dumbbell_pair" ? roundToIncrement(totalLoad / 2, 2) : totalLoad;
  }

  /* ---------- §1.3/§1.6 full prescription from an estimate ---------- */
  function prescribe(estimated1RM, mode, loadType, isLowerBarbell) {
    const m = MODES[mode] || MODES.hypertrophy;
    const pct = pctForReps(m.repLow);          // always prescribe at bottom of range
    const raw = estimated1RM * pct / 100;
    const inc = roundIncrementFor(loadType, isLowerBarbell);
    const totalLoad = roundToIncrement(raw, inc);
    const displayLoad = toDisplayLoad(totalLoad, loadType);
    return { totalLoad, displayLoad, repLow: m.repLow, repHigh: m.repHigh };
  }

  /* ---------- §1.5 strength-estimate blend (EMA) ----------
     Caller must pass ONLY trusted session estimates.                 */
  function updateEstimate(stored1RM, sessionEstimate1RM, alpha) {
    const a = alpha == null ? 0.3 : alpha;
    return (1 - a) * stored1RM + a * sessionEstimate1RM;
  }

  /* ---------- §1.4 seed a new exercise from its pattern reference ---------- */
  function seedFromCoefficient(referencePattern1RM, coeff) {
    return referencePattern1RM * coeff;
  }

  // Load increment for double progression (§1.5).
  function loadIncrementFor(loadType, isLowerBarbell) {
    if (isLowerBarbell) return 5;                 // lower body +5
    if (loadType === "dumbbell_pair") return 4;   // +2 per hand
    if (loadType === "dumbbell_single") return 2;
    return 2.5;                                    // upper barbell / machine
  }

  /* ---------- §1.5 decide next progression from last session ---------- */
  function nextProgression(args) {
    const {
      loadType, isLowerBarbell, prescribedWeightTotal,
      hitAllSetsAtRepHigh, minRirAcrossSets, missedRepLow,
    } = args;
    const inc = loadIncrementFor(loadType, isLowerBarbell);

    // Hit top of range on all sets AND RIR >= 1 -> add load, reset reps to bottom.
    if (hitAllSetsAtRepHigh && minRirAcrossSets >= 1) {
      return { action: "add_load", nextWeightTotal: prescribedWeightTotal + inc };
    }
    // Missed bottom of range, OR ground out a grinding RIR=0 -> hold (one retry).
    if (missedRepLow || minRirAcrossSets === 0) {
      return { action: "hold_retry", nextWeightTotal: prescribedWeightTotal };
    }
    // Landed inside the range -> hold load, push for more reps.
    return { action: "hold_push_reps", nextWeightTotal: prescribedWeightTotal };
  }

  /* ---------- §1.7 deload trigger + reason ----------
     History arrays are most-recent-LAST.                              */
  function checkDeload(args) {
    const { storedHistory = [], addedLoadFlags = [], weeksSinceLastDeload = 0 } = args;

    // regression — current stored 1RM <= 0.90 * peak over last 4 sessions
    if (storedHistory.length >= 1) {
      const recent = storedHistory.slice(-4);
      const peak = Math.max(...recent);
      const current = storedHistory[storedHistory.length - 1];
      if (current <= 0.90 * peak) return { deload: true, reason: "regression" };
    }
    // stall — no load added for 3 consecutive (most recent) sessions
    if (addedLoadFlags.length >= 3 && addedLoadFlags.slice(-3).every((f) => f === false)) {
      return { deload: true, reason: "stall" };
    }
    // time — 8+ weeks of continuous progression with no deload
    if (weeksSinceLastDeload >= 8) return { deload: true, reason: "time" };

    return { deload: false, reason: null };
  }

  // §1.7 action — one deload session at 88% of working weight, reps to middle.
  function deloadPrescription(workingTotalLoad, mode, loadType, isLowerBarbell) {
    const m = MODES[mode] || MODES.hypertrophy;
    const inc = roundIncrementFor(loadType, isLowerBarbell);
    const totalLoad = roundToIncrement(workingTotalLoad * 0.88, inc);
    const midReps = Math.round((m.repLow + m.repHigh) / 2);
    return { totalLoad, displayLoad: toDisplayLoad(totalLoad, loadType), reps: midReps, rirTarget: 3 };
  }

  return {
    PCT_TABLE, MODES, EXERCISES, PATTERNS,
    isLowerPattern, referenceExercise, getExercise,
    estimate1RM, pctForReps, roundToIncrement, roundIncrementFor,
    toTotalLoad, toDisplayLoad, prescribe, updateEstimate,
    seedFromCoefficient, loadIncrementFor, nextProgression,
    checkDeload, deloadPrescription,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Engine;
if (typeof window !== "undefined") window.Engine = Engine;
