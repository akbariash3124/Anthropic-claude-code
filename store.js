/* ============================================================
   store.js — data layer v2. Single-user, localStorage-backed.
   Everything the brain knows lives here: sessions, cardio,
   weigh-ins, check-ins, niggles, photos, the AI-maintained
   Athlete Model, block/diet state, rollup memory, chat, and the
   active (in-progress) workout. Migrates from coach.v1.
   ============================================================ */

const Store = (function () {
  "use strict";

  const KEY = "coach.v2";
  const OLD_KEY = "coach.v1";
  const CFG = (typeof window !== "undefined" && window.COACH_CONFIG) || {};
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const blank = () => ({
    v: 2,
    settings: { apiKey: CFG.apiKey || "", model: CFG.model || "claude-opus-4-8", backup: { token: "", repo: "", lastPushedAt: null, lastError: "" }, lastBackupAt: null },
    profile: {
      sex: "", birthYear: null, weightLb: null, heightCm: null, experience: "Beginner",
      goal: "Recomp (build muscle + lose fat)", goalNotes: "", known: "", proteinTarget: null, equipmentNotes: "",
      foodNotes: "", // likes/dislikes/allergies/cuisines — feeds the meal engine
      dossier: "",   // athlete's own permanent notes for the coach (DEXA report paste, etc.)
      stats: { bodyFatPct: null, leanMassLb: null, fatMassLb: null, boneMassLb: null, visceralFatG: null, boneDensityGcm2: null, rmrKcal: null, dexaDate: "" },
    },
    onboarded: false,
    bakedVersion: 0, // last absorbed window.BAKED.version

    // The coach's living notebook about the athlete (AI-written).
    athleteModel: { text: "", pendingNotes: [], updatedAt: null },

    // Nutrition
    nutrition: { targets: null }, // {calories,protein,carbs,fat,rationale,updatedAt,setBy}
    meals: [],   // {id,date,name,desc,items:[{name,calories,protein,carbs,fat}],calories,protein,carbs,fat,confidence,method}
    recipes: [], // saved meal-prep recipes: {id,name,hook,servings,perServing,prepMinutes,keepsDays,ingredients,steps,createdAt}

    // Logs
    sessions: [],     // lift sessions (see saveSession shape in app.js)
    cardio: [],       // {id,date,modality,minutes,rpe,notes}
    weighIns: [],     // {date(YYYY-MM-DD), lb}
    checkIns: [],     // {date(YYYY-MM-DD), readiness:'rough'|'normal'|'great'} + weekly {nutrition,sleep,energy,notes}
    niggles: [],      // {id,area,note,status:'active'|'watch'|'resolved',created,updated}
    photos: [],       // {id,date,dataUrl} — downscaled, capped
    compounds: [],    // {id,name,mgPerWeek,intervalDays,startDate,halfLifeDays,active}
    pins: [],         // injection log: {id,date(YYYY-MM-DD local),compoundId,mg}

    // Program state
    block: { phase: "accumulation", weekNum: 1, startedAt: null, targets: {}, specialization: [], experiment: "" },
    dietPhase: { mode: "deficit", startedAt: null, note: "" },

    // Memory hierarchy
    weeklyReviews: [], // {id,date,data} — full structured reviews
    rollups: { weekly: [], blocks: [], career: "" },

    // Live state
    activeSession: null, // {startedAt, items:[{rx, state:[{w,r,rir,done}], saved}]}
    chat: [],            // {role:'user'|'assistant', text, date}
    recCache: null,      // {date, data} daily focus cache
  });

  function migrateV1(old) {
    const s = blank();
    try {
      s.settings = Object.assign(s.settings, old.settings || {});
      s.profile = Object.assign(s.profile, old.profile || {});
      s.onboarded = !!old.onboarded;
      s.sessions = (old.sessions || []).map((x) => ({
        id: x.id || uid(),
        date: x.date,
        name: x.name,
        muscles: x.muscleGroup
          ? String(x.muscleGroup).split(/[,/]/).map((m, i) => ({ name: m.trim(), fraction: i === 0 ? 1 : 0.5 })).filter((m) => m.name)
          : [],
        equipment: x.equipment || "other",
        perHand: !!x.perHand,
        prescribed: x.workingSets || [],
        logged: x.logged || [],
        estimatedOneRepMax: x.estimatedOneRepMax || null,
        restSeconds: x.restSeconds || null,
        rationale: x.rationale || "",
      }));
    } catch { /* fall through with what we got */ }
    return s;
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const merged = Object.assign(blank(), parsed);
        // deep-merge the objects that must keep their shape
        merged.settings = Object.assign(blank().settings, parsed.settings || {});
        merged.settings.backup = Object.assign(blank().settings.backup, (parsed.settings || {}).backup || {});
        merged.profile = Object.assign(blank().profile, parsed.profile || {});
        merged.profile.stats = Object.assign(blank().profile.stats, (parsed.profile || {}).stats || {});
        merged.athleteModel = Object.assign(blank().athleteModel, parsed.athleteModel || {});
        merged.block = Object.assign(blank().block, parsed.block || {});
        merged.dietPhase = Object.assign(blank().dietPhase, parsed.dietPhase || {});
        merged.rollups = Object.assign(blank().rollups, parsed.rollups || {});
        if (!merged.settings.apiKey && CFG.apiKey) merged.settings.apiKey = CFG.apiKey;
        return bakeIn(merged);
      }
      const old = localStorage.getItem(OLD_KEY);
      if (old) { const s = migrateV1(JSON.parse(old)); localStorage.setItem(KEY, JSON.stringify(s)); return bakeIn(s); }
      return bakeIn(blank());
    } catch { return bakeIn(blank()); }
  }

  /* Absorb the baked dossier (baked.js). Facts win over stale state;
     free-text fields only fill in when empty (the dossier text itself
     always reaches the brain via window.BAKED, so nothing is lost). */
  function bakeIn(s) {
    const B = (typeof window !== "undefined" && window.BAKED) || null;
    if (!B || (s.bakedVersion || 0) >= B.version) return s;
    const p = s.profile, bp = B.profile || {};
    for (const k of ["sex", "birthYear", "heightCm", "experience"]) if (bp[k] != null) p[k] = bp[k];
    for (const k of ["goalNotes", "foodNotes", "equipmentNotes", "known"]) if (bp[k] && !p[k]) p[k] = bp[k];
    for (const k of Object.keys(B.stats || {})) if (B.stats[k] != null && B.stats[k] !== "") p.stats[k] = B.stats[k];
    // current weight is a live fact — refresh unless a newer weigh-in exists
    const newest = (s.weighIns || []).map((w) => w.date).sort().pop() || "";
    if (bp.weightLb && newest < B.asOf) {
      p.weightLb = bp.weightLb;
      s.weighIns = (s.weighIns || []).filter((w) => w.date !== B.asOf)
        .concat([{ date: B.asOf, lb: bp.weightLb }]).sort((a, b) => (a.date < b.date ? -1 : 1));
    }
    if (!(s.compounds || []).length && B.compounds) s.compounds = JSON.parse(JSON.stringify(B.compounds));
    if (!(s.pins || []).length && B.pins) s.pins = JSON.parse(JSON.stringify(B.pins));
    // the dossier IS the onboarding — never make the owner re-enter himself
    if (p.sex && p.weightLb && p.goalNotes) s.onboarded = true;
    s.bakedVersion = B.version;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
    return s;
  }

  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
  function get() { return state; }
  const today = () => new Date().toISOString().slice(0, 10);

  /* ---------- logs ---------- */
  function addSession(sess) { sess.id = sess.id || uid(); state.sessions.push(sess); state.recCache = null; save(); return sess; }
  function addCardio(c) { c.id = uid(); c.date = c.date || new Date().toISOString(); state.cardio.push(c); state.recCache = null; save(); return c; }
  function addWeighIn(lb) {
    const d = today();
    state.weighIns = state.weighIns.filter((w) => w.date !== d);
    state.weighIns.push({ date: d, lb }); state.weighIns.sort((a, b) => a.date < b.date ? -1 : 1); save();
  }
  function todayWeighIn() { return state.weighIns.find((w) => w.date === today()) || null; }

  /* ---------- cycle / pins (dates in the athlete's local day, Pacific) ---------- */
  const vanToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  function logPin(compoundId, mg, date) {
    const d = date || vanToday();
    if (state.pins.some((p) => p.compoundId === compoundId && p.date === d)) return;
    state.pins.push({ id: uid(), date: d, compoundId, mg }); save();
  }
  function unlogPin(compoundId, date) {
    const d = date || vanToday();
    state.pins = state.pins.filter((p) => !(p.compoundId === compoundId && p.date === d)); save();
  }
  function setReadiness(readiness) {
    const d = today();
    let c = state.checkIns.find((x) => x.date === d);
    if (!c) { c = { date: d }; state.checkIns.push(c); }
    c.readiness = readiness; save();
  }
  function todayCheckIn() { return state.checkIns.find((x) => x.date === today()) || null; }

  /* ---------- nutrition ---------- */
  function setNutritionTargets(t, setBy) {
    state.nutrition.targets = Object.assign({}, t, { updatedAt: new Date().toISOString(), setBy: setBy || "ai" });
    save();
  }
  function addMeal(m) { m.id = uid(); m.date = m.date || new Date().toISOString(); state.meals.push(m); save(); return m; }
  function deleteMeal(id) { state.meals = state.meals.filter((m) => m.id !== id); save(); }
  function mealsToday() { const d = today(); return state.meals.filter((m) => m.date.slice(0, 10) === d); }
  function addRecipe(r) {
    const dup = state.recipes.find((x) => x.name.toLowerCase() === r.name.toLowerCase());
    if (dup) return dup;
    r.id = uid(); r.createdAt = new Date().toISOString();
    state.recipes.unshift(r); state.recipes = state.recipes.slice(0, 20); save(); return r;
  }
  function deleteRecipe(id) { state.recipes = state.recipes.filter((r) => r.id !== id); save(); }

  /* ---------- niggles ---------- */
  function addNiggle(area, note) { const n = { id: uid(), area, note, status: "active", created: today(), updated: today() }; state.niggles.push(n); save(); return n; }
  function cycleNiggle(id) {
    const n = state.niggles.find((x) => x.id === id); if (!n) return;
    n.status = n.status === "active" ? "watch" : n.status === "watch" ? "resolved" : "active";
    n.updated = today(); save();
  }

  /* ---------- photos (downscaled, capped at 12) ---------- */
  function addPhoto(dataUrl) {
    state.photos.push({ id: uid(), date: today(), dataUrl });
    while (state.photos.length > 12) state.photos.shift();
    save();
  }

  /* ---------- athlete model ---------- */
  function appendModelNote(note) { if (note) { state.athleteModel.pendingNotes.push({ date: today(), note }); save(); } }
  function setAthleteModel(text) {
    state.athleteModel.text = text || state.athleteModel.text;
    state.athleteModel.pendingNotes = [];
    state.athleteModel.updatedAt = new Date().toISOString(); save();
  }

  /* ---------- weekly review + memory ---------- */
  function addWeeklyReview(data) {
    const r = { id: uid(), date: new Date().toISOString(), data };
    state.weeklyReviews.push(r);
    if (data.weeklyRollup) { state.rollups.weekly.push({ weekOf: today(), text: data.weeklyRollup }); state.rollups.weekly = state.rollups.weekly.slice(-26); }
    if (data.athleteModel) setAthleteModel(data.athleteModel);
    if (data.muscleTargets) {
      state.block.targets = {};
      data.muscleTargets.forEach((t) => { state.block.targets[t.muscle.toLowerCase()] = { low: t.setsLow, high: t.setsHigh, note: t.note }; });
    }
    if (data.blockCall) {
      const bc = data.blockCall;
      if (bc.action === "deload") { state.block.phase = "deload"; }
      else if (bc.action === "new_block") {
        if (state.rollups.weekly.length) {
          state.rollups.blocks.push({ ended: today(), text: (data.blockRollup || data.weeklyRollup || "").slice(0, 2000) });
          state.rollups.blocks = state.rollups.blocks.slice(-20);
          state.rollups.career = state.rollups.blocks.map((b) => `[Block ended ${b.ended}] ${b.text}`).join("\n\n").slice(-14000);
        }
        state.block = { phase: "accumulation", weekNum: 1, startedAt: today(), targets: state.block.targets, specialization: (data.specialization && data.specialization.muscles) || [], experiment: (data.experiment && data.experiment.description) || "" };
      } else { state.block.phase = "accumulation"; state.block.weekNum = bc.weekNum || (state.block.weekNum + 1); }
    }
    if (data.specialization && data.specialization.muscles) state.block.specialization = data.specialization.muscles;
    if (data.experiment && data.experiment.description && data.experiment.status !== "none") state.block.experiment = data.experiment.description;
    if (data.nutritionCall && data.nutritionCall.calories > 0) {
      setNutritionTargets({ calories: data.nutritionCall.calories, protein: data.nutritionCall.protein, carbs: data.nutritionCall.carbs, fat: data.nutritionCall.fat, rationale: data.nutritionCall.note || "" }, "weekly-review");
    }
    if (data.dietCall && data.dietCall.mode) {
      const map = { hold_deficit: "deficit", tighten: "deficit", maintenance_break: "maintenance", surplus_nudge: "maintenance" };
      const mode = map[data.dietCall.mode] || state.dietPhase.mode;
      if (mode !== state.dietPhase.mode) state.dietPhase = { mode, startedAt: today(), note: data.dietCall.note || "" };
      else state.dietPhase.note = data.dietCall.note || state.dietPhase.note;
    }
    save(); return r;
  }
  function lastReview() { return state.weeklyReviews[state.weeklyReviews.length - 1] || null; }
  function daysSinceReview() {
    const r = lastReview(); if (!r) return 999;
    return (Date.now() - new Date(r.date).getTime()) / 86400000;
  }

  /* ---------- chat ---------- */
  function addChat(role, text) { state.chat.push({ role, text, date: new Date().toISOString() }); state.chat = state.chat.slice(-30); save(); }

  /* ---------- active session ---------- */
  function setActive(active) { state.activeSession = active; save(); }
  function getActive() {
    const a = state.activeSession;
    if (!a) return null;
    if (Date.now() - new Date(a.startedAt).getTime() > 12 * 3600000) { state.activeSession = null; save(); return null; }
    return a;
  }

  /* ---------- bulk ---------- */
  function exportData() {
    const c = JSON.parse(JSON.stringify(state));
    c.settings.apiKey = "";
    if (c.settings.backup) c.settings.backup.token = ""; // never let secrets leave the device
    return c;
  }
  function importData(obj) {
    const key = state.settings.apiKey;
    state = Object.assign(blank(), obj);
    state.settings = Object.assign(blank().settings, obj.settings || {}, { apiKey: key });
    state.onboarded = true; save();
  }
  function reset() { const key = state.settings.apiKey; state = blank(); state.settings.apiKey = key; save(); }

  return {
    get, save, uid, today, vanToday, logPin, unlogPin,
    setNutritionTargets, addMeal, deleteMeal, mealsToday, addRecipe, deleteRecipe,
    addSession, addCardio, addWeighIn, todayWeighIn, setReadiness, todayCheckIn,
    addNiggle, cycleNiggle, addPhoto,
    appendModelNote, setAthleteModel,
    addWeeklyReview, lastReview, daysSinceReview,
    addChat, setActive, getActive,
    exportData, importData, reset,
  };
})();

if (typeof window !== "undefined") window.Store = Store;
if (typeof module !== "undefined" && module.exports) module.exports = Store;
