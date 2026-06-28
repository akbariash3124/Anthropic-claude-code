/* ============================================================
   Overload — an AI progressive-overload coach
   Vanilla JS, no build step. Data persists in localStorage.

   Flow: build a profile → run a guided calibration program
   (standard lifts to failure → a whole-body strength model) →
   the Claude API programs any exercise for you and continuously
   autoregulates from your actual reps + reps-in-reserve.
   ============================================================ */

(() => {
  "use strict";

  const STORAGE_KEY = "overload.v2";
  const API_URL = "https://api.anthropic.com/v1/messages";
  const ANTHROPIC_VERSION = "2023-06-01";

  // The standard calibration program — one benchmark per major movement.
  const DEFAULT_GROUPS = [
    { name: "Legs", benchmark: "Back Squat" },
    { name: "Chest", benchmark: "Bench Press" },
    { name: "Back", benchmark: "Barbell Row" },
    { name: "Shoulders", benchmark: "Overhead Press" },
    { name: "Posterior chain", benchmark: "Romanian Deadlift" },
    { name: "Arms", benchmark: "Barbell Curl" },
  ];

  // Reps-in-reserve buckets — how much the athlete had left in the tank.
  const RIR_OPTIONS = [
    { v: 0, label: "💥 To failure (0 left)" },
    { v: 1.5, label: "1–2 reps left" },
    { v: 3.5, label: "3–4 reps left" },
    { v: 5, label: "😌 5+ left — too easy" },
  ];
  const DEFAULT_RIR = 1.5;

  /* ---------------- state ---------------- */
  const blankState = () => ({
    settings: { unit: "kg", apiKey: "", model: "claude-opus-4-8" },
    profile: { height: null, weight: null, sex: "", experience: "Beginner" },
    groups: DEFAULT_GROUPS.map((g) => ({
      id: uid(),
      name: g.name,
      benchmark: g.benchmark,
      assessment: null, // { exercise, weight, reps, e1rm, date }
    })),
    // { id, groupId, exercise, date, plan, sets:[{weight,reps,targetReps,rir}] }
    sessions: [],
  });

  let state = load();
  let currentPlan = null; // { groupId, exercise, plan } awaiting logging
  let progressMetric = "e1rm";

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return blankState();
      const parsed = JSON.parse(raw);
      const base = blankState();
      return {
        settings: Object.assign(base.settings, parsed.settings || {}),
        profile: Object.assign(base.profile, parsed.profile || {}),
        groups: Array.isArray(parsed.groups) && parsed.groups.length ? parsed.groups : base.groups,
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      };
    } catch {
      return blankState();
    }
  }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  /* ---------------- helpers ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  const unit = () => state.settings.unit;
  const round1 = (n) => Math.round(n * 10) / 10;

  // Epley estimated 1RM; reps capped so high-rep sets don't distort the estimate.
  function e1rm(weight, reps) {
    if (weight <= 0 || reps <= 0) return 0;
    if (reps === 1) return weight;
    return weight * (1 + Math.min(reps, 12) / 30);
  }

  const sessionVolume = (s) => s.sets.reduce((t, x) => t + x.weight * x.reps, 0);
  const sessionTopSet = (s) => s.sets.reduce((m, x) => Math.max(m, x.weight), 0);
  const sessionBestE1rm = (s) => s.sets.reduce((m, x) => Math.max(m, e1rm(x.weight, x.reps)), 0);

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function groupById(id) { return state.groups.find((g) => g.id === id); }
  function sessionsFor(exercise) {
    return state.sessions
      .filter((s) => s.exercise.toLowerCase() === exercise.toLowerCase())
      .sort((a, b) => new Date(b.date) - new Date(a.date) || (b.id > a.id ? 1 : -1));
  }
  function lastSessionForExercise(exercise) { return sessionsFor(exercise)[0] || null; }

  const testedGroups = () => state.groups.filter((g) => g.assessment);
  const isCalibrated = () => testedGroups().length === state.groups.length;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 3400);
  }

  /* ============================================================
     CLAUDE API — workout prescription
     ============================================================ */
  const PLAN_SCHEMA = {
    type: "object",
    properties: {
      summary: { type: "string", description: "One-line summary of today's plan." },
      workingWeight: { type: "number", description: "Main working-set weight." },
      warmupSets: {
        type: "array",
        items: {
          type: "object",
          properties: { weight: { type: "number" }, reps: { type: "integer" } },
          required: ["weight", "reps"], additionalProperties: false,
        },
      },
      workingSets: {
        type: "array",
        items: {
          type: "object",
          properties: { weight: { type: "number" }, reps: { type: "integer" } },
          required: ["weight", "reps"], additionalProperties: false,
        },
      },
      progressionNote: { type: "string", description: "How this autoregulates from the last session, or how to start." },
      coachingTips: { type: "array", items: { type: "string" } },
    },
    required: ["summary", "workingWeight", "warmupSets", "workingSets", "progressionNote", "coachingTips"],
    additionalProperties: false,
  };

  const SYSTEM_PROMPT =
    "You are an elite strength & conditioning coach. You design highly individualised, " +
    "autoregulated, progressive-overload training.\n\n" +
    "You receive: the athlete's profile (height, bodyweight, sex, training experience); a " +
    "whole-body strength map built from standard lifts each taken to failure (so you know their " +
    "true capacity across movement patterns, not just one muscle); the target exercise for today; " +
    "and their most recent session for that exercise, including, per set, the target reps, the reps " +
    "they ACTUALLY completed, and their reps-in-reserve (RIR — how many more they could have done).\n\n" +
    "Reason about strength holistically: infer a sensible working load for the target exercise from " +
    "the most relevant calibration lifts and the athlete's bodyweight, remembering that accessory and " +
    "isolation movements use far less load than the big benchmark lifts.\n\n" +
    "Autoregulate aggressively and intelligently from the last session:\n" +
    "- If they BEAT the rep targets or reported high RIR (lots left in the tank), push harder — add " +
    "load and/or reps, more so the easier it was.\n" +
    "- If they hit targets at ~1–2 RIR, apply a standard small progression (smallest weight increment or +1 rep).\n" +
    "- If they FELL SHORT of the targets or hit true failure early, hold or reduce the load.\n" +
    "Every session should be a little harder than the last while staying achievable.\n\n" +
    "Prescribe warm-up sets and 2–4 working sets with specific weights and rep targets. Round every " +
    "weight to a realistic gym increment for the given unit. Keep coaching tips short and practical.";

  function calibrationMap() {
    return testedGroups().map((g) => {
      const a = g.assessment;
      const ratio = state.profile.weight ? round1(a.e1rm / state.profile.weight) : null;
      return {
        muscleGroup: g.name,
        benchmarkExercise: a.exercise,
        testWeight: a.weight,
        repsToFailure: a.reps,
        estimatedOneRepMax: round1(a.e1rm),
        oneRepMaxPerBodyweight: ratio,
        testedOn: a.date.slice(0, 10),
      };
    });
  }

  function lastSessionForAI(exercise) {
    const last = lastSessionForExercise(exercise);
    if (!last) return null;
    return {
      date: last.date.slice(0, 10),
      prescribedSummary: last.plan ? last.plan.summary : null,
      sets: last.sets.map((s) => ({
        weight: s.weight,
        targetReps: s.targetReps ?? null,
        actualReps: s.reps,
        repsInReserve: s.rir ?? null,
      })),
      bestEstimatedOneRepMax: round1(sessionBestE1rm(last)),
    };
  }

  async function generatePlan(group, exercise) {
    const key = state.settings.apiKey.trim();
    if (!key) throw new Error("NO_KEY");

    const payload = {
      unit: unit(),
      profile: {
        heightCm: state.profile.height,
        bodyweight: state.profile.weight,
        bodyweightUnit: unit(),
        sex: state.profile.sex || null,
        experience: state.profile.experience,
      },
      calibration: {
        complete: isCalibrated(),
        liftsTested: testedGroups().length,
        liftsTotal: state.groups.length,
        strengthMap: calibrationMap(),
      },
      targetMuscleGroup: group.name,
      targetExercise: exercise,
      lastSession: lastSessionForAI(exercise),
    };

    const userText =
      "Program today's session for this athlete and autoregulate from their last session.\n\n" +
      "```json\n" + JSON.stringify(payload, null, 2) + "\n```\n\n" +
      "Return the prescription as structured output.";

    const body = {
      model: state.settings.model || "claude-opus-4-8",
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
      output_config: { format: { type: "json_schema", schema: PLAN_SCHEMA } },
    };

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error?.message || ""; } catch {}
      const err = new Error(detail || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    if (data.stop_reason === "refusal") throw new Error("The model declined this request.");
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) throw new Error("No plan returned.");
    try { return JSON.parse(textBlock.text); } catch { throw new Error("Could not parse the plan."); }
  }

  /* ============================================================
     RENDERING
     ============================================================ */
  function renderAll() {
    renderGroupSelects();
    renderProfile();
    renderCalibration();
    renderTrain();
    renderProgress();
  }

  function renderGroupSelects() {
    const sel = $("#trainGroup");
    const prev = sel.value;
    sel.innerHTML = "";
    state.groups.forEach((g) => {
      const o = document.createElement("option");
      o.value = g.id; o.textContent = g.name;
      sel.appendChild(o);
    });
    if (prev && state.groups.some((g) => g.id === prev)) sel.value = prev;
  }

  /* ---------------- profile ---------------- */
  function renderProfile() {
    const p = state.profile;
    if (!$("#profHeight").dataset.touched) $("#profHeight").value = p.height ?? "";
    if (!$("#profWeight").dataset.touched) $("#profWeight").value = p.weight ?? "";
    $("#profSex").value = p.sex || "";
    $("#profExp").value = p.experience || "Beginner";
    const done = p.height && p.weight;
    $("#profileStatus").textContent = done ? "✓ saved" : "needed to personalise plans";
  }

  /* ---------------- calibration ---------------- */
  function renderCalibration() {
    const tested = testedGroups().length;
    const total = state.groups.length;
    $("#calibCount").textContent = `${tested} / ${total} lifts mapped`;
    $("#calibProgress").innerHTML = `<span style="width:${(tested / total) * 100}%"></span>`;

    $("#calibList").innerHTML = state.groups
      .map((g, i) => {
        const a = g.assessment;
        const result = a
          ? `<div class="ci-result"><div class="ci-1rm">${round1(a.e1rm)}<small> ${unit()} 1RM</small></div></div>`
          : "";
        const e1 = a ? `${a.weight}${unit()} × ${a.reps} · tested ${fmtDate(a.date)}` : "Enter one all-out set";
        return (
          `<div class="calib-item ${a ? "tested" : ""}">` +
            `<div class="ci-head">` +
              `<span class="ci-step">${a ? "✓" : i + 1}</span>` +
              `<div><div class="ci-name">${escapeHtml(g.benchmark)}</div><div class="ci-group">${escapeHtml(g.name)}</div></div>` +
              result +
            `</div>` +
            `<div class="ci-form" data-group="${g.id}">` +
              `<label class="field"><span>Weight</span><input type="number" class="ci-w" step="0.5" min="0" placeholder="0" value="${a ? a.weight : ""}" /></label>` +
              `<label class="field"><span>Reps to failure</span><input type="number" class="ci-r" step="1" min="1" placeholder="0" value="${a ? a.reps : ""}" /></label>` +
              `<button class="btn primary ci-save" data-group="${g.id}">${a ? "Update" : "Save test"}</button>` +
            `</div>` +
            `<p class="ci-e1rm">${e1}</p>` +
          `</div>`
        );
      })
      .join("");

    renderCalibDone();
  }

  function renderCalibDone() {
    const done = $("#calibDone");
    if (!isCalibrated()) { done.classList.add("hidden"); done.innerHTML = ""; return; }

    const bw = state.profile.weight;
    const ratios = bw
      ? testedGroups()
          .map((g) => `<div class="ratio"><div class="r-val">${round1(g.assessment.e1rm / bw)}×</div><div class="r-lbl">${escapeHtml(g.name)} / BW</div></div>`)
          .join("")
      : `<p class="hint">Add your bodyweight above to see strength-to-bodyweight ratios.</p>`;

    done.innerHTML =
      `<h3>✓ Whole-body strength mapped</h3>` +
      `<p>Overload now understands your strength across every movement pattern. Head to ` +
      `<b>Train</b> and ask for any exercise — sets, weights and reps are tailored to you, and ` +
      `recalibrate after every session.</p>` +
      (bw ? `<div class="ratios">${ratios}</div>` : ratios);
    done.classList.remove("hidden");
  }

  /* ---------------- train view ---------------- */
  function renderTrain() { renderRecentSessions(); }

  function renderRecentSessions() {
    const recent = [...state.sessions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
    const wrap = $("#recentSessions");
    wrap.innerHTML = recent.length
      ? recent.map(sessionCard).join("")
      : `<p class="empty">No sessions yet. Generate a plan and log your first workout.</p>`;
  }

  function sessionCard(s) {
    const g = groupById(s.groupId);
    const top = sessionTopSet(s);
    const pills = s.sets
      .map((set) => `<span class="pill${set.weight === top ? " best" : ""}">${set.weight}${unit()} × ${set.reps}</span>`)
      .join("");
    return (
      `<div class="session">` +
        `<div class="session-head">` +
          `<span class="name">${escapeHtml(s.exercise)}${g ? ` · ${escapeHtml(g.name)}` : ""}</span>` +
          `<span class="date">${fmtDate(s.date)}</span>` +
        `</div>` +
        `<div class="session-sets">${pills}</div>` +
        `<div class="session-meta">` +
          `<span>Volume ${round1(sessionVolume(s))}${unit()}</span>` +
          `<span>Best e1RM ${round1(sessionBestE1rm(s))}${unit()}</span>` +
        `</div>` +
      `</div>`
    );
  }

  function renderPlanCard(plan) {
    const warm = plan.warmupSets || [];
    const work = plan.workingSets || [];
    const tips = (plan.coachingTips || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
    $("#planCard").innerHTML =
      `<p class="pc-summary">${escapeHtml(plan.summary)}</p>` +
      `<span class="pc-coach">✦ AI coach · working weight ${round1(plan.workingWeight)}${unit()}</span>` +
      (warm.length
        ? `<div class="plan-section"><h4>Warm-up</h4><div class="plan-pills">` +
          warm.map((s) => `<span class="pill warmup">${s.weight}${unit()} × ${s.reps}</span>`).join("") + `</div></div>`
        : "") +
      `<div class="plan-section"><h4>Working sets</h4><div class="plan-pills">` +
      work.map((s, i) => `<span class="pill">Set ${i + 1}: ${s.weight}${unit()} × ${s.reps}</span>`).join("") + `</div></div>` +
      `<div class="plan-note"><b>Autoregulation —</b> ${escapeHtml(plan.progressionNote)}</div>` +
      (tips ? `<ul class="plan-tips">${tips}</ul>` : "");
    $("#planCard").classList.remove("hidden");
  }

  function rirSelect(i, selected) {
    const opts = RIR_OPTIONS.map(
      (o) => `<option value="${o.v}"${o.v === selected ? " selected" : ""}>${o.label}</option>`
    ).join("");
    return `<select class="log-rir" data-i="${i}">${opts}</select>`;
  }

  function renderLogPanel(plan, exercise) {
    $("#logExerciseName").textContent = exercise;
    const work = plan.workingSets || [];
    $("#logSets").innerHTML =
      `<p class="log-banner">For each set, record the reps you actually hit and how many you had left ` +
      `in the tank. Overload uses this to make the next session harder — or easier — to match you.</p>` +
      work
        .map(
          (s, i) =>
            `<li>` +
              `<span class="set-num">${i + 1}</span>` +
              `<span class="set-target">target ${s.weight}${unit()} × ${s.reps}</span>` +
              `<input type="number" class="log-w" data-i="${i}" step="0.5" min="0" value="${s.weight}" />` +
              `<span class="set-x">×</span>` +
              `<input type="number" class="log-r" data-i="${i}" step="1" min="0" value="${s.reps}" />` +
              rirSelect(i, DEFAULT_RIR) +
            `</li>`
        )
        .join("");
    $("#logPanel").classList.remove("hidden");
  }

  /* ---------------- progress view ---------------- */
  function progressExercises() {
    const seen = new Map();
    state.sessions.forEach((s) => { if (!seen.has(s.exercise.toLowerCase())) seen.set(s.exercise.toLowerCase(), s.exercise); });
    return [...seen.values()];
  }

  function renderProgress() {
    const sel = $("#progressExercise");
    const exercises = progressExercises();
    const prev = sel.value;
    sel.innerHTML = "";
    if (!exercises.length) {
      sel.innerHTML = `<option value="">No data yet</option>`;
      $("#progressStats").innerHTML = "";
      $("#chart").innerHTML = `<p class="empty">Log a few sessions to see your progress curve.</p>`;
      $("#progressHistory").innerHTML = "";
      return;
    }
    exercises.forEach((ex) => {
      const o = document.createElement("option");
      o.value = ex; o.textContent = ex;
      sel.appendChild(o);
    });
    if (prev && exercises.includes(prev)) sel.value = prev;

    const exercise = sel.value;
    const sessions = sessionsFor(exercise).slice().reverse(); // oldest -> newest
    renderStats(sessions, $("#progressStats"));
    renderChart(sessions, $("#chart"));
    $("#progressHistory").innerHTML = sessionsFor(exercise).map(sessionCard).join("");
  }

  const stat = (val, lbl, extra = "") =>
    `<div class="stat"><div class="val">${val}</div><div class="lbl">${lbl}</div>${extra}</div>`;

  function renderStats(sessions, el) {
    if (!sessions.length) { el.innerHTML = ""; return; }
    const bestE1rm = Math.max(...sessions.map(sessionBestE1rm));
    const bestWeight = Math.max(...sessions.map(sessionTopSet));
    const totalVol = sessions.reduce((t, s) => t + sessionVolume(s), 0);
    let deltaHtml = "";
    if (sessions.length >= 2) {
      const d = round1(sessionBestE1rm(sessions[sessions.length - 1]) - sessionBestE1rm(sessions[sessions.length - 2]));
      if (d !== 0) {
        const cls = d > 0 ? "up" : "down";
        deltaHtml = `<div class="delta ${cls}">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}${unit()} vs last</div>`;
      }
    }
    el.innerHTML =
      stat(round1(bestE1rm) + unit(), "Best est. 1RM", deltaHtml) +
      stat(round1(bestWeight) + unit(), "Heaviest set") +
      stat(round1(totalVol) + unit(), "Total volume") +
      stat(sessions.length, "Sessions");
  }

  function metricValue(s) {
    if (progressMetric === "volume") return sessionVolume(s);
    if (progressMetric === "topset") return sessionTopSet(s);
    return sessionBestE1rm(s);
  }

  function renderChart(sessions, el) {
    if (!sessions.length) { el.innerHTML = `<p class="empty">No data.</p>`; return; }
    const W = 680, H = 240, padL = 44, padR = 16, padT = 18, padB = 28;
    const pts = sessions.map((s) => ({ y: metricValue(s) }));
    const ys = pts.map((p) => p.y);
    let minY = Math.min(...ys), maxY = Math.max(...ys);
    if (minY === maxY) { minY = Math.max(0, minY - 1); maxY += 1; }
    const padY = (maxY - minY) * 0.12;
    minY = Math.max(0, minY - padY); maxY += padY;

    const n = pts.length;
    const sx = (i) => padL + (n === 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
    const sy = (y) => padT + (1 - (y - minY) / (maxY - minY)) * (H - padT - padB);

    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const y = padT + (i / 4) * (H - padT - padB);
      const val = round1(maxY - (i / 4) * (maxY - minY));
      grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#334155" stroke-width="1"/>` +
        `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="11">${val}</text>`;
    }
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(i).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
    const area = `${line} L ${sx(n - 1).toFixed(1)} ${(H - padB).toFixed(1)} L ${sx(0).toFixed(1)} ${(H - padB).toFixed(1)} Z`;
    const dots = pts.map((p, i) =>
      `<circle cx="${sx(i).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="4" fill="#38bdf8" stroke="#0f172a" stroke-width="2"><title>${round1(p.y)}${unit()} · ${fmtDate(sessions[i].date)}</title></circle>`).join("");
    const xLabels =
      `<text x="${sx(0)}" y="${H - 8}" text-anchor="middle" fill="#64748b" font-size="11">${fmtDate(sessions[0].date)}</text>` +
      (n > 1 ? `<text x="${sx(n - 1)}" y="${H - 8}" text-anchor="middle" fill="#64748b" font-size="11">${fmtDate(sessions[n - 1].date)}</text>` : "");
    el.innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress chart">` +
        `<defs><linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35"/><stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>` +
        `</linearGradient></defs>` +
        grid +
        `<path d="${area}" fill="url(#grad)"/>` +
        `<path d="${line}" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` +
        dots + xLabels +
      `</svg>`;
  }

  /* ============================================================
     EVENTS
     ============================================================ */
  function bindEvents() {
    $("#tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (btn) switchView(btn.dataset.view);
    });

    // profile
    $("#profHeight").addEventListener("input", () => { $("#profHeight").dataset.touched = "1"; });
    $("#profWeight").addEventListener("input", () => { $("#profWeight").dataset.touched = "1"; });
    $("#profileForm").addEventListener("submit", saveProfile);

    // calibration (delegated)
    $("#calibList").addEventListener("click", (e) => {
      const btn = e.target.closest(".ci-save");
      if (btn) saveCalibTest(btn.dataset.group);
    });

    // generate plan
    $("#generateBtn").addEventListener("click", onGenerate);
    $("#trainExercise").addEventListener("keydown", (e) => { if (e.key === "Enter") onGenerate(); });

    // log + save
    $("#saveSessionBtn").addEventListener("click", saveSession);
    $("#discardPlanBtn").addEventListener("click", discardPlan);

    // progress
    $("#progressExercise").addEventListener("change", renderProgress);
    $$(".chart-tabs .chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        $$(".chart-tabs .chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        progressMetric = chip.dataset.metric;
        renderProgress();
      })
    );

    // data menu
    $("#dataMenuBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#dataMenu").classList.toggle("hidden"); });
    document.addEventListener("click", () => $("#dataMenu").classList.add("hidden"));
    $("#dataMenu").addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (btn) handleDataAction(btn.dataset.action);
    });
    $("#importFile").addEventListener("change", importData);

    // settings
    $("#closeSettings").addEventListener("click", () => $("#settingsModal").classList.add("hidden"));
    $("#saveSettings").addEventListener("click", saveSettings);
    $("#settingsModal").addEventListener("click", (e) => { if (e.target.id === "settingsModal") $("#settingsModal").classList.add("hidden"); });
  }

  function switchView(view) {
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
    if (view === "progress") renderProgress();
  }

  function saveProfile(e) {
    e.preventDefault();
    state.profile.height = parseFloat($("#profHeight").value) || null;
    state.profile.weight = parseFloat($("#profWeight").value) || null;
    state.profile.sex = $("#profSex").value;
    state.profile.experience = $("#profExp").value;
    save();
    $("#profHeight").dataset.touched = "";
    $("#profWeight").dataset.touched = "";
    renderProfile();
    renderCalibration();
    toast("Profile saved");
  }

  function saveCalibTest(groupId) {
    const g = groupById(groupId);
    if (!g) return;
    const form = $(`.ci-form[data-group="${groupId}"]`);
    const weight = parseFloat($(".ci-w", form).value);
    const reps = parseInt($(".ci-r", form).value, 10);
    if (!(weight >= 0) || !(reps > 0)) { toast("Enter the weight and reps you hit to failure"); return; }

    g.assessment = { exercise: g.benchmark, weight, reps, e1rm: e1rm(weight, reps), date: new Date().toISOString() };
    save();
    renderCalibration();
    const remaining = state.groups.length - testedGroups().length;
    toast(
      remaining > 0
        ? `${g.benchmark} logged — ~${round1(g.assessment.e1rm)}${unit()} 1RM · ${remaining} lift${remaining === 1 ? "" : "s"} to go`
        : `Calibration complete — whole-body strength mapped 💪`
    );
  }

  async function onGenerate() {
    const g = groupById($("#trainGroup").value);
    const exercise = $("#trainExercise").value.trim();
    if (!g) { toast("Pick a muscle group"); return; }
    if (!exercise) { toast("Enter an exercise to train"); return; }
    if (!state.settings.apiKey.trim()) { openSettings(); toast("Add your Anthropic API key to generate plans"); return; }
    if (!testedGroups().length) { switchView("strength"); toast("Calibrate at least one lift first so plans fit your strength"); return; }

    const btn = $("#generateBtn");
    btn.disabled = true;
    const note = isCalibrated() ? "" : " (calibrate all lifts for the sharpest plans)";
    $("#trainStatus").innerHTML = `<span class="spinner"></span>Coaching your ${escapeHtml(g.name.toLowerCase())} session…${note}`;
    $("#planCard").classList.add("hidden");
    $("#logPanel").classList.add("hidden");

    try {
      const plan = await generatePlan(g, exercise);
      currentPlan = { groupId: g.id, exercise, plan };
      $("#trainStatus").textContent = "";
      renderPlanCard(plan);
      renderLogPanel(plan, exercise);
    } catch (err) {
      $("#trainStatus").textContent = "";
      if (err.message === "NO_KEY") openSettings();
      else if (err.status === 401) { toast("API key rejected — check it in AI settings"); openSettings(); }
      else toast(err.message || "Could not generate a plan");
    } finally {
      btn.disabled = false;
    }
  }

  function saveSession() {
    if (!currentPlan) return;
    const targets = currentPlan.plan.workingSets || [];
    const sets = [];
    $$("#logSets .log-w").forEach((wEl) => {
      const i = wEl.dataset.i;
      const w = parseFloat(wEl.value);
      const r = parseInt($(`#logSets .log-r[data-i="${i}"]`).value, 10);
      const rir = parseFloat($(`#logSets .log-rir[data-i="${i}"]`).value);
      if (w >= 0 && r > 0) {
        sets.push({ weight: w, reps: r, targetReps: targets[i] ? targets[i].reps : null, rir });
      }
    });
    if (!sets.length) { toast("Log at least one completed set"); return; }

    state.sessions.push({
      id: uid(),
      groupId: currentPlan.groupId,
      exercise: currentPlan.exercise,
      date: new Date().toISOString(),
      plan: currentPlan.plan,
      sets,
    });
    save();
    discardPlan();
    renderAll();
    toast("Session saved 💪 The next plan adapts to how that felt.");
  }

  function discardPlan() {
    currentPlan = null;
    $("#planCard").classList.add("hidden");
    $("#logPanel").classList.add("hidden");
    $("#planCard").innerHTML = "";
    $("#logSets").innerHTML = "";
  }

  /* ---------------- settings ---------------- */
  function openSettings() {
    $("#apiKeyInput").value = state.settings.apiKey;
    $("#unitSelect").value = state.settings.unit;
    $("#modelSelect").value = state.settings.model;
    $("#settingsModal").classList.remove("hidden");
  }
  function saveSettings() {
    state.settings.apiKey = $("#apiKeyInput").value.trim();
    state.settings.unit = $("#unitSelect").value;
    state.settings.model = $("#modelSelect").value;
    save();
    $("#settingsModal").classList.add("hidden");
    renderAll();
    toast("Settings saved");
  }

  /* ---------------- data ---------------- */
  function handleDataAction(action) {
    if (action === "settings") openSettings();
    else if (action === "export") exportData();
    else if (action === "import") $("#importFile").click();
    else if (action === "seed") seedData();
    else if (action === "reset") resetData();
  }

  function exportData() {
    const copy = JSON.parse(JSON.stringify(state));
    copy.settings.apiKey = ""; // never export the key
    const blob = new Blob([JSON.stringify(copy, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `overload-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Exported backup (API key excluded)");
  }

  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.groups) || !Array.isArray(data.sessions)) throw new Error();
        const key = state.settings.apiKey; // keep the local key
        const base = blankState();
        state = {
          settings: Object.assign(base.settings, data.settings || {}, { apiKey: key }),
          profile: Object.assign(base.profile, data.profile || {}),
          groups: data.groups,
          sessions: data.sessions,
        };
        save();
        renderAll();
        toast("Data imported");
      } catch {
        toast("Could not import that file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function resetData() {
    if (!confirm("Erase your profile, calibration and all sessions? This cannot be undone.")) return;
    const key = state.settings.apiKey;
    state = blankState();
    state.settings.apiKey = key;
    currentPlan = null;
    save();
    renderAll();
    discardPlan();
    toast("All data cleared");
  }

  /* ---------------- sample data ---------------- */
  function seedData() {
    if (state.sessions.length && !confirm("Replace current data with the sample dataset?")) return;
    const key = state.settings.apiKey;
    state = blankState();
    state.settings.apiKey = key;
    state.profile = { height: 178, weight: 80, sex: "Male", experience: "Intermediate" };

    // calibrate every lift
    const benches = { "Back Squat": [100, 5], "Bench Press": [80, 5], "Barbell Row": [70, 8],
      "Overhead Press": [50, 6], "Romanian Deadlift": [90, 8], "Barbell Curl": [30, 8] };
    state.groups.forEach((g, i) => {
      const [w, r] = benches[g.benchmark] || [40, 8];
      g.assessment = { exercise: g.benchmark, weight: w, reps: r, e1rm: e1rm(w, r), date: daysAgo(21 - i) };
    });

    const shoulders = state.groups.find((g) => g.name === "Shoulders");
    const plan = (summary, work) => ({
      summary, workingWeight: work[0].weight, warmupSets: [], workingSets: work,
      progressionNote: "Sample progression.", coachingTips: ["Control the eccentric.", "Full range of motion."],
    });
    const set = (w, target, actual, rir) => ({ weight: w, reps: actual, targetReps: target, rir });
    const mk = (g, exercise, date, sets) => ({
      id: uid(), groupId: g.id, exercise, date,
      plan: plan(`${exercise} day`, sets.map((s) => ({ weight: s.weight, reps: s.targetReps }))), sets,
    });

    state.sessions = [
      mk(shoulders, "Arnold Press", daysAgo(18), [set(16, 10, 11, 1.5), set(16, 10, 10, 1.5), set(16, 10, 9, 0)]),
      mk(shoulders, "Arnold Press", daysAgo(11), [set(16, 11, 12, 3.5), set(16, 11, 11, 1.5), set(16, 11, 10, 1.5)]),
      mk(shoulders, "Arnold Press", daysAgo(4), [set(18, 10, 10, 1.5), set(18, 10, 9, 1.5), set(18, 10, 8, 0)]),
    ];
    save();
    renderAll();
    toast("Loaded sample data");
  }
  function daysAgo(d) { return new Date(Date.now() - d * 86400000).toISOString(); }

  /* ---------------- boot ---------------- */
  bindEvents();
  renderAll();
  if (!state.settings.apiKey) {
    setTimeout(() => toast("Tip: add your Anthropic API key in ⋯ → AI settings to generate workouts"), 600);
  }
})();
