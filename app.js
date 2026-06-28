/* ============================================================
   app.js — UI + session orchestration (Sections 3–5).
   Wires the pure Engine and the Data repository together. The AI
   (Recognize) is used ONLY to classify unknown exercises; it never
   touches a weight or rep target. Display unit: pounds (lb).
   ============================================================ */

(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const round1 = (n) => Math.round(n * 10) / 10;
  const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const titleCasePattern = (p) => ({ vertical_push: "Vertical push", horizontal_push: "Horizontal push", vertical_pull: "Vertical pull", horizontal_pull: "Horizontal pull", squat: "Squat", hinge: "Hinge" }[p] || p);

  let currentExercise = null;
  let currentRx = null;          // { totalLoad, repLow, repHigh, action|deload, mode, bodyweight }
  let pendingPhoto = null;       // data URL
  let pendingIdentified = null;  // {name,pattern,loadType,coeff,...}
  let progressMetric = "e1rm";

  /* ---------- display helpers (lb) ---------- */
  function loadLabel(loadType, totalLoad) {
    const d = Engine.toDisplayLoad(totalLoad, loadType);
    return loadType === "dumbbell_pair" ? `${round1(d)}<small> lb/hand</small>` : `${round1(d)}<small> lb</small>`;
  }
  function displayWeight(loadType, totalLoad) { return round1(Engine.toDisplayLoad(totalLoad, loadType)); }
  function weightUnitHint(loadType) { return loadType === "dumbbell_pair" ? "lb/hand" : "lb"; }

  function rirSelect(cls, selected) {
    const opts = [0, 1, 2, 3, 4, 5].map((v) =>
      `<option value="${v}"${v === selected ? " selected" : ""}>${v === 0 ? "0 (failure)" : v === 5 ? "5+ (easy)" : v}</option>`).join("");
    return `<select class="${cls}">${opts}</select>`;
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 3600);
  }

  /* ---------- height conversion ---------- */
  function cmToFtIn(cm) {
    if (!cm) return { ft: "", in: "" };
    const totalIn = cm / 2.54;
    return { ft: Math.floor(totalIn / 12), in: Math.round(totalIn % 12) };
  }
  function ftInToCm(ft, inch) {
    const f = parseInt(ft, 10) || 0, i = parseInt(inch, 10) || 0;
    return f || i ? round1((f * 12 + i) * 2.54) : null;
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function renderAll() {
    renderProfile();
    renderCalibration();
    renderExerciseSelect();
    renderModeSelectors();
    renderRecent();
    renderProgress();
  }

  function renderModeSelectors() {
    const mode = Data.user().defaultMode || "hypertrophy";
    $("#profMode").value = mode;
    if (!$("#trainMode").dataset.touched) $("#trainMode").value = mode;
  }

  /* ---------- profile ---------- */
  function renderProfile() {
    const u = Data.user();
    const { ft, in: inch } = cmToFtIn(u.heightCm);
    if (!$("#profFt").dataset.touched) { $("#profFt").value = ft; $("#profIn").value = inch; }
    if (!$("#profWeight").dataset.touched) $("#profWeight").value = u.weightLb ?? "";
    $("#profileStatus").textContent = u.weightLb ? "✓ saved" : "optional, but helps sanity-check loads";
  }

  /* ---------- calibration (§3) ---------- */
  function renderCalibration() {
    const tested = Engine.PATTERNS.filter((p) => Data.patternEstimate(p) != null).length;
    const total = Engine.PATTERNS.length;
    $("#calibCount").textContent = `${tested} / ${total} patterns mapped`;
    $("#calibProgress").innerHTML = `<span style="width:${(tested / total) * 100}%"></span>`;

    $("#calibList").innerHTML = Engine.PATTERNS.map((pattern, i) => {
      const ref = Engine.referenceExercise(pattern);
      const est = Data.patternEstimate(pattern);
      const tested = est != null;
      const result = tested ? `<div class="ci-result"><div class="ci-1rm">${round1(est)}<small> lb 1RM</small></div></div>` : "";
      return (
        `<div class="calib-item ${tested ? "tested" : ""}">` +
          `<div class="ci-head">` +
            `<span class="ci-step">${tested ? "✓" : i + 1}</span>` +
            `<div><div class="ci-name">${escapeHtml(ref.name)}</div><div class="ci-group">${titleCasePattern(pattern)}</div></div>` +
            result +
          `</div>` +
          `<div class="ci-form" data-pattern="${pattern}">` +
            `<label class="field"><span>Weight (lb)</span><input type="number" class="ci-w" step="1" min="0" placeholder="0" /></label>` +
            `<label class="field"><span>Reps (5–8)</span><input type="number" class="ci-r" step="1" min="1" placeholder="6" /></label>` +
            `<label class="field"><span>Reps in reserve</span>${rirSelect("ci-rir", 1)}</label>` +
            `<button class="btn primary ci-save" data-pattern="${pattern}">${tested ? "Retest" : "Save test"}</button>` +
          `</div>` +
        `</div>`
      );
    }).join("");

    const done = $("#calibDone");
    if (tested === total) {
      const bw = Data.user().weightLb;
      const ratios = bw
        ? Engine.PATTERNS.map((p) => {
            const ref = Engine.referenceExercise(p);
            return `<div class="ratio"><div class="r-val">${round1(Data.patternEstimate(p) / bw)}×</div><div class="r-lbl">${escapeHtml(ref.name)}</div></div>`;
          }).join("")
        : `<p class="hint">Add bodyweight above to see strength-to-bodyweight ratios.</p>`;
      done.innerHTML = `<h3>✓ Strength map complete</h3><p>Every pattern is calibrated. Head to <b>Train</b> — pick or photograph any exercise and you'll get a load and rep target tuned to you.</p>${bw ? `<div class="ratios">${ratios}</div>` : ratios}`;
      done.classList.remove("hidden");
    } else { done.classList.add("hidden"); done.innerHTML = ""; }
  }

  /* ---------- exercise select ---------- */
  function renderExerciseSelect() {
    const sel = $("#exSelect");
    const prev = sel.value;
    const byPattern = {};
    Data.exercises().forEach((e) => { (byPattern[e.pattern] = byPattern[e.pattern] || []).push(e); });
    sel.innerHTML = `<option value="">— choose —</option>` + Engine.PATTERNS.map((p) => {
      const list = (byPattern[p] || []).map((e) => `<option value="${e.id}">${escapeHtml(e.name)}${e.custom ? " ★" : ""}</option>`).join("");
      return `<optgroup label="${titleCasePattern(p)}">${list}</optgroup>`;
    }).join("");
    if (prev && Data.getExercise(prev)) sel.value = prev;
  }

  /* ---------- recent sessions ---------- */
  function renderRecent() {
    const recent = Data.allLogs().slice(-6).reverse();
    $("#recentSessions").innerHTML = recent.length
      ? recent.map(sessionCard).join("")
      : `<p class="empty">No sessions yet. Pick an exercise and log your first set.</p>`;
  }
  function sessionCard(log) {
    const ex = Data.getExercise(log.exerciseId);
    const lt = ex ? ex.loadType : "barbell";
    const pills = log.sets.map((s) =>
      `<span class="pill">${displayWeight(lt, s.weight)}${lt === "dumbbell_pair" ? "/hand" : ""}×${s.reps}${s.rir != null ? ` @${s.rir}` : ""}</span>`).join("");
    const vol = round1(log.sets.reduce((t, s) => t + s.weight * s.reps, 0));
    return (
      `<div class="session"><div class="session-head">` +
        `<span class="name">${escapeHtml(ex ? ex.name : "?")}${log.deload ? " · deload" : ""}</span>` +
        `<span class="date">${fmtDate(log.date)}</span></div>` +
        `<div class="session-sets">${pills}</div>` +
        `<div class="session-meta"><span>Volume ${vol} lb</span>${log.sessionEstimate1RM ? `<span>Est 1RM ${round1(log.sessionEstimate1RM)} lb</span>` : ""}</div>` +
      `</div>`
    );
  }

  /* ============================================================
     WORKOUT LOOP (§4)
     ============================================================ */
  function selectExercise(ex) {
    currentExercise = ex;
    pendingIdentified = null;
    $("#identifyResult").classList.add("hidden");
    buildPrescription();
  }

  function buildPrescription() {
    const ex = currentExercise;
    const panel = $("#prescribePanel");
    if (!ex) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    $("#rxExercise").textContent = ex.name;
    $("#rxMeta").textContent = `${titleCasePattern(ex.pattern)} · ${ex.loadType.replace("_", " ")}`;
    const mode = $("#trainMode").value;
    const card = $("#prescribeCard");

    // Bodyweight path (Section-4 sub-decision: reps progression, not %1RM)
    if (ex.loadType === "bodyweight") {
      const logs = Data.logsForExercise(ex.id);
      const lastBest = logs.length ? Math.max(...logs[logs.length - 1].sets.map((s) => s.reps)) : 0;
      const target = lastBest ? lastBest + 1 : 8;
      currentRx = { bodyweight: true, repTarget: target, mode };
      card.innerHTML =
        `<div class="rx"><span class="tag start">Bodyweight</span>` +
        `<div class="rx-load">${target}<small> reps</small></div>` +
        `<div class="rx-coach"><b>Reps first.</b> Beat ${lastBest || "your"} last time. When you clear ${target}+ clean reps on every set, add a rep or load up.</div></div>`;
      renderLogInputs([{ reps: target, rir: 1 }, { reps: target, rir: 1 }, { reps: target, rir: 1 }]);
      return;
    }

    const resolved = Data.resolve1RM(ex);
    if (resolved == null) {
      currentRx = null;
      card.innerHTML =
        `<div class="notice"><b>${titleCasePattern(ex.pattern)} isn't calibrated yet.</b><br>` +
        `Do one calibration set for this movement pattern and every exercise in it becomes prescribable.` +
        `<br><button class="btn primary" id="goCalibrate">Calibrate ${titleCasePattern(ex.pattern).toLowerCase()}</button></div>`;
      $("#logSets").innerHTML = "";
      $("#logActions").style.display = "none";
      $("#goCalibrate").addEventListener("click", () => switchView("calibrate"));
      return;
    }
    $("#logActions").style.display = "";

    const isLower = Engine.isLowerPattern(ex.pattern);
    const st = Data.exerciseState(ex.id);
    const base = Engine.prescribe(resolved, mode, ex.loadType, isLower);

    if (Data.patternDeloadPending(ex.pattern)) {
      const working = (st && st.lastPrescribedTotal) || base.totalLoad;
      const dp = Engine.deloadPrescription(working, mode, ex.loadType, isLower);
      currentRx = { totalLoad: dp.totalLoad, repLow: dp.reps, repHigh: dp.reps, deload: true, mode };
      card.innerHTML = rxCard("deload", ex, dp.totalLoad, dp.reps, dp.reps,
        `<b>Deload.</b> Strength stalled or dipped on this pattern, so back off to ~88% for one clean, easy session (RIR 3). We resume from here next time.`);
    } else {
      const totalLoad = st && st.nextWeightTotal != null ? st.nextWeightTotal : base.totalLoad;
      const action = st ? st.lastAction : "start";
      currentRx = { totalLoad, repLow: base.repLow, repHigh: base.repHigh, action, mode };
      card.innerHTML = rxCard(action, ex, totalLoad, base.repLow, base.repHigh, coachLine(action, base));
    }
    const start = { reps: currentRx.repLow, rir: 1, w: displayWeight(ex.loadType, currentRx.totalLoad) };
    renderLogInputs([start, start, start]);
  }

  function rxCard(tagKey, ex, totalLoad, repLow, repHigh, coach) {
    const tag = tagKey === "deload" ? "deload" : tagKey;
    const label = { add_load: "Add load", hold_push_reps: "Push reps", hold_retry: "Retry", start: "Start", deload: "Deload" }[tagKey] || "Start";
    const reps = repLow === repHigh ? `${repLow}` : `${repLow}–${repHigh}`;
    return (
      `<div class="rx ${tagKey === "deload" ? "deload" : ""}">` +
        `<span class="tag ${tag}">${label}</span>` +
        `<div class="rx-load">${loadLabel(ex.loadType, totalLoad)}</div>` +
        `<div class="rx-reps">${reps} reps</div>` +
        `<div class="rx-coach">${coach}</div>` +
      `</div>`
    );
  }
  function coachLine(action, base) {
    if (action === "start") return `<b>First time here.</b> Start at the bottom of the range (${base.repLow}). The engine dials your load in within 2–3 sessions.`;
    if (action === "add_load") return `<b>You earned it.</b> New load — reset to ${base.repLow} reps and build back up.`;
    if (action === "hold_push_reps") return `<b>Same weight, more reps.</b> Hit ${base.repHigh} on every set at RIR ≥ 1 to unlock more load next time.`;
    if (action === "hold_retry") return `<b>Own this weight.</b> Last time was a grind or came up short — repeat it cleanly before we add anything.`;
    return `Aim for the bottom of the range.`;
  }

  function renderLogInputs(rows) {
    const ex = currentExercise;
    const bw = ex.loadType === "bodyweight";
    $("#logSets").innerHTML =
      `<p class="log-banner">Log what you actually did, set by set — weight, reps, and reps-in-reserve (how many you had left). The engine recalibrates from this.</p>` +
      rows.map((r, i) => logRow(i, r, bw, ex.loadType)).join("");
  }
  function logRow(i, r, bw, loadType) {
    const wInput = bw ? "" :
      `<input type="number" class="log-w" step="0.5" min="0" value="${r.w != null ? r.w : ""}" placeholder="0" /><span class="set-x">×</span>`;
    return (
      `<li><span class="set-num">${i + 1}</span>` +
        (bw ? "" : `<span class="set-target">${weightUnitHint(loadType)}</span>`) +
        wInput +
        `<input type="number" class="log-r" step="1" min="0" value="${r.reps != null ? r.reps : ""}" placeholder="reps" />` +
        rirSelect("log-rir", r.rir != null ? r.rir : 1) +
      `</li>`
    );
  }

  function collectSets() {
    const ex = currentExercise;
    const bw = ex.loadType === "bodyweight";
    const out = [];
    $$("#logSets li").forEach((li) => {
      const reps = parseInt($(".log-r", li).value, 10);
      const rir = parseInt($(".log-rir", li).value, 10);
      if (!(reps > 0)) return;
      let total = 0;
      if (!bw) {
        const dw = parseFloat($(".log-w", li).value);
        if (!(dw >= 0)) return;
        total = Engine.toTotalLoad(dw, ex.loadType);
      }
      out.push({ weight: total, reps, rir: isNaN(rir) ? 0 : rir });
    });
    return out;
  }

  function saveSession() {
    const ex = currentExercise;
    if (!ex || !currentRx) return;
    const sets = collectSets();
    if (!sets.length) { toast("Log at least one set"); return; }
    const mode = currentRx.mode;
    const pattern = ex.pattern;
    const isLower = Engine.isLowerPattern(pattern);

    // Bodyweight: log only, simple reps progression (no %1RM, no estimate).
    if (currentRx.bodyweight) {
      Data.addLog({ exerciseId: ex.id, date: new Date().toISOString(), sets, sessionEstimate1RM: null, trusted: false });
      finishSave("Logged 💪 Beat it next time.");
      return;
    }

    const repLow = currentRx.repLow, repHigh = currentRx.repHigh;
    const prescribedTotal = currentRx.totalLoad;
    const resolvedBefore = Data.resolve1RM(ex);

    // §1.1 per-set estimates; session estimate = best TRUSTED estimate.
    const ests = sets.map((s) => Engine.estimate1RM(s.weight, s.reps, s.rir));
    const trustedEsts = ests.filter((e) => e.trusted).map((e) => e.oneRM);
    const trusted = trustedEsts.length > 0;
    const sessionEstimate1RM = trusted ? Math.max(...trustedEsts) : null;

    Data.addLog({ exerciseId: ex.id, date: new Date().toISOString(), sets, sessionEstimate1RM, trusted, prescribedTotal, mode, deload: !!currentRx.deload });

    if (currentRx.deload) {
      // One deload session done → clear flag, record event, resume from deloaded weight.
      Data.setPatternDeloadPending(pattern, false);
      Data.addDeload(pattern);
      Data.setExerciseState(ex.id, { nextWeightTotal: prescribedTotal, lastAction: "hold_push_reps", lastPrescribedTotal: prescribedTotal });
      finishSave("Deload done — back to building.");
      return;
    }

    const st = Data.exerciseState(ex.id);
    const prevPrescribed = st && st.lastPrescribedTotal != null ? st.lastPrescribedTotal : 0;

    if (trusted) {
      // §1.5 blend the per-exercise correction (trusted only).
      const base1RM = Data.correction(ex.id) != null ? Data.correction(ex.id) : resolvedBefore;
      Data.setCorrection(ex.id, Engine.updateEstimate(base1RM, sessionEstimate1RM));
      // Re-derive the pattern estimate by back-propagating through the coefficient.
      if (ex.coeff) {
        const impliedPattern = sessionEstimate1RM / ex.coeff;
        Data.setPatternEstimate(pattern, impliedPattern, { ema: true, addedLoad: prescribedTotal > prevPrescribed });
      }
    }

    // §1.5 double progression (runs regardless of trust — it's pure load logic).
    const hitAll = sets.every((s) => s.reps >= repHigh);
    const minRir = Math.min(...sets.map((s) => s.rir));
    const missedLow = sets.some((s) => s.reps < repLow);
    const np = Engine.nextProgression({
      mode, loadType: ex.loadType, isLowerBarbell: isLower,
      prescribedWeightTotal: prescribedTotal, repHigh,
      hitAllSetsAtRepHigh: hitAll, minRirAcrossSets: minRir, missedRepLow: missedLow,
    });
    Data.setExerciseState(ex.id, { nextWeightTotal: np.nextWeightTotal, lastAction: np.action, lastPrescribedTotal: prescribedTotal });

    // §1.7 deload check for the pattern (only meaningful once history exists).
    const rec = Data.patternRecord(pattern);
    const dl = Engine.checkDeload({ storedHistory: rec.history, addedLoadFlags: rec.addedFlags, weeksSinceLastDeload: Data.weeksSinceLastDeload(pattern) });
    if (dl.deload) Data.setPatternDeloadPending(pattern, true);

    const msg = {
      add_load: "Saved — you earned more weight next time. 💪",
      hold_push_reps: "Saved — same weight, chase the reps next time.",
      hold_retry: "Saved — we'll retry this weight.",
    }[np.action] || "Session saved.";
    finishSave(dl.deload ? `Saved. Heads up: a deload is queued (${dl.reason}).` : msg);
  }

  function finishSave(msg) {
    renderAll();
    buildPrescription(); // refresh the card to reflect the new state
    toast(msg);
  }

  /* ============================================================
     IDENTIFY (AI — metadata only)
     ============================================================ */
  function readPhoto(file) {
    const reader = new FileReader();
    reader.onload = () => { pendingPhoto = reader.result; $("#identifyStatus").textContent = "📷 photo ready — tap Identify"; };
    reader.readAsDataURL(file);
  }

  async function onIdentify() {
    const name = $("#exType").value.trim();
    if (!name && !pendingPhoto) { toast("Type a name or add a photo"); return; }
    const s = Data.settings();
    if (!s.apiKey) { openSettings(); toast("Add your Anthropic API key to identify exercises"); return; }

    const btn = $("#identifyBtn");
    btn.disabled = true;
    $("#identifyStatus").innerHTML = `<span class="spinner"></span>Identifying…`;
    try {
      const r = await Recognize.identify({ name, imageDataUrl: pendingPhoto, apiKey: s.apiKey, model: s.model });
      pendingIdentified = r;
      $("#identifyStatus").textContent = "";
      const coeffTxt = r.coeff == null ? "bodyweight" : `coeff ${round1(r.coeff)}`;
      $("#identifyResult").innerHTML =
        `<div class="ir-name">${escapeHtml(r.name)}<span class="ir-conf ${r.confidence}">${r.confidence}</span></div>` +
        `<div class="ir-meta">${titleCasePattern(r.pattern)} · ${r.loadType.replace("_", " ")} · ${coeffTxt}</div>` +
        `<p class="ir-notes">${escapeHtml(r.notes || "")}</p>` +
        `<div class="ir-actions"><button class="btn primary" id="addIdentified">Add &amp; train this</button>` +
        `<button class="btn ghost" id="dismissIdentified">Not quite</button></div>`;
      $("#identifyResult").classList.remove("hidden");
      $("#addIdentified").addEventListener("click", addIdentified);
      $("#dismissIdentified").addEventListener("click", () => { $("#identifyResult").classList.add("hidden"); pendingIdentified = null; });
    } catch (err) {
      $("#identifyStatus").textContent = "";
      if (err.message === "NO_KEY") openSettings();
      else if (err.status === 401) { toast("API key rejected — check AI settings"); openSettings(); }
      else toast(err.message || "Could not identify that");
    } finally {
      btn.disabled = false;
    }
  }

  function addIdentified() {
    if (!pendingIdentified) return;
    const r = pendingIdentified;
    const ex = Data.addCustomExercise({ name: r.name, pattern: r.pattern, coeff: r.coeff, loadType: r.loadType });
    renderExerciseSelect();
    $("#exSelect").value = ex.id;
    pendingPhoto = null;
    $("#exType").value = "";
    $("#identifyResult").classList.add("hidden");
    selectExercise(ex);
    toast(`Added ${ex.name}`);
  }

  /* ============================================================
     PROGRESS (§5)
     ============================================================ */
  function loggedExercises() {
    const ids = [...new Set(Data.allLogs().map((l) => l.exerciseId))];
    return ids.map((id) => Data.getExercise(id)).filter(Boolean);
  }

  function renderProgress() {
    const sel = $("#progressExercise");
    const exs = loggedExercises();
    const prev = sel.value;
    sel.innerHTML = "";
    if (!exs.length) {
      sel.innerHTML = `<option value="">No data yet</option>`;
      $("#progressStats").innerHTML = "";
      $("#chart").innerHTML = `<p class="empty">Log sessions to see your strength curve.</p>`;
      $("#progressHistory").innerHTML = "";
      return;
    }
    exs.forEach((e) => { const o = document.createElement("option"); o.value = e.id; o.textContent = e.name; sel.appendChild(o); });
    if (prev && exs.some((e) => e.id === prev)) sel.value = prev;

    const ex = Data.getExercise(sel.value) || exs[0];
    const logs = Data.logsForExercise(ex.id);
    renderProgressStats(ex, logs);
    renderChart(ex, logs);
    $("#progressHistory").innerHTML = logs.slice().reverse().map(sessionCard).join("");
  }

  function renderProgressStats(ex, logs) {
    const el = $("#progressStats");
    if (!logs.length) { el.innerHTML = ""; return; }
    const ests = logs.map((l) => l.sessionEstimate1RM).filter((v) => v != null);
    const bestE = ests.length ? Math.max(...ests) : null;
    const bestW = Math.max(...logs.flatMap((l) => l.sets.map((s) => Engine.toDisplayLoad(s.weight, ex.loadType))));
    const vol = logs.reduce((t, l) => t + l.sets.reduce((a, s) => a + s.weight * s.reps, 0), 0);
    const stat = (v, k) => `<div class="stat"><div class="val">${v}</div><div class="lbl">${k}</div></div>`;
    el.innerHTML =
      (bestE != null ? stat(round1(bestE) + " lb", "Best est. 1RM") : "") +
      stat(round1(bestW) + (ex.loadType === "dumbbell_pair" ? " lb/hd" : " lb"), "Heaviest set") +
      stat(round1(vol) + " lb", "Total volume") +
      stat(logs.length, "Sessions");
  }

  function renderChart(ex, logs) {
    const el = $("#chart");
    const series = logs.map((l) => ({
      date: l.date,
      e1rm: l.sessionEstimate1RM,
      volume: l.sets.reduce((t, s) => t + s.weight * s.reps, 0),
    }));
    const pts = series.map((s) => ({ date: s.date, y: progressMetric === "volume" ? s.volume : s.e1rm }))
      .filter((p) => p.y != null);
    if (pts.length < 1) { el.innerHTML = `<p class="empty">Not enough trusted data for this view yet.</p>`; return; }

    const W = 680, H = 240, padL = 46, padR = 16, padT = 18, padB = 28;
    const ys = pts.map((p) => p.y);
    let minY = Math.min(...ys), maxY = Math.max(...ys);
    if (minY === maxY) { minY = Math.max(0, minY - 1); maxY += 1; }
    const padY = (maxY - minY) * 0.12; minY = Math.max(0, minY - padY); maxY += padY;
    const n = pts.length;
    const sx = (i) => padL + (n === 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
    const sy = (y) => padT + (1 - (y - minY) / (maxY - minY)) * (H - padT - padB);

    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const y = padT + (i / 4) * (H - padT - padB);
      const val = round1(maxY - (i / 4) * (maxY - minY));
      grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#334155"/><text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="11">${val}</text>`;
    }
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(i).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
    const area = `${line} L ${sx(n - 1).toFixed(1)} ${(H - padB).toFixed(1)} L ${sx(0).toFixed(1)} ${(H - padB).toFixed(1)} Z`;
    const dots = pts.map((p, i) => `<circle cx="${sx(i).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="4" fill="#38bdf8" stroke="#0f172a" stroke-width="2"><title>${round1(p.y)} · ${fmtDate(p.date)}</title></circle>`).join("");

    // deload markers for this exercise's pattern
    const deloads = Data.deloadsFor(ex.pattern);
    const t0 = new Date(pts[0].date).getTime(), t1 = new Date(pts[n - 1].date).getTime();
    const markers = deloads.map((d) => {
      const t = new Date(d.date).getTime();
      if (t1 === t0) return "";
      const frac = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
      const x = padL + frac * (W - padL - padR);
      return `<polygon class="svg-deload" points="${x - 5},${padT} ${x + 5},${padT} ${x},${padT + 9}"><title>Deload · ${fmtDate(d.date)}</title></polygon><line x1="${x}" y1="${padT}" x2="${x}" y2="${H - padB}" stroke="#facc15" stroke-dasharray="3 3" opacity="0.5"/>`;
    }).join("");

    const xl = `<text x="${sx(0)}" y="${H - 8}" text-anchor="middle" fill="#64748b" font-size="11">${fmtDate(pts[0].date)}</text>` +
      (n > 1 ? `<text x="${sx(n - 1)}" y="${H - 8}" text-anchor="middle" fill="#64748b" font-size="11">${fmtDate(pts[n - 1].date)}</text>` : "");
    el.innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" role="img"><defs><linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35"/><stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/></linearGradient></defs>` +
      grid + `<path d="${area}" fill="url(#grad)"/><path d="${line}" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` +
      markers + dots + xl + `</svg>`;
  }

  /* ============================================================
     EVENTS
     ============================================================ */
  function switchView(view) {
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
    if (view === "progress") renderProgress();
  }

  function bindEvents() {
    $("#tabs").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (b) switchView(b.dataset.view); });

    $("#profFt").addEventListener("input", () => { $("#profFt").dataset.touched = "1"; });
    $("#profIn").addEventListener("input", () => { $("#profFt").dataset.touched = "1"; });
    $("#profWeight").addEventListener("input", () => { $("#profWeight").dataset.touched = "1"; });
    $("#profileForm").addEventListener("submit", saveProfile);

    $("#calibList").addEventListener("click", (e) => { const b = e.target.closest(".ci-save"); if (b) saveCalibration(b.dataset.pattern); });

    $("#exSelect").addEventListener("change", (e) => {
      const ex = Data.getExercise(e.target.value);
      if (ex) selectExercise(ex); else { currentExercise = null; $("#prescribePanel").classList.add("hidden"); }
    });
    $("#trainMode").addEventListener("change", () => { $("#trainMode").dataset.touched = "1"; if (currentExercise) buildPrescription(); });

    $("#photoBtn").addEventListener("click", () => $("#photoInput").click());
    $("#photoInput").addEventListener("change", (e) => { if (e.target.files[0]) readPhoto(e.target.files[0]); e.target.value = ""; });
    $("#identifyBtn").addEventListener("click", onIdentify);
    $("#exType").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onIdentify(); } });

    $("#addSetBtn").addEventListener("click", () => {
      const ex = currentExercise; if (!ex || !currentRx) return;
      const li = document.createElement("li");
      const i = $$("#logSets li").length;
      const bw = ex.loadType === "bodyweight";
      li.innerHTML = logRow(i, bw ? { reps: currentRx.repTarget, rir: 1 } : { reps: currentRx.repLow, rir: 1, w: displayWeight(ex.loadType, currentRx.totalLoad) }, bw, ex.loadType).replace(/^<li>|<\/li>$/g, "");
      $("#logSets").appendChild(li);
    });
    $("#saveSessionBtn").addEventListener("click", saveSession);

    $("#progressExercise").addEventListener("change", renderProgress);
    $$(".chart-tabs .chip").forEach((c) => c.addEventListener("click", () => {
      $$(".chart-tabs .chip").forEach((x) => x.classList.remove("active"));
      c.classList.add("active"); progressMetric = c.dataset.metric; renderProgress();
    }));

    $("#dataMenuBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#dataMenu").classList.toggle("hidden"); });
    document.addEventListener("click", () => $("#dataMenu").classList.add("hidden"));
    $("#dataMenu").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) handleData(b.dataset.action); });
    $("#importFile").addEventListener("change", importData);

    $("#closeSettings").addEventListener("click", () => $("#settingsModal").classList.add("hidden"));
    $("#saveSettings").addEventListener("click", saveSettings);
    $("#settingsModal").addEventListener("click", (e) => { if (e.target.id === "settingsModal") $("#settingsModal").classList.add("hidden"); });
  }

  function saveProfile(e) {
    e.preventDefault();
    Data.setUser({
      heightCm: ftInToCm($("#profFt").value, $("#profIn").value),
      weightLb: parseFloat($("#profWeight").value) || null,
      defaultMode: $("#profMode").value,
    });
    $("#profFt").dataset.touched = ""; $("#profWeight").dataset.touched = "";
    renderProfile(); renderCalibration(); renderModeSelectors();
    toast("Profile saved");
  }

  function saveCalibration(pattern) {
    const form = $(`.ci-form[data-pattern="${pattern}"]`);
    const w = parseFloat($(".ci-w", form).value);
    const r = parseInt($(".ci-r", form).value, 10);
    const rir = parseInt($(".ci-rir", form).value, 10) || 0;
    if (!(w >= 0) || !(r > 0)) { toast("Enter the weight and reps you hit"); return; }
    const est = Engine.estimate1RM(w, r, rir);
    if (!est.trusted) { toast(`That's ${est.effectiveReps} effective reps — keep calibration to ≤12 (5–8 reps, low RIR)`); return; }
    const first = Data.patternEstimate(pattern) == null;
    Data.setPatternEstimate(pattern, est.oneRM, { ema: !first });
    renderCalibration(); renderExerciseSelect();
    const remaining = Engine.PATTERNS.filter((p) => Data.patternEstimate(p) == null).length;
    toast(remaining ? `Logged ~${round1(est.oneRM)} lb 1RM · ${remaining} pattern${remaining === 1 ? "" : "s"} left` : "Strength map complete 💪");
  }

  /* ---------- settings + data ---------- */
  function openSettings() {
    const s = Data.settings();
    $("#apiKeyInput").value = s.apiKey; $("#modelSelect").value = s.model;
    $("#settingsModal").classList.remove("hidden");
  }
  function saveSettings() {
    Data.setSettings({ apiKey: $("#apiKeyInput").value.trim(), model: $("#modelSelect").value });
    $("#settingsModal").classList.add("hidden");
    toast("Settings saved");
  }
  function handleData(action) {
    if (action === "settings") openSettings();
    else if (action === "export") exportData();
    else if (action === "import") $("#importFile").click();
    else if (action === "seed") seedData();
    else if (action === "reset") { if (confirm("Erase everything? This cannot be undone.")) { Data.reset(); currentExercise = null; currentRx = null; $("#prescribePanel").classList.add("hidden"); renderAll(); toast("All data cleared"); } }
  }
  function exportData() {
    const blob = new Blob([JSON.stringify(Data.exportData(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `overload-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url); toast("Exported (API key excluded)");
  }
  function importData(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { try { Data.importData(JSON.parse(reader.result)); renderAll(); toast("Data imported"); } catch { toast("Could not import that file"); } };
    reader.readAsText(file); e.target.value = "";
  }

  /* ---------- sample data ---------- */
  function seedData() {
    if (Data.allLogs().length && !confirm("Replace current data with the sample dataset?")) return;
    Data.reset();
    Data.setUser({ heightCm: 178, weightLb: 180, defaultMode: "hypertrophy" });
    const seeds = { vertical_push: 95, horizontal_push: 155, vertical_pull: 175, horizontal_pull: 135, squat: 225, hinge: 275 };
    Engine.PATTERNS.forEach((p) => Data.setPatternEstimate(p, seeds[p], { ema: false }));

    const lat = Data.getExerciseByName("Lateral Raise");
    const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
    const set = (w, reps, rir) => ({ weight: Engine.toTotalLoad(w, "dumbbell_pair"), reps, rir });
    [
      { d: 18, sets: [set(15, 8, 2), set(15, 8, 1), set(15, 7, 1)] },
      { d: 11, sets: [set(15, 12, 1), set(15, 11, 1), set(15, 10, 0)] },
      { d: 4, sets: [set(20, 9, 2), set(20, 8, 1), set(20, 8, 1)] },
    ].forEach((s) => {
      const ests = s.sets.map((x) => Engine.estimate1RM(x.weight, x.reps, x.rir)).filter((e) => e.trusted).map((e) => e.oneRM);
      Data.addLog({ exerciseId: lat.id, date: daysAgo(s.d), sets: s.sets, sessionEstimate1RM: ests.length ? Math.max(...ests) : null, trusted: ests.length > 0, prescribedTotal: s.sets[0].weight, mode: "hypertrophy" });
    });
    renderAll();
    toast("Loaded sample data");
  }

  /* ---------- boot ---------- */
  bindEvents();
  renderAll();
  if (!Data.settings().apiKey) {
    setTimeout(() => toast("Tip: add your API key in ⋯ → AI settings to photo-identify machines"), 700);
  }
})();
