/* ============================================================
   observatory.js — the measurement layer. Pure computations over
   the store: weekly volume ledger (fractional sets per muscle),
   e1RM trends, bodyweight trend, prediction-engine metrics
   (accuracy, RIR bias, fatigue curve), per-muscle freshness,
   exercise ROI, adherence, cardio load — distilled into the
   compact context bundle every AI call receives.

   These numbers are OBSERVATIONS fed to the coach; they never
   prescribe anything themselves.
   ============================================================ */

const Obs = (function () {
  "use strict";

  const DAY = 86400000;
  const now = () => Date.now();
  const ageDays = (iso) => (now() - new Date(iso).getTime()) / DAY;
  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;

  // e1RM as a trend metric (Epley, reps capped @12; skip junk sets)
  function setE1rm(s) {
    if (!s || !(s.weight > 0) || !(s.reps > 0)) return null;
    const reps = Math.min(s.reps + (s.rir != null ? Math.min(s.rir, 4) : 0), 12);
    return s.weight * (1 + reps / 30);
  }
  function sessionE1rm(sess) {
    const vals = (sess.logged || []).map(setE1rm).filter(Boolean);
    return vals.length ? Math.max(...vals) : (sess.estimatedOneRepMax || null);
  }
  const sessionVolume = (s) => (s.logged || []).reduce((t, x) => t + x.weight * x.reps * (s.perHand ? 2 : 1), 0);

  /* ---------- weekly volume ledger (fractional hard sets / muscle) ---------- */
  function volumeWindow(state, fromDaysAgo, toDaysAgo) {
    const out = {};
    state.sessions.forEach((s) => {
      const a = ageDays(s.date);
      if (a < toDaysAgo || a >= fromDaysAgo) return;
      const hardSets = (s.logged || []).filter((x) => x.reps > 0 && (x.rir == null || x.rir <= 4)).length;
      (s.muscles && s.muscles.length ? s.muscles : [{ name: "other", fraction: 1 }]).forEach((m) => {
        const k = m.name.toLowerCase().trim();
        out[k] = r1((out[k] || 0) + hardSets * (m.fraction || 1));
      });
    });
    return out;
  }
  const volumeThisWeek = (state) => volumeWindow(state, 7, 0);
  const volumeLastWeek = (state) => volumeWindow(state, 14, 7);

  /* ---------- per-muscle freshness (decayed stress) ---------- */
  function muscleFreshness(state) {
    const stress = {};
    state.sessions.forEach((s) => {
      const a = ageDays(s.date); if (a > 10) return;
      const hardSets = (s.logged || []).length;
      (s.muscles || []).forEach((m) => {
        const k = m.name.toLowerCase().trim();
        stress[k] = (stress[k] || 0) + hardSets * (m.fraction || 1) * Math.exp(-a / 1.8);
      });
    });
    const out = {};
    Object.keys(stress).forEach((k) => { out[k] = stress[k] > 6 ? "recovering" : stress[k] > 2.5 ? "partly_recovered" : "fresh"; });
    return out;
  }

  /* ---------- e1RM trend per exercise ---------- */
  function liftSeries(state, name) {
    return state.sessions
      .filter((s) => s.name.toLowerCase() === name.toLowerCase())
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((s) => ({ date: s.date, e1rm: sessionE1rm(s), vol: sessionVolume(s) }))
      .filter((p) => p.e1rm != null);
  }
  // least-squares slope in lb/week over last `days`
  function slopePerWeek(series, days) {
    const cut = series.filter((p) => ageDays(p.date) <= days);
    if (cut.length < 2) return null;
    const xs = cut.map((p) => new Date(p.date).getTime() / (7 * DAY));
    const ys = cut.map((p) => p.e1rm);
    const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    return den ? r2(num / den) : 0;
  }

  function liftSummaries(state, max) {
    const byName = {};
    state.sessions.forEach((s) => { (byName[s.name] = byName[s.name] || []).push(s); });
    return Object.keys(byName)
      .map((name) => {
        const sessions = byName[name].sort((a, b) => new Date(a.date) - new Date(b.date));
        const series = liftSeries(state, name);
        const last = sessions[sessions.length - 1];
        return {
          name,
          sessions: sessions.length,
          lastDate: last.date.slice(0, 10),
          latestE1rm: series.length ? r1(series[series.length - 1].e1rm) : null,
          slope4wkLbPerWk: slopePerWeek(series, 28),
          stalled: series.length >= 3 && slopePerWeek(series, 28) != null && slopePerWeek(series, 28) <= 0.2,
          lastSets: (last.logged || []).map((x) => ({ w: x.weight, r: x.reps, rir: x.rir })),
        };
      })
      .sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1))
      .slice(0, max || 10);
  }

  /* ---------- prediction engine metrics ---------- */
  // Prescriptions ARE predictions: compare logged vs prescribed set-by-set.
  function predictionMetrics(state) {
    const pairs = [];
    state.sessions.slice(-25).forEach((s) => {
      const p = s.prescribed || [], l = s.logged || [];
      for (let i = 0; i < Math.min(p.length, l.length); i++) {
        if (l[i].reps > 0 && p[i] && p[i].reps > 0 && Math.abs((l[i].weight || 0) - (p[i].weight || 0)) < 0.01 * Math.max(1, p[i].weight) + 5.1) {
          pairs.push({ repErr: l[i].reps - p[i].reps, rirGap: (l[i].rir != null && p[i].targetRIR != null) ? l[i].rir - p[i].targetRIR : null, setIdx: i });
        }
      }
    });
    const recent = pairs.slice(-30);
    const within1 = recent.filter((x) => Math.abs(x.repErr) <= 1).length;
    const rirGaps = recent.map((x) => x.rirGap).filter((x) => x != null);
    // fatigue curve: mean rep drop per set index across sessions with >=3 comparable sets
    const drops = [];
    state.sessions.slice(-20).forEach((s) => {
      const l = (s.logged || []).filter((x) => x.reps > 0);
      if (l.length >= 3 && l.every((x) => Math.abs(x.weight - l[0].weight) < 0.01 * l[0].weight + 2.6)) {
        drops.push((l[0].reps - l[l.length - 1].reps) / (l.length - 1));
      }
    });
    return {
      setsScored: recent.length,
      accuracyWithin1Rep: recent.length ? r2(within1 / recent.length) : null,
      meanRepError: recent.length ? r2(recent.reduce((a, b) => a + b.repErr, 0) / recent.length) : null,
      meanRIRGapVsTarget: rirGaps.length ? r2(rirGaps.reduce((a, b) => a + b, 0) / rirGaps.length) : null,
      repsLostPerSet: drops.length ? r2(drops.reduce((a, b) => a + b, 0) / drops.length) : null,
    };
  }

  /* ---------- bodyweight trend (EMA) ---------- */
  function weightTrend(state) {
    const w = state.weighIns;
    if (!w.length) return { latest: null, emaSeries: [], lbPerWeek: null };
    let ema = w[0].lb;
    const series = w.map((x) => { ema = 0.25 * x.lb + 0.75 * ema; return { date: x.date, ema: r1(ema) }; });
    const cut = series.filter((p) => ageDays(p.date) <= 28);
    let lbPerWeek = null;
    if (cut.length >= 4) {
      const first = cut[0], last = cut[cut.length - 1];
      const weeks = Math.max(0.5, (new Date(last.date) - new Date(first.date)) / (7 * DAY));
      lbPerWeek = r2((last.ema - first.ema) / weeks);
    }
    return { latest: w[w.length - 1].lb, latestDate: w[w.length - 1].date, emaSeries: series.slice(-30), lbPerWeek };
  }

  /* ---------- cardio + adherence ---------- */
  function cardioSummary(state) {
    const wk = state.cardio.filter((c) => ageDays(c.date) <= 7);
    return {
      minutesThisWeek: wk.reduce((t, c) => t + (c.minutes || 0), 0),
      sessionsThisWeek: wk.length,
      recent: state.cardio.slice(-5).map((c) => ({ date: c.date.slice(0, 10), modality: c.modality, minutes: c.minutes, rpe: c.rpe })),
    };
  }
  function adherence(state) {
    const weeks = [0, 1, 2, 3].map((i) => state.sessions.filter((s) => { const a = ageDays(s.date); return a >= i * 7 && a < (i + 1) * 7; }).length);
    return { liftSessionsPerWeekLast4: weeks.reverse() };
  }

  /* ---------- exercise ROI ---------- */
  function exerciseROI(state) {
    return liftSummaries(state, 12)
      .filter((l) => l.sessions >= 3)
      .map((l) => ({ name: l.name, sessions: l.sessions, slope4wkLbPerWk: l.slope4wkLbPerWk, verdict: l.slope4wkLbPerWk == null ? "insufficient" : l.slope4wkLbPerWk > 1 ? "producing" : l.slope4wkLbPerWk > 0.2 ? "slow" : "flat" }));
  }

  /* ---------- nutrition ---------- */
  function nutritionSummary(state) {
    const meals = state.meals || [];
    const todayStr = new Date().toISOString().slice(0, 10);
    const sum = (list) => list.reduce((t, m) => ({ cal: t.cal + (m.calories || 0), p: t.p + (m.protein || 0), c: t.c + (m.carbs || 0), f: t.f + (m.fat || 0) }), { cal: 0, p: 0, c: 0, f: 0 });
    const todayMeals = meals.filter((m) => m.date.slice(0, 10) === todayStr);
    const t = sum(todayMeals);
    // last 7 full days (excluding today), only days with logs
    const byDay = {};
    meals.forEach((m) => { const d = m.date.slice(0, 10); if (d !== todayStr && ageDays(m.date) <= 8) (byDay[d] = byDay[d] || []).push(m); });
    const days = Object.keys(byDay);
    const dayTotals = days.map((d) => sum(byDay[d]));
    const avg = (k) => (dayTotals.length ? Math.round(dayTotals.reduce((a, b) => a + b[k], 0) / dayTotals.length) : null);
    return {
      targets: (state.nutrition && state.nutrition.targets) || null,
      today: { calories: Math.round(t.cal), protein: Math.round(t.p), carbs: Math.round(t.c), fat: Math.round(t.f), mealsLogged: todayMeals.length },
      last7d: { daysLogged: days.length, avgCalories: avg("cal"), avgProtein: avg("p") },
      recentMealNames: meals.slice(-14).map((m) => m.name),
      savedRecipes: (state.recipes || []).slice(0, 10).map((r) => r.name),
    };
  }

  /* ---------- THE DISTILLATION — context bundle for every AI call ---------- */
  function distill(state) {
    const ci = state.checkIns.find((x) => x.date === new Date().toISOString().slice(0, 10));
    return {
      unit: "lb",
      profile: state.profile,
      dietPhase: state.dietPhase,
      block: state.block,
      readinessToday: ci ? ci.readiness : null,
      activeNiggles: state.niggles.filter((n) => n.status !== "resolved").map((n) => ({ area: n.area, note: n.note, status: n.status, since: n.created })),
      bodyweight: weightTrend(state),
      nutrition: nutritionSummary(state),
      volume: { thisWeek: volumeThisWeek(state), lastWeek: volumeLastWeek(state), weeklyTargets: state.block.targets },
      muscleFreshness: muscleFreshness(state),
      lifts: liftSummaries(state, 10),
      predictionEngine: predictionMetrics(state),
      cardio: cardioSummary(state),
      adherence: adherence(state),
      recentSessions: state.sessions.slice(-10).map((s) => ({
        date: s.date.slice(0, 10), name: s.name,
        muscles: (s.muscles || []).map((m) => m.name),
        sets: (s.logged || []).map((x) => `${x.weight}x${x.reps}@${x.rir != null ? x.rir : "?"}`).join(", "),
        e1rm: sessionE1rm(s) ? r1(sessionE1rm(s)) : null,
      })),
      athleteModel: state.athleteModel.text || "(no notes yet — first weeks)",
      pendingCoachNotes: state.athleteModel.pendingNotes.map((n) => `[${n.date}] ${n.note}`),
      memory: {
        recentWeeklyRollups: state.rollups.weekly.slice(-4),
        careerSummary: state.rollups.career || "",
      },
      daysSinceLastWeeklyReview: state.weeklyReviews.length ? Math.round((now() - new Date(state.weeklyReviews[state.weeklyReviews.length - 1].date).getTime()) / DAY) : null,
    };
  }

  return {
    setE1rm, sessionE1rm, sessionVolume,
    volumeThisWeek, volumeLastWeek, muscleFreshness,
    liftSeries, liftSummaries, slopePerWeek, predictionMetrics,
    weightTrend, cardioSummary, adherence, exerciseROI,
    nutritionSummary, distill,
  };
})();

if (typeof window !== "undefined") window.Obs = Obs;
if (typeof module !== "undefined" && module.exports) module.exports = Obs;
