/* ============================================================
   data.js — Section 2: persistence behind a repository interface.

   localStorage implementation (swappable for SQLite later — every
   access goes through the Data.* methods, never raw storage).

   Stores: user, custom exercises, per-pattern strength estimates,
   per-exercise corrections, per-exercise/pattern progression state,
   workout logs, and deload events. Implements the §2 resolution
   rule and the trusted-only update guarantee.
   ============================================================ */

const Data = (function () {
  "use strict";

  const KEY = "overload.v3";
  const DAY = 86400000;

  const blank = () => ({
    settings: { apiKey: "", model: "claude-opus-4-8", defaultMode: "hypertrophy" },
    user: { heightCm: null, weightLb: null, defaultMode: "hypertrophy" },
    customExercises: [],                 // {id,name,pattern,coeff,loadType,custom:true}
    patternEstimates: {},                // pattern -> {stored1RM, updatedAt, history:[], addedFlags:[]}
    corrections: {},                     // exerciseId -> stored1RM
    exerciseState: {},                   // exerciseId -> {nextWeightTotal, lastAction, lastPrescribedTotal}
    patternDeloadPending: {},            // pattern -> bool
    logs: [],                            // WorkoutLog[]
    deloads: [],                         // {pattern, date}
  });

  let state = read();

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      return Object.assign(blank(), JSON.parse(raw));
    } catch { return blank(); }
  }
  function write() { localStorage.setItem(KEY, JSON.stringify(state)); }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  /* ---------- settings + user ---------- */
  function settings() { return state.settings; }
  function setSettings(patch) { Object.assign(state.settings, patch); write(); }
  function user() { return state.user; }
  function setUser(patch) { Object.assign(state.user, patch); write(); }

  /* ---------- exercises ---------- */
  function builtinList() {
    return Engine.EXERCISES.map((e) => ({ id: "b:" + slug(e.name), ...e, custom: false }));
  }
  function exercises() { return builtinList().concat(state.customExercises); }
  function getExercise(id) { return exercises().find((e) => e.id === id) || null; }
  function getExerciseByName(name) {
    const n = (name || "").trim().toLowerCase();
    return exercises().find((e) => e.name.toLowerCase() === n) || null;
  }
  // Add (or fetch existing) a custom exercise produced by the recognizer.
  function addCustomExercise({ name, pattern, coeff, loadType }) {
    const existing = getExerciseByName(name);
    if (existing) return existing;
    const ex = { id: "c:" + uid(), name: name.trim(), pattern, coeff, loadType, custom: true, isReference: false };
    state.customExercises.push(ex);
    write();
    return ex;
  }

  /* ---------- pattern estimates ---------- */
  function patternEstimate(pattern) {
    const p = state.patternEstimates[pattern];
    return p ? p.stored1RM : null;
  }
  function patternRecord(pattern) {
    if (!state.patternEstimates[pattern]) {
      state.patternEstimates[pattern] = { stored1RM: null, updatedAt: null, history: [], addedFlags: [] };
    }
    return state.patternEstimates[pattern];
  }
  // Set from a TRUSTED estimate only (calibration or back-propagation).
  function setPatternEstimate(pattern, value, { ema = true, addedLoad = false } = {}) {
    const rec = patternRecord(pattern);
    rec.stored1RM = rec.stored1RM != null && ema
      ? Engine.updateEstimate(rec.stored1RM, value)
      : value;
    rec.updatedAt = new Date().toISOString();
    rec.history.push(rec.stored1RM);
    rec.addedFlags.push(!!addedLoad);
    write();
    return rec.stored1RM;
  }

  /* ---------- corrections (per-user per-exercise 1RM) ---------- */
  function correction(exerciseId) {
    return Object.prototype.hasOwnProperty.call(state.corrections, exerciseId)
      ? state.corrections[exerciseId] : null;
  }
  function setCorrection(exerciseId, value) { state.corrections[exerciseId] = value; write(); }

  /* ---------- §2 resolution rule ----------
     "what's this user's 1RM on exercise X" =
       ExerciseCorrection if it exists, else
       seedFromCoefficient(PatternEstimate.stored1RM, coeff).
     Returns null for bodyweight (coeff null) or uncalibrated pattern.  */
  function resolve1RM(exercise) {
    if (!exercise) return null;
    const corr = correction(exercise.id);
    if (corr != null) return corr;
    if (exercise.coeff == null) return null;            // bodyweight — no %1RM
    const pe = patternEstimate(exercise.pattern);
    if (pe == null) return null;                        // pattern not calibrated yet
    return Engine.seedFromCoefficient(pe, exercise.coeff);
  }

  /* ---------- progression state ---------- */
  function exerciseState(id) { return state.exerciseState[id] || null; }
  function setExerciseState(id, patch) {
    state.exerciseState[id] = Object.assign({}, state.exerciseState[id], patch);
    write();
  }

  /* ---------- deload ---------- */
  function patternDeloadPending(pattern) { return !!state.patternDeloadPending[pattern]; }
  function setPatternDeloadPending(pattern, v) { state.patternDeloadPending[pattern] = v; write(); }
  function addDeload(pattern) { state.deloads.push({ pattern, date: new Date().toISOString() }); write(); }
  function deloadsFor(pattern) { return state.deloads.filter((d) => d.pattern === pattern); }
  function weeksSinceLastDeload(pattern) {
    const ds = deloadsFor(pattern);
    const patternLogs = logsForPattern(pattern);
    const baseIso = ds.length ? ds[ds.length - 1].date
      : (patternLogs.length ? patternLogs[0].date : null);
    if (!baseIso) return 0;
    return (Date.now() - new Date(baseIso).getTime()) / (7 * DAY);
  }

  /* ---------- logs ---------- */
  function addLog(log) { state.logs.push(Object.assign({ id: uid() }, log)); write(); }
  function allLogs() { return state.logs.slice().sort((a, b) => new Date(a.date) - new Date(b.date)); }
  function logsForExercise(exerciseId) { return allLogs().filter((l) => l.exerciseId === exerciseId); }
  function logsForPattern(pattern) {
    const ids = new Set(exercises().filter((e) => e.pattern === pattern).map((e) => e.id));
    return allLogs().filter((l) => ids.has(l.exerciseId));
  }

  /* ---------- bulk ---------- */
  function exportData() {
    const copy = JSON.parse(JSON.stringify(state));
    copy.settings.apiKey = "";
    return copy;
  }
  function importData(obj) {
    if (!obj || typeof obj !== "object") throw new Error("bad");
    const key = state.settings.apiKey;
    state = Object.assign(blank(), obj);
    state.settings.apiKey = key;
    write();
  }
  function reset() {
    const key = state.settings.apiKey;
    state = blank();
    state.settings.apiKey = key;
    write();
  }
  function _seed(s) { state = s; write(); }

  return {
    settings, setSettings, user, setUser,
    exercises, getExercise, getExerciseByName, addCustomExercise,
    patternEstimate, setPatternEstimate, patternRecord,
    correction, setCorrection, resolve1RM,
    exerciseState, setExerciseState,
    patternDeloadPending, setPatternDeloadPending, addDeload, deloadsFor, weeksSinceLastDeload,
    addLog, allLogs, logsForExercise, logsForPattern,
    exportData, importData, reset, _seed,
  };
})();

if (typeof window !== "undefined") window.Data = Data;
