/* ============================================================
   app.js — UI + orchestration. The brains live in store.js
   (state), observatory.js (measurement), brain.js (AI). This
   file renders and routes. Pounds throughout.
   ============================================================ */

(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const round = (n) => Math.round(n);
  const r1 = (n) => Math.round(n * 10) / 10;
  const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const S = () => Store.get();

  let mode = "single";
  let pendingPhoto = null, addPendingPhoto = null;
  let pendingFocus = [], timeboxMin = 0;
  let trendMetric = "e1rm";
  let restInt = null, wbInt = null;
  let prIds = new Set();
  let rescaleOffered = false;
  let chatPrefill = null;

  let toastT;
  function toast(m) { const el = $("#toast"); el.textContent = m; el.classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add("hidden"), 3600); }

  const cmToFtIn = (cm) => cm ? { ft: Math.floor(cm / 2.54 / 12), in: Math.round((cm / 2.54) % 12) } : { ft: "", in: "" };
  const ftInToCm = (ft, i) => { const f = parseInt(ft, 10) || 0, n = parseInt(i, 10) || 0; return f || n ? Math.round((f * 12 + n) * 2.54) : null; };
  const hasKey = () => !!S().settings.apiKey;
  const wUnit = (perHand) => (perHand ? "lb/hand" : "lb");

  function handleErr(e) {
    setStatus(null);
    if (e && e.message === "NO_KEY") { switchView("me"); toast("Add your API key in Me"); }
    else if (e && e.status === 401) { switchView("me"); toast("API key rejected — check it in Me"); }
    else toast((e && e.message) || "Something went wrong");
  }
  function ensureReady() { if (!hasKey()) { switchView("me"); toast("Add your API key to start"); return false; } return true; }

  function rirSelect(sel) {
    return `<select class="s-rir">` + [0, 1, 2, 3, 4, 5].map((v) =>
      `<option value="${v}"${v === sel ? " selected" : ""}>${v === 0 ? "0 · failure" : v === 5 ? "5+ · easy" : v + " left"}</option>`).join("") + `</select>`;
  }

  /* ============================================================
     ONBOARDING (2 steps)
     ============================================================ */
  const ob = { step: 0, draft: {} };
  function startOnboardingIfNeeded() {
    if (S().onboarded) return;
    ob.step = 0; ob.draft = Object.assign({}, S().profile);
    $("#onboard").classList.remove("hidden"); renderOnboard();
  }
  const dots = (a, n) => `<div class="ob-steps">${Array.from({ length: n }, (_, i) => `<div class="ob-dot ${i <= a ? "on" : ""}"></div>`).join("")}</div>`;
  const chipRow = (name, opts, val) => `<div class="chips small" data-chips="${name}">${opts.map((o) => `<button class="chip ${val === o.v ? "active" : ""}" data-v="${o.v}">${o.t}</button>`).join("")}</div>`;

  function renderOnboard() {
    const b = $("#obBody");
    if (ob.step === 0) {
      b.innerHTML = dots(0, 2) +
        `<h2>Let's build your coach</h2><p class="lead">Sixty seconds — then it programs every session, tracks recomp, and learns you week over week.</p>` +
        `<div class="field"><span>Sex</span>${chipRow("sex", [{ v: "Male", t: "Male" }, { v: "Female", t: "Female" }], ob.draft.sex)}</div>` +
        `<div class="row"><label class="field"><span>Bodyweight (lb)</span><input type="number" id="obW" value="${ob.draft.weightLb || ""}" placeholder="185" /></label>` +
        `<label class="field"><span>Height</span><span class="ht"><input type="number" id="obFt" value="${cmToFtIn(ob.draft.heightCm).ft}" placeholder="5" /><i>ft</i><input type="number" id="obIn" value="${cmToFtIn(ob.draft.heightCm).in}" placeholder="10" /><i>in</i></span></label></div>` +
        `<div class="field"><span>Lifting experience</span>${chipRow("experience", [{ v: "Beginner", t: "New" }, { v: "Intermediate", t: "Some" }, { v: "Advanced", t: "Experienced" }], ob.draft.experience)}</div>` +
        `<div class="ob-actions"><button class="cta" id="obNext">Continue →</button></div>`;
    } else {
      b.innerHTML = dots(1, 2) +
        `<h2>What are you training for?</h2><p class="lead">In your own words — this shapes every single decision the coach makes.</p>` +
        `<label class="field"><span>Your goals</span><textarea id="obNotes" rows="3" placeholder="recomp — build muscle and drop fat; bigger arms; total cardio novice…">${esc(ob.draft.goalNotes || "")}</textarea></label>` +
        `<label class="field"><span>Lifts you know (optional)</span><input type="text" id="obKnown" value="${esc(ob.draft.known || "")}" placeholder="bench 185x8, squat 225x5" /></label>` +
        `<div class="ob-actions"><button class="ghost" id="obSkip">Skip</button><button class="cta" id="obDone">Start →</button></div>`;
    }
    $$("#obBody [data-chips]").forEach((row) => row.addEventListener("click", (e) => {
      const c = e.target.closest(".chip"); if (!c) return;
      ob.draft[row.dataset.chips] = c.dataset.v;
      $$(".chip", row).forEach((x) => x.classList.toggle("active", x === c));
    }));
    const next = $("#obNext");
    if (next) next.addEventListener("click", () => {
      ob.draft.weightLb = parseFloat($("#obW").value) || null;
      ob.draft.heightCm = ftInToCm($("#obFt").value, $("#obIn").value);
      ob.step = 1; renderOnboard();
    });
    const fin = () => {
      if ($("#obNotes")) ob.draft.goalNotes = $("#obNotes").value.trim();
      if ($("#obKnown")) ob.draft.known = $("#obKnown").value.trim();
      Object.assign(S().profile, ob.draft);
      S().onboarded = true;
      if (ob.draft.weightLb) Store.addWeighIn(ob.draft.weightLb);
      Store.save();
      $("#onboard").classList.add("hidden"); renderAll();
      toast("You're set. Tell me what you're training 💪");
    };
    $("#obSkip")?.addEventListener("click", fin);
    $("#obDone")?.addEventListener("click", fin);
  }

  /* ============================================================
     TODAY — readiness, weigh-in, weekly review, daily focus
     ============================================================ */
  function renderToday() {
    const p = S().profile;
    $("#hello").textContent = p.sex || p.weightLb ? "Ready to train?" : "Welcome";
    const bw = S().block;
    $("#subhello").textContent = hasKey()
      ? `${S().dietPhase.mode === "deficit" ? "Deficit" : "Maintenance"} · block week ${bw.weekNum}${bw.phase === "deload" ? " · DELOAD" : ""}`
      : "Connect your coach to start.";
    $("#keyBanner").classList.toggle("hidden", hasKey());

    // readiness
    const ci = Store.todayCheckIn();
    $$("#readinessChips .chip").forEach((c) => c.classList.toggle("active", !!ci && ci.readiness === c.dataset.r));
    $("#readinessCard").classList.toggle("done", !!(ci && ci.readiness));

    // weigh-in
    const w = Store.todayWeighIn();
    if (w) $("#weighInput").value = w.lb;
    $("#weighCard").classList.toggle("done", !!w);
    const wt = Obs.weightTrend(S());
    $("#weighTrend").textContent = wt.lbPerWeek != null ? `trend ${wt.lbPerWeek > 0 ? "+" : ""}${wt.lbPerWeek} lb/wk` : (wt.latest ? `latest ${wt.latest} lb` : "log daily for the trend");

    renderReviewBanner();
    renderFocus(false);
  }

  function renderReviewBanner() {
    const el = $("#reviewBanner");
    const due = hasKey() && S().sessions.length >= 3 && Store.daysSinceReview() >= 7;
    el.classList.toggle("hidden", !due);
    if (due) {
      el.innerHTML = `<div><b>Weekly deep review is due.</b><br>Full analysis: recomp verdict, volume targets, block call.</div><button id="runReview">Run it</button>`;
      $("#runReview").addEventListener("click", runWeeklyReview);
    }
  }

  async function runWeeklyReview() {
    if (!ensureReady()) return;
    const el = $("#reviewBanner");
    el.innerHTML = `<div><span class="spinner"></span><span class="pulse" id="rvStage">Analyzing your week…</span></div>`;
    try {
      const data = await Brain.weeklyReview((s) => { const t = $("#rvStage"); if (t) t.textContent = s; });
      Store.addWeeklyReview(data);
      el.classList.add("hidden");
      $("#reviewResult").innerHTML = "";
      $("#reviewResult").appendChild(reviewCard(data));
      renderToday(); renderFocus(true);
      toast("Weekly review complete");
    } catch (e) { renderReviewBanner(); handleErr(e); }
  }

  function reviewCard(d) {
    const el = document.createElement("div");
    el.className = "review-card";
    const targets = (d.muscleTargets || []).map((t) => `<span><b>${esc(t.muscle)}</b> ${t.setsLow}–${t.setsHigh}</span>`).join("");
    const stalls = (d.stalls || []).map((s) => `<div class="rv-call">🧱 <b>${esc(s.exercise)}</b> — ${esc(s.question)} <button class="linkbtn" data-stallq="${esc(s.question)}" data-stallx="${esc(s.exercise)}">Answer in chat →</button></div>`).join("");
    const exCalls = (d.exerciseCalls || []).filter((x) => x.call !== "keep").map((x) => `<div class="rv-call">${x.call === "rotate_out" ? "🔄" : "👀"} <b>${esc(x.exercise)}</b> — ${esc(x.note)}</div>`).join("");
    el.innerHTML =
      `<span class="rv-verdict ${esc(d.recompVerdict.status)}">${esc(d.recompVerdict.status.replace(/_/g, " "))}</span>` +
      `<h3>${esc(d.headline)}</h3>` +
      `<div class="rv-analysis">${esc(d.analysis)}</div>` +
      `<div class="rv-section"><h4>Next week's volume targets</h4><div class="rv-targets">${targets}</div></div>` +
      `<div class="rv-section"><h4>Calls</h4>` +
      `<div class="rv-call">📦 <b>Block:</b> ${esc(d.blockCall.action.replace("_", " "))} — ${esc(d.blockCall.note)}</div>` +
      `<div class="rv-call">🍽 <b>Diet:</b> ${esc(d.dietCall.mode.replace(/_/g, " "))} — ${esc(d.dietCall.note)}</div>` +
      `<div class="rv-call">🫀 <b>Cardio:</b> ${d.cardioCall.weeklyMinutes} min/wk — ${esc(d.cardioCall.note)}</div>` +
      ((d.experiment && d.experiment.status !== "none") ? `<div class="rv-call">🧪 <b>Experiment (${esc(d.experiment.status)}):</b> ${esc(d.experiment.description)}${d.experiment.finding ? " · " + esc(d.experiment.finding) : ""}</div>` : "") +
      ((d.specialization && d.specialization.muscles.length) ? `<div class="rv-call">🎯 <b>Specializing:</b> ${d.specialization.muscles.map(esc).join(", ")} — ${esc(d.specialization.note)}</div>` : "") +
      `</div>` +
      (stalls ? `<div class="rv-section"><h4>Stalled lifts</h4>${stalls}</div>` : "") +
      (exCalls ? `<div class="rv-section"><h4>Exercise calls</h4>${exCalls}</div>` : "");
    el.addEventListener("click", (e) => {
      const q = e.target.closest("[data-stallq]");
      if (q) { chatPrefill = `About ${q.dataset.stallx}: ${q.dataset.stallq} — `; switchView("coach"); }
    });
    return el;
  }

  function focusHtml(d) {
    const focus = (d.recommendedFocus || []).map((f) => `<button data-buildfocus="${esc(f)}">${esc(f)} →</button>`).join("");
    const status = (d.muscleStatus || []).map((m) => `<span class="mstatus"><span class="dot ${m.status}"></span><b>${esc(m.muscle)}</b> · ${esc(m.lastTrained)}</span>`).join("");
    const cardio = d.cardio && d.cardio.recommend
      ? `<div class="rv-call">🫀 <b>${esc(d.cardio.modality)} · ${d.cardio.minutes} min</b> (${esc(d.cardio.timing)}) — ${esc(d.cardio.why)} <button class="linkbtn" data-logcardio="${esc(d.cardio.modality)}|${d.cardio.minutes}">Log it →</button></div>` : "";
    return `<div class="fr-top"><span class="fr-kicker">Today's focus</span><button class="fr-refresh" data-frrefresh title="Refresh">↻</button></div>` +
      `<h3>${esc(d.headline)}</h3><p>${esc(d.rationale)}</p>` +
      (d.restDay ? "" : (focus ? `<div class="fr-focus">${focus}</div>` : "")) +
      cardio +
      (status ? `<div class="fr-status">${status}</div>` : "");
  }
  function renderFocus(force) {
    const box = $("#focusRec");
    if (!hasKey()) { box.classList.add("hidden"); return; }
    if (!S().sessions.length && !S().cardio.length) {
      box.classList.remove("hidden");
      box.innerHTML = `<span class="fr-kicker">Today's focus</span><h3>Log your first session</h3><p>Once I've seen you train, I'll tell you what's due every day — lifting and cardio — from your actual recovery and volume data.</p>`;
      return;
    }
    const today = Store.today();
    if (!force && S().recCache && S().recCache.date === today) {
      box.classList.remove("hidden"); box.innerHTML = focusHtml(S().recCache.data); wireFocus(box); return;
    }
    box.classList.remove("hidden");
    box.innerHTML = `<span class="fr-kicker">Today's focus</span><p style="margin-top:8px"><span class="spinner"></span>Reading your ledger, recovery and trend…</p>`;
    Brain.dailyFocus()
      .then((d) => { S().recCache = { date: today, data: d }; Store.save(); box.innerHTML = focusHtml(d); wireFocus(box); })
      .catch(() => box.classList.add("hidden"));
  }
  function wireFocus(box) {
    $("[data-frrefresh]", box)?.addEventListener("click", () => renderFocus(true));
    $$("[data-buildfocus]", box).forEach((b) => b.addEventListener("click", () => {
      switchView("train"); setMode("plan");
      pendingFocus = [b.dataset.buildfocus];
      $$("#focusChips .chip").forEach((c) => c.classList.toggle("active", c.dataset.focus === b.dataset.buildfocus));
      $("#planBtn").disabled = false;
      runPlan();
    }));
    $$("[data-logcardio]", box).forEach((b) => b.addEventListener("click", () => {
      const [m, min] = b.dataset.logcardio.split("|");
      switchView("train"); setMode("cardio");
      $$("#cardioMod .chip").forEach((c) => c.classList.toggle("active", c.dataset.m === m));
      $("#cardioMin").value = min;
    }));
  }

  /* ============================================================
     TRAIN — coaching, cards, active session
     ============================================================ */
  function setStatus(html) { const s = $("#status"); if (html == null) { s.classList.add("hidden"); s.innerHTML = ""; } else { s.classList.remove("hidden"); s.innerHTML = html; } }
  function loadingCycle(msgs) {
    let i = 0; const show = () => setStatus(`<span class="spinner"></span><span class="pulse">${esc(msgs[i])}</span>`);
    show(); const t = setInterval(() => { i = (i + 1) % msgs.length; show(); }, 1700);
    return () => clearInterval(t);
  }
  function setMode(m) {
    mode = m;
    $$(".seg").forEach((s) => s.classList.toggle("active", s.dataset.mode === m));
    $("#singleEntry").classList.toggle("hidden", m !== "single");
    $("#planEntry").classList.toggle("hidden", m !== "plan");
    $("#cardioEntry").classList.toggle("hidden", m !== "cardio");
  }

  function buildHistoryNote(name) {
    return S().sessions.filter((s) => s.name.toLowerCase() === (name || "").toLowerCase()).length > 0;
  }

  async function runCoach() {
    if (!ensureReady()) return;
    const name = $("#exInput").value.trim();
    if (!name && !pendingPhoto) { toast("Type an exercise or add a photo"); return; }
    const src = { name, image: pendingPhoto };
    const stop = loadingCycle(["Reading your ledger…", "Checking your trend on this…", "Choosing your weights…"]);
    try {
      const rx = await Brain.coach({ exerciseName: name, imageDataUrl: pendingPhoto });
      stop(); setStatus(null); clearPhoto();
      addCard(rx, { standalone: true, src, adapted: buildHistoryNote(rx.resolvedName) });
      showAddEx(true);
    } catch (e) { stop(); handleErr(e); }
  }

  async function runPlan() {
    if (!ensureReady()) return;
    if (!pendingFocus.length) { toast("Pick one or more focuses"); return; }
    const label = pendingFocus.join(" + ");
    $("#result").innerHTML = "";
    const stop = loadingCycle([`Planning ${label.toLowerCase()}…`, "Filling your volume gaps…", "Setting your weights…"]);
    try {
      const plan = await Brain.plan({ focus: label, timeboxMinutes: timeboxMin || null });
      stop(); setStatus(null);
      const head = document.createElement("div");
      head.className = "notice";
      head.innerHTML = `<b>${esc(plan.title)}</b><br>${esc(plan.note)}`;
      $("#result").appendChild(head);
      plan.exercises.forEach((ex) => addCard(Object.assign({ rationale: "", readiness: "confident" }, ex), { standalone: true, src: { name: ex.resolvedName, image: null }, adapted: buildHistoryNote(ex.resolvedName) }));
      showAddEx(true);
    } catch (e) { stop(); handleErr(e); }
  }

  async function coachAndAppend() {
    if (!ensureReady()) return;
    const name = $("#addExInput").value.trim();
    if (!name && !addPendingPhoto) { toast("Type an exercise or add a photo"); return; }
    const src = { name, image: addPendingPhoto };
    const btn = $("#addExGo"); const pv = btn.textContent; btn.textContent = "Adding…"; btn.disabled = true;
    try {
      const rx = await Brain.coach({ exerciseName: name, imageDataUrl: addPendingPhoto });
      addCard(rx, { standalone: true, src, adapted: buildHistoryNote(rx.resolvedName) });
      $("#addExInput").value = ""; clearAddPhoto();
      $("#result").lastChild.scrollIntoView({ behavior: "smooth", block: "center" });
      toast("Added to your workout 💪");
    } catch (e) { handleErr(e); } finally { btn.textContent = pv; btn.disabled = false; }
  }
  function showAddEx(v) { $("#addExWrap").classList.toggle("hidden", !v); }

  /* ---------- exercise card ---------- */
  function addCard(rx, ctx) {
    const el = exerciseCard(rx, ctx || {});
    $("#result").appendChild(el);
    ensureWorkout();
    persistActive();
    return el;
  }

  function exerciseCard(rx, ctx) {
    const el = document.createElement("div");
    el.className = "exercise-card";
    el._rx = rx; el._src = ctx.src || null; el._rest = rx.restSeconds || 120; el._saved = !!ctx.saved;

    const oneRm = rx.estimatedOneRepMax ? `<div class="xc-1rm"><b>${round(rx.estimatedOneRepMax)}</b><small>est 1RM · lb</small></div>` : "";
    const cues = (rx.cues || []).map((c) => `<span class="cue">${esc(c)}</span>`).join("");
    const warm = rx.warmup || [], work = rx.workingSets || [];
    const badge = ctx.adapted ? `<span class="badge adapt">↗ Adapted from your data</span>` : `<span class="badge first">Starting point</span>`;
    const feelerHint = rx.readiness === "needs_feeler" ? `<div class="redial-hint">Hard to gauge — do set 1, then re-dial.</div>` : "";
    const rows = ctx.rows || null; // restored state

    el.innerHTML =
      `<div class="xc-head">${oneRm}<div class="xc-title">${esc(rx.resolvedName)}</div>` +
      `<div class="xc-sub">${esc(rx.muscleGroup)} · ${esc(rx.equipment)}${rx.perHand ? " · per hand" : ""} · rest ${Math.round((rx.restSeconds || 120) / 60 * 10) / 10}m</div></div>` +
      `<div class="xc-body">` + badge +
      (rx.rationale ? `<div class="rationale">${esc(rx.rationale)}</div>` : "") +
      (cues ? `<div class="cues">${cues}</div>` : "") +
      (warm.length ? `<div class="setgroup-label">Warm-up</div>` + warm.map((s, i) => setRow(restoredOr(rows, true, i, s), i, true)).join("") : "") +
      `<div class="setgroup-label">Working sets · ${wUnit(rx.perHand)}</div>` +
      work.map((s, i) => setRow(restoredOr(rows, false, i, s), i, false, s)).join("") +
      (rx.equipment === "barbell" ? `<button class="plates-btn" data-act="plates">🏋 plate math</button><div class="plates-line hidden"></div>` : "") +
      `<button class="redial" data-act="feeler">🎯 Off? Mark done sets, re-dial the rest</button>` + feelerHint +
      `<div class="card-actions">` +
      (el._saved ? `<div class="notice" style="width:100%">✓ Logged.</div>` : `<button class="cta small" data-act="save">Log this exercise</button><button class="regen" data-act="swap" title="Can't do this — swap it">🔁</button>`) +
      `</div></div>`;

    el.addEventListener("click", onCardClick);
    el.addEventListener("input", persistActive);
    return el;
  }
  function restoredOr(rows, warm, i, s) {
    if (!rows) return { w: s.weight, r: s.reps, rir: s.targetRIR != null ? s.targetRIR : 1, done: false };
    const set = rows.filter((x) => x.warm === warm)[i];
    return set || { w: s.weight, r: s.reps, rir: s.targetRIR != null ? s.targetRIR : 1, done: false };
  }
  function setRow(v, i, warm) {
    return `<div class="setrow ${warm ? "warm" : ""} ${v.done ? "done" : ""}" data-warm="${warm ? 1 : 0}">` +
      `<span class="setnum">${warm ? "W" : i + 1}</span>` +
      `<input class="s-w" type="number" step="0.5" value="${v.w}" />` +
      `<span class="x">×</span>` +
      `<input class="s-r" type="number" step="1" value="${v.r}" />` +
      (warm ? `<span class="unit">warm</span>` : rirSelect(v.rir != null ? v.rir : 1)) +
      `<button class="donebtn" title="Done">✓</button></div>`;
  }

  function onCardClick(e) {
    const el = e.currentTarget;
    const done = e.target.closest(".donebtn");
    if (done) {
      const row = done.closest(".setrow");
      row.classList.toggle("done");
      if (row.classList.contains("done") && row.dataset.warm === "0") {
        startRest(el._rest);
        checkAutoregulation(el, row);
      }
      persistActive();
      return;
    }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "save") saveCard(el);
    else if (act.dataset.act === "feeler") feelerDialIn(el);
    else if (act.dataset.act === "swap") swapCard(el);
    else if (act.dataset.act === "plates") togglePlates(el);
  }

  /* ---------- plate math ---------- */
  function togglePlates(el) {
    const line = $(".plates-line", el);
    if (!line.classList.contains("hidden")) { line.classList.add("hidden"); return; }
    const row = $$(".setrow", el).find((r) => r.dataset.warm === "0" && !r.classList.contains("done")) || $$(".setrow", el).find((r) => r.dataset.warm === "0");
    const w = row ? parseFloat($(".s-w", row).value) : 0;
    line.textContent = plateBreakdown(w);
    line.classList.remove("hidden");
  }
  function plateBreakdown(total) {
    const BAR = 45;
    if (!(total > 0)) return "—";
    if (total <= BAR) return `${total} lb — just the bar (or lighter bar)`;
    let side = (total - BAR) / 2;
    const plates = [45, 35, 25, 10, 5, 2.5];
    const out = [];
    plates.forEach((p) => { while (side >= p - 0.01) { out.push(p); side -= p; } });
    return `${total} lb = bar + per side: ${out.join(" · ") || "—"}${side > 0.26 ? ` (+${r1(side)} odd)` : ""}`;
  }

  /* ---------- set reading ---------- */
  function readRow(r) {
    return { warm: r.dataset.warm === "1", w: parseFloat($(".s-w", r).value), r: parseInt($(".s-r", r).value, 10), rir: $(".s-rir", r) ? parseInt($(".s-rir", r).value, 10) : null, done: r.classList.contains("done") };
  }
  const workRows = (el) => $$(".setrow", el).filter((r) => r.dataset.warm === "0");

  /* ---------- autoregulation: set-1 probe across the session ---------- */
  function checkAutoregulation(el, row) {
    if (rescaleOffered) return;
    const rx = el._rx;
    const idx = workRows(el).indexOf(row);
    const pres = (rx.workingSets || [])[idx];
    if (!pres) return;
    const v = readRow(row);
    if (!(v.r > 0)) return;
    const repErr = v.r - pres.reps;
    const grind = v.rir === 0 && (pres.targetRIR != null && pres.targetRIR >= 2);
    if (repErr <= -2 || (grind && repErr < 0)) {
      rescaleOffered = true;
      const pct = Math.min(12, Math.abs(repErr) * 3 + (grind ? 3 : 0));
      const n = document.createElement("div");
      n.className = "keybanner"; n.id = "rescaleBanner";
      n.innerHTML = `<div><b>You're running ~${pct}% below prediction today.</b><br>Want me to scale the rest of the session down?</div><button id="rescaleGo">Rescale</button>`;
      $("#result").prepend(n);
      $("#rescaleGo").addEventListener("click", () => rescaleSession(pct));
    }
  }
  async function rescaleSession(pct) {
    const banner = $("#rescaleBanner");
    if (banner) banner.innerHTML = `<div><span class="spinner"></span>Rescaling remaining exercises…</div>`;
    const cards = $$("#result .exercise-card").filter((el) => !el._saved && workRows(el).every((r) => !r.classList.contains("done")));
    for (const el of cards) {
      try {
        const rx = await Brain.coach({ exerciseName: el._rx.resolvedName, readinessAdjust: `Athlete is underperforming predictions by ~${pct}% today (low readiness). Scale the load down accordingly.` });
        const fresh = exerciseCard(rx, { standalone: true, src: el._src, adapted: true });
        el.replaceWith(fresh);
      } catch { /* keep original card */ }
    }
    banner?.remove();
    persistActive();
    toast(cards.length ? "Session rescaled to today's condition" : "Nothing untouched left to rescale — use re-dial on the current lift");
  }

  /* ---------- partial re-dial ---------- */
  async function feelerDialIn(el) {
    const rx = el._rx;
    const rows = workRows(el);
    const done = rows.filter((r) => r.classList.contains("done"));
    const undone = rows.filter((r) => !r.classList.contains("done"));
    if (!undone.length) { toast("All sets done — log it"); return; }
    let feeler = null, completedSets = null, remainingCount = null;
    if (done.length) {
      completedSets = done.map(readRow).filter((s) => s.r > 0).map((s) => ({ weight: s.w, reps: s.r, rir: s.rir }));
      feeler = completedSets[completedSets.length - 1];
      remainingCount = undone.length;
    } else {
      const f = readRow(undone[0]);
      if (!(f.w >= 0) || !(f.r > 0)) { toast("Do set 1 (or mark it done), then re-dial"); return; }
      feeler = { weight: f.w, reps: f.r, rir: f.rir };
    }
    const btn = $('[data-act="feeler"]', el); const prev = btn.textContent;
    btn.textContent = "Dialing in…"; btn.disabled = true;
    try {
      const nrx = await Brain.coach({ exerciseName: rx.resolvedName, feeler, completedSets, remainingCount });
      let rowsState = null;
      if (completedSets) {
        const doneRows = done.map(readRow);
        const newRows = (nrx.workingSets || []).map((s) => ({ warm: false, w: s.weight, r: s.reps, rir: s.targetRIR != null ? s.targetRIR : 1, done: false }));
        nrx.workingSets = doneRows.map((d) => ({ weight: d.w, reps: d.r, targetRIR: d.rir != null ? d.rir : 1 })).concat(nrx.workingSets || []);
        rowsState = doneRows.map((d) => ({ warm: false, w: d.w, r: d.r, rir: d.rir, done: true })).concat(newRows);
      }
      const fresh = exerciseCard(nrx, { standalone: true, src: el._src, adapted: true, rows: rowsState });
      el.replaceWith(fresh); persistActive();
      toast(completedSets ? "Re-dialed your remaining sets 💪" : "Dialed in from your set 💪");
    } catch (e) { btn.textContent = prev; btn.disabled = false; handleErr(e); }
  }

  /* ---------- swap ---------- */
  async function swapCard(el) {
    const rx = el._rx;
    const btn = $('[data-act="swap"]', el); btn.textContent = "…"; btn.disabled = true;
    try {
      const nrx = await Brain.coach({ exerciseName: rx.resolvedName, swapFor: { exercise: rx.resolvedName, reason: "unavailable / can't do it right now — pick the best substitute for the same stimulus" } });
      el.replaceWith(exerciseCard(nrx, { standalone: true, src: { name: nrx.resolvedName, image: null }, adapted: buildHistoryNote(nrx.resolvedName) }));
      persistActive();
      toast(`Swapped to ${nrx.resolvedName}`);
    } catch (e) { btn.textContent = "🔁"; btn.disabled = false; handleErr(e); }
  }

  /* ---------- save one exercise ---------- */
  function saveCard(el) {
    const rx = el._rx;
    const logged = workRows(el).map(readRow).filter((s) => s.r > 0 && s.w >= 0).map((s) => ({ weight: s.w, reps: s.r, rir: s.rir }));
    if (!logged.length) { toast("Log at least one working set"); return; }
    Store.addSession({
      date: new Date().toISOString(), name: rx.resolvedName,
      muscles: rx.muscles || [], equipment: rx.equipment, perHand: rx.perHand,
      prescribed: rx.workingSets || [], logged,
      estimatedOneRepMax: rx.estimatedOneRepMax || null, restSeconds: rx.restSeconds || null, rationale: rx.rationale || "",
    });
    el._saved = true;
    $(".card-actions", el).innerHTML = `<div class="notice" style="width:100%">✓ Logged.</div>`;
    $('[data-act="feeler"]', el)?.remove();
    persistActive();
    toast("Logged 💪");
  }

  /* ============================================================
     ACTIVE SESSION (persist + sticky bar + finish/debrief)
     ============================================================ */
  function ensureWorkout() {
    if (!Store.getActive()) Store.setActive({ startedAt: new Date().toISOString(), items: [] });
    updateWorkoutBar();
  }
  function persistActive() {
    const active = Store.getActive();
    if (!active) return;
    active.items = $$("#result .exercise-card").map((el) => ({
      rx: el._rx, src: el._src, saved: el._saved,
      rows: $$(".setrow", el).map(readRow),
    }));
    Store.setActive(active);
    updateWorkoutBar();
  }
  function restoreActive() {
    const a = Store.getActive();
    if (!a || !a.items || !a.items.length) return;
    $("#result").innerHTML = "";
    a.items.forEach((it) => {
      const el = exerciseCard(it.rx, { standalone: true, src: it.src, adapted: true, rows: it.rows, saved: it.saved });
      $("#result").appendChild(el);
    });
    showAddEx(true);
    updateWorkoutBar();
  }
  function updateWorkoutBar() {
    const a = Store.getActive();
    const bar = $("#workoutBar");
    const has = a && a.items && a.items.length;
    bar.classList.toggle("hidden", !has);
    clearInterval(wbInt);
    if (has) {
      const tick = () => {
        const s = Math.floor((Date.now() - new Date(a.startedAt).getTime()) / 1000);
        $("#wbElapsed").textContent = ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      };
      tick(); wbInt = setInterval(tick, 30000);
      $("#wbTitle").textContent = `Workout · ${a.items.filter((i) => i.saved).length}/${a.items.length} logged`;
    }
  }
  async function finishWorkout() {
    const cards = $$("#result .exercise-card");
    // auto-save only cards the athlete actually did (>=1 set marked done);
    // untouched prescriptions are discarded, never logged as training.
    cards.forEach((el) => { if (!el._saved) { const didWork = workRows(el).map(readRow).some((s) => s.done && s.r > 0); if (didWork) saveCard(el); } });
    const savedNames = cards.filter((el) => el._saved).map((el) => el._rx.resolvedName);
    Store.setActive(null); rescaleOffered = false;
    updateWorkoutBar();
    stopRest();
    if (savedNames.length && hasKey()) {
      const box = document.createElement("div");
      box.className = "debrief"; box.innerHTML = `<span class="spinner"></span>Coach is reviewing your session…`;
      $("#result").prepend(box);
      try {
        const recent = S().sessions.slice(-savedNames.length).map((s) => ({ name: s.name, sets: s.logged, prescribed: s.prescribed, e1rm: Obs.sessionE1rm(s) }));
        const d = await Brain.debrief({ exercises: recent });
        box.innerHTML = `<b>Coach:</b> ${esc(d.debrief)}`;
        if (d.modelNote) Store.appendModelNote(d.modelNote);
      } catch { box.remove(); }
    }
    toast(savedNames.length ? "Workout finished 💪" : "Workout closed");
    renderTrends();
  }

  /* ---------- rest timer ---------- */
  function startRest(seconds) {
    let left = Math.max(10, seconds || 120);
    const el = $("#restTimer"), cnt = $("#restCount"), lbl = $("#restLabel");
    const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    clearInterval(restInt);
    el.classList.remove("hidden", "done"); lbl.textContent = "Rest"; cnt.textContent = fmt(left);
    restInt = setInterval(() => {
      left--; cnt.textContent = fmt(Math.max(0, left));
      if (left <= 0) { clearInterval(restInt); el.classList.add("done"); lbl.textContent = "Go!"; cnt.textContent = "💥"; setTimeout(() => el.classList.add("hidden"), 4000); }
    }, 1000);
  }
  function stopRest() { clearInterval(restInt); $("#restTimer").classList.add("hidden"); }

  /* ---------- cardio ---------- */
  function saveCardio() {
    const mod = $("#cardioMod .chip.active")?.dataset.m || "Other";
    const min = parseInt($("#cardioMin").value, 10);
    const rpe = parseInt($("#cardioRpe").value, 10) || null;
    if (!(min > 0)) { toast("Enter minutes"); return; }
    Store.addCardio({ modality: mod, minutes: min, rpe });
    $("#cardioMin").value = ""; $("#cardioRpe").value = "";
    toast(`${mod} · ${min} min logged 🫀`);
    renderTrends();
  }

  /* ---------- recent chips ---------- */
  function renderRecentChips() {
    const seen = new Set(); const recent = [];
    S().sessions.slice().reverse().forEach((s) => { const k = s.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); recent.push(s.name); } });
    $("#recentChips").innerHTML = recent.slice(0, 6).map((n) => `<button class="chip" data-recent="${esc(n)}">${esc(n)}</button>`).join("");
  }

  /* ============================================================
     COACH (CHAT)
     ============================================================ */
  function renderChat() {
    const log = $("#chatLog");
    const msgs = S().chat;
    log.innerHTML = msgs.length
      ? msgs.map((m) => `<div class="msg ${m.role}">${esc(m.text)}</div>`).join("")
      : `<p class="empty">Ask me anything — swaps, stalls, diet, soreness. I have your full data in front of me.</p>`;
    log.scrollTop = log.scrollHeight;
    if (chatPrefill) { $("#chatInput").value = chatPrefill; chatPrefill = null; $("#chatInput").focus(); }
  }
  async function sendChat() {
    if (!ensureReady()) return;
    const input = $("#chatInput");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    Store.addChat("user", text); renderChat();
    const log = $("#chatLog");
    const tmp = document.createElement("div"); tmp.className = "msg assistant"; tmp.innerHTML = `<span class="spinner"></span>`;
    log.appendChild(tmp); log.scrollTop = log.scrollHeight;
    try {
      const reply = await Brain.chat(text);
      Store.addChat("assistant", reply);
    } catch (e) { Store.addChat("assistant", "⚠ " + (e.message || "Something went wrong.")); }
    renderChat();
  }

  /* ============================================================
     TRENDS
     ============================================================ */
  function renderTrends() {
    computePR();
    renderAccuracy();
    renderLedger();
    renderStrength();
    renderWeightChart();
    renderNiggles();
    renderPhotos();
    renderLastReview();
    renderHistoryList();
  }

  function renderAccuracy() {
    const m = Obs.predictionMetrics(S());
    const el = $("#accuracyPanel");
    if (!m.setsScored) { el.innerHTML = `<div class="muted-sm">Log a few prescribed sessions and I'll show how well the coach predicts you — accuracy, your RIR bias, your fatigue curve.</div>`; return; }
    el.innerHTML = `<div class="panel-head"><h2>How well the coach knows you</h2><span class="muted-sm">${m.setsScored} sets scored</span></div>` +
      `<div class="acc-tiles">` +
      `<div class="acc-tile hero"><b>${Math.round((m.accuracyWithin1Rep || 0) * 100)}%</b><span>sets called within ±1 rep</span></div>` +
      `<div class="acc-tile"><b>${m.meanRepError > 0 ? "+" : ""}${m.meanRepError}</b><span>avg rep error</span></div>` +
      `<div class="acc-tile"><b>${m.repsLostPerSet != null ? m.repsLostPerSet : "—"}</b><span>reps lost / set</span></div>` +
      `</div>`;
  }

  function renderLedger() {
    const el = $("#volumeLedger");
    const week = Obs.volumeThisWeek(S());
    const targets = S().block.targets || {};
    const muscles = [...new Set(Object.keys(week).concat(Object.keys(targets)))].filter((m) => m !== "other");
    if (!muscles.length) { el.innerHTML = `<div class="muted-sm">Sets per muscle appear here automatically as you log — no manual tagging, the coach classifies every exercise.</div>`; return; }
    const scaleMax = Math.max(12, ...muscles.map((m) => Math.max(week[m] || 0, targets[m] ? targets[m].high * 1.15 : 0)));
    el.innerHTML = muscles.sort((a, b) => (week[b] || 0) - (week[a] || 0)).map((m) => {
      const v = week[m] || 0;
      const t = targets[m];
      const band = t ? `<span class="vl-band" style="left:${t.low / scaleMax * 100}%;width:${Math.max(1, (t.high - t.low) / scaleMax * 100)}%"></span>` : "";
      return `<div class="vl-row"><span class="vl-name">${esc(m)}</span><span class="vl-track">${band}<span class="vl-fill" style="width:${Math.min(100, v / scaleMax * 100)}%"></span></span><span class="vl-num">${v}${t ? ` / ${t.low}–${t.high}` : ""}</span></div>`;
    }).join("");
  }

  function renderStrength() {
    const sel = $("#trendExercise");
    const names = [...new Set(S().sessions.map((s) => s.name))];
    const prev = sel.value;
    sel.innerHTML = names.length ? names.map((n) => `<option>${esc(n)}</option>`).join("") : `<option>—</option>`;
    if (prev && names.includes(prev)) sel.value = prev;
    renderChart();
    const roi = Obs.exerciseROI(S());
    $("#roiList").innerHTML = roi.length ? roi.map((x) =>
      `<div class="roi-row"><span>${esc(x.name)} <span class="muted-sm">· ${x.sessions}x${x.slope4wkLbPerWk != null ? ` · ${x.slope4wkLbPerWk > 0 ? "+" : ""}${x.slope4wkLbPerWk} lb/wk` : ""}</span></span><span class="roi-verdict ${x.verdict}">${x.verdict}</span></div>`).join("") : "";
  }

  function lineChart(pts, opts) {
    if (pts.length < 1) return `<p class="empty">${opts.empty}</p>`;
    const W = 620, H = 200, pl = 42, pr = 12, pt = 14, pb = 24;
    const ys = pts.map((p) => p.y); let mn = Math.min(...ys), mx = Math.max(...ys);
    if (mn === mx) { mn = Math.max(0, mn - 1); mx += 1; }
    const pad = (mx - mn) * 0.15; mn = Math.max(0, mn - pad); mx += pad;
    const n = pts.length;
    const sx = (i) => pl + (n === 1 ? (W - pl - pr) / 2 : (i / (n - 1)) * (W - pl - pr));
    const sy = (y) => pt + (1 - (y - mn) / (mx - mn)) * (H - pt - pb);
    let grid = "";
    for (let i = 0; i <= 3; i++) {
      const y = pt + (i / 3) * (H - pt - pb);
      grid += `<line x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}" stroke="#26314f"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end" fill="#5b6988" font-size="10">${r1(mx - (i / 3) * (mx - mn))}</text>`;
    }
    const line = pts.map((p, i) => `${i ? "L" : "M"} ${sx(i).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
    const area = `${line} L ${sx(n - 1).toFixed(1)} ${H - pb} L ${sx(0).toFixed(1)} ${H - pb} Z`;
    const dots = pts.map((p, i) => `<circle cx="${sx(i).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3.5" fill="${opts.color}" stroke="#0b1020" stroke-width="2"><title>${r1(p.y)} · ${fmtDate(p.date)}</title></circle>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}"><defs><linearGradient id="${opts.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${opts.color}" stop-opacity=".3"/><stop offset="100%" stop-color="${opts.color}" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#${opts.id})"/><path d="${line}" fill="none" stroke="${opts.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`;
  }

  function renderChart() {
    const name = $("#trendExercise").value;
    const series = Obs.liftSeries(S(), name || "");
    const pts = series.map((p) => ({ date: p.date, y: trendMetric === "volume" ? p.vol : p.e1rm })).filter((p) => p.y != null);
    $("#chart").innerHTML = lineChart(pts, { id: "g1", color: "#33d6c0", empty: "Log sessions to see your strength curve." });
  }

  function renderWeightChart() {
    const wt = Obs.weightTrend(S());
    const pts = wt.emaSeries.map((p) => ({ date: p.date, y: p.ema }));
    $("#weightChart").innerHTML =
      (wt.lbPerWeek != null ? `<div class="muted-sm" style="margin-bottom:8px">Trend: <b style="color:var(--text)">${wt.lbPerWeek > 0 ? "+" : ""}${wt.lbPerWeek} lb/wk</b> · latest ${wt.latest} lb</div>` : "") +
      lineChart(pts, { id: "g2", color: "#8b6dff", empty: "Daily weigh-ins build the trend the recomp verdict runs on." });
  }

  function renderNiggles() {
    const el = $("#niggleList");
    const ns = S().niggles;
    el.innerHTML = ns.length ? ns.map((n) =>
      `<div class="niggle"><button class="n-status ${n.status}" data-niggle="${n.id}">${n.status}</button><div><b>${esc(n.area)}</b> — ${esc(n.note)}<div class="muted-sm">since ${n.created}</div></div></div>`).join("")
      : `<div class="muted-sm">Log any ache ("shoulder pinchy on incline") and the coach programs around it, then tests re-introduction later.</div>`;
  }

  function renderPhotos() {
    const ps = S().photos;
    $("#photoCount").textContent = ps.length ? `${ps.length} stored` : "";
    $("#photoStrip").innerHTML = ps.map((p) => `<div class="p-wrap"><img src="${p.dataUrl}" alt="" /><div class="p-date">${p.date}</div></div>`).join("");
  }

  async function runPhotoAudit() {
    if (!ensureReady()) return;
    const ps = S().photos;
    if (ps.length < 2) { toast("Add at least 2 photos (weeks apart) first"); return; }
    const picks = ps.length <= 3 ? ps : [ps[0], ps[Math.floor(ps.length / 2)], ps[ps.length - 1]];
    const box = $("#auditResult");
    box.innerHTML = `<div class="debrief"><span class="spinner"></span>Comparing your photos…</div>`;
    try {
      const d = await Brain.photoAudit(picks);
      box.innerHTML = `<div class="debrief"><b>Physique audit:</b> ${esc(d.verdict)}</div>`;
      if (d.modelNote) Store.appendModelNote(d.modelNote);
    } catch (e) { box.innerHTML = ""; handleErr(e); }
  }

  function renderLastReview() {
    const r = Store.lastReview();
    const el = $("#lastReviewBox");
    if (!r) { el.textContent = "None yet — banner appears on Today once you've logged a week."; return; }
    el.innerHTML = "";
    const note = document.createElement("div");
    note.className = "muted-sm"; note.style.marginBottom = "10px";
    note.textContent = new Date(r.date).toLocaleDateString();
    el.appendChild(note);
    el.appendChild(reviewCard(r.data));
  }

  function computePR() {
    prIds = new Set(); const best = {};
    S().sessions.slice().sort((a, b) => new Date(a.date) - new Date(b.date)).forEach((s) => {
      const e = Obs.sessionE1rm(s); if (!e) return;
      const k = s.name.toLowerCase();
      if (best[k] != null && e > best[k] + 0.1) prIds.add(s.id);
      best[k] = best[k] != null ? Math.max(best[k], e) : e;
    });
  }
  function renderHistoryList() {
    const list = $("#historyList");
    const lifts = S().sessions.map((s) => ({ t: "lift", date: s.date, s }));
    const cards = S().cardio.map((c) => ({ t: "cardio", date: c.date, c }));
    const all = lifts.concat(cards).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 30);
    list.innerHTML = all.length ? weekSummary() + all.map((x) => x.t === "lift" ? sessionCard(x.s) : cardioCard(x.c)).join("") : "";
  }
  function sessionCard(s) {
    const pills = (s.logged || []).map((x) => `<span class="pill">${round(x.weight)}${s.perHand ? "/h" : ""}×${x.reps}${x.rir != null ? ` @${x.rir}` : ""}</span>`).join("");
    const e = Obs.sessionE1rm(s);
    const pr = prIds.has(s.id) ? ` <span class="pill pr">PR</span>` : "";
    return `<div class="session"><div class="session-head"><span class="name">${esc(s.name)}${pr}</span><span class="date">${fmtDate(s.date)}</span></div>` +
      `<div class="session-sets">${pills}</div><div class="session-meta"><span>Vol ${round(Obs.sessionVolume(s))} lb</span>${e ? `<span>e1RM ${r1(e)} lb</span>` : ""}</div></div>`;
  }
  function cardioCard(c) {
    return `<div class="session"><div class="session-head"><span class="name">🫀 ${esc(c.modality)}</span><span class="date">${fmtDate(c.date)}</span></div>` +
      `<div class="session-meta"><span>${c.minutes} min</span>${c.rpe ? `<span>RPE ${c.rpe}</span>` : ""}</div></div>`;
  }
  function weekSummary() {
    const wk = Date.now() - 7 * 86400000;
    const lifts = S().sessions.filter((s) => new Date(s.date).getTime() >= wk);
    const cmin = S().cardio.filter((c) => new Date(c.date).getTime() >= wk).reduce((t, c) => t + c.minutes, 0);
    if (!lifts.length && !cmin) return "";
    const vol = lifts.reduce((t, s) => t + Obs.sessionVolume(s), 0);
    return `<div class="weeksum"><div><b>${lifts.length}</b><span>lifts</span></div><div><b>${(vol / 1000).toFixed(1)}k</b><span>lb moved</span></div><div><b>${cmin}</b><span>cardio min</span></div></div>`;
  }

  /* ============================================================
     ME
     ============================================================ */
  function renderMe() {
    const p = S().profile;
    setChips("#meSex", p.sex); setChips("#meExp", p.experience);
    $("#meWeight").value = p.weightLb || "";
    const h = cmToFtIn(p.heightCm); $("#meFt").value = h.ft; $("#meIn").value = h.in;
    $("#meNotes").value = p.goalNotes || "";
    $("#meProtein").value = p.proteinTarget || "";
    $("#meEquip").value = p.equipmentNotes || "";
    $("#meKnown").value = p.known || "";
    $("#meKey").value = S().settings.apiKey;
    $("#meModel").value = S().settings.model;
  }
  function setChips(sel, val) { $$(`${sel} .chip`).forEach((c) => c.classList.toggle("active", c.dataset.v === val)); }
  function chipVal(sel) { const c = $(`${sel} .chip.active`); return c ? c.dataset.v : ""; }

  /* ============================================================
     NAV + PHOTO UTILS + DATA
     ============================================================ */
  function switchView(v) {
    $$(".navbtn").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    $$(".view").forEach((s) => s.classList.toggle("active", s.id === `view-${v}`));
    if (v === "today") renderToday();
    if (v === "train") renderRecentChips();
    if (v === "coach") renderChat();
    if (v === "trends") renderTrends();
    if (v === "me") renderMe();
  }
  function renderAll() { renderToday(); renderRecentChips(); renderChat(); renderTrends(); renderMe(); }

  function readImg(file, max, cb) {
    const img = new Image(); const rd = new FileReader();
    rd.onload = () => { img.onload = () => {
      let { width: w, height: h } = img;
      if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      cb(c.toDataURL("image/jpeg", 0.78));
    }; img.src = rd.result; };
    rd.readAsDataURL(file);
  }
  function clearPhoto() { pendingPhoto = null; $("#photoChip").classList.add("hidden"); $("#photoChip").innerHTML = ""; }
  function clearAddPhoto() { addPendingPhoto = null; $("#addExPhoto").classList.add("hidden"); $("#addExPhoto").innerHTML = ""; }

  function dataAction(a) {
    if (a === "export") {
      const blob = new Blob([JSON.stringify(Store.exportData(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const el = document.createElement("a"); el.href = url; el.download = `coach-backup-${Store.today()}.json`; el.click(); URL.revokeObjectURL(url);
      toast("Exported (key excluded)");
    } else if (a === "import") $("#importFile").click();
    else if (a === "reset") { if (confirm("Erase everything?")) { Store.reset(); location.reload(); } }
  }

  /* ============================================================
     EVENTS
     ============================================================ */
  function bind() {
    $("#nav").addEventListener("click", (e) => { const b = e.target.closest(".navbtn"); if (b) switchView(b.dataset.view); });
    $("#meBtn").addEventListener("click", () => switchView("me"));
    $("#keyBannerBtn").addEventListener("click", () => switchView("me"));

    // today
    $("#readinessChips").addEventListener("click", (e) => {
      const c = e.target.closest(".chip"); if (!c) return;
      Store.setReadiness(c.dataset.r); renderToday();
      toast(c.dataset.r === "rough" ? "Noted — I'll go easier on you today" : "Noted 💪");
    });
    $("#weighSave").addEventListener("click", () => {
      const lb = parseFloat($("#weighInput").value);
      if (!(lb > 0)) { toast("Enter your weight"); return; }
      Store.addWeighIn(lb); S().profile.weightLb = lb; Store.save(); renderToday(); toast("Weigh-in logged");
    });

    // train modes
    $("#modeSeg").addEventListener("click", (e) => { const b = e.target.closest(".seg"); if (b) setMode(b.dataset.mode); });
    $("#coachBtn").addEventListener("click", runCoach);
    $("#exInput").addEventListener("keydown", (e) => { if (e.key === "Enter") runCoach(); });
    $("#recentChips").addEventListener("click", (e) => { const c = e.target.closest("[data-recent]"); if (!c) return; $("#exInput").value = c.dataset.recent; runCoach(); });
    $("#camBtn").addEventListener("click", () => $("#photoInput").click());
    $("#photoInput").addEventListener("change", (e) => {
      if (e.target.files[0]) readImg(e.target.files[0], 1024, (d) => { pendingPhoto = d; $("#photoChip").innerHTML = `📷 photo attached <button id="rmPhoto">✕</button>`; $("#photoChip").classList.remove("hidden"); $("#rmPhoto").addEventListener("click", clearPhoto); });
      e.target.value = "";
    });
    $("#focusChips").addEventListener("click", (e) => {
      const c = e.target.closest(".chip"); if (!c) return;
      c.classList.toggle("active");
      pendingFocus = $$("#focusChips .chip.active").map((x) => x.dataset.focus);
      $("#planBtn").disabled = pendingFocus.length === 0;
    });
    $("#timeChips").addEventListener("click", (e) => {
      const c = e.target.closest(".chip"); if (!c) return;
      timeboxMin = parseInt(c.dataset.min, 10) || 0;
      $$("#timeChips .chip").forEach((x) => x.classList.toggle("active", x === c));
    });
    $("#planBtn").addEventListener("click", runPlan);
    $("#cardioSave").addEventListener("click", saveCardio);
    $("#cardioMod").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; $$("#cardioMod .chip").forEach((x) => x.classList.toggle("active", x === c)); });

    // add exercise mid-workout
    $("#addExGo").addEventListener("click", coachAndAppend);
    $("#addExInput").addEventListener("keydown", (e) => { if (e.key === "Enter") coachAndAppend(); });
    $("#addExCam").addEventListener("click", () => $("#addExPhotoInput").click());
    $("#addExPhotoInput").addEventListener("change", (e) => {
      if (e.target.files[0]) readImg(e.target.files[0], 1024, (d) => { addPendingPhoto = d; $("#addExPhoto").innerHTML = `📷 photo attached <button id="rmAddPhoto">✕</button>`; $("#addExPhoto").classList.remove("hidden"); $("#rmAddPhoto").addEventListener("click", clearAddPhoto); });
      e.target.value = "";
    });

    // workout bar + rest
    $("#wbFinish").addEventListener("click", finishWorkout);
    $("#restSkip").addEventListener("click", stopRest);

    // chat
    $("#chatSend").addEventListener("click", sendChat);
    $("#chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

    // trends
    $("#trendExercise").addEventListener("change", renderChart);
    $$(".chart-tabs .chip2").forEach((c) => c.addEventListener("click", () => { $$(".chart-tabs .chip2").forEach((x) => x.classList.remove("active")); c.classList.add("active"); trendMetric = c.dataset.metric; renderChart(); }));
    $("#niggleAdd").addEventListener("click", () => {
      const area = prompt("Where? (e.g. right shoulder)"); if (!area) return;
      const note = prompt("What's going on? (e.g. pinchy on incline press)") || "";
      Store.addNiggle(area.trim(), note.trim()); renderNiggles(); toast("Logged — I'll program around it");
    });
    $("#niggleList").addEventListener("click", (e) => { const b = e.target.closest("[data-niggle]"); if (b) { Store.cycleNiggle(b.dataset.niggle); renderNiggles(); } });
    $("#photoAddBtn").addEventListener("click", () => $("#physiquePhotoInput").click());
    $("#physiquePhotoInput").addEventListener("change", (e) => {
      if (e.target.files[0]) readImg(e.target.files[0], 480, (d) => { Store.addPhoto(d); renderPhotos(); toast("Photo stored (on-device only)"); });
      e.target.value = "";
    });
    $("#photoAuditBtn").addEventListener("click", runPhotoAudit);

    // me
    $$("#meSex .chip, #meExp .chip").forEach((c) => c.addEventListener("click", () => { const w = c.parentElement; $$(".chip", w).forEach((x) => x.classList.toggle("active", x === c)); }));
    $("#saveMe").addEventListener("click", () => {
      Object.assign(S().profile, {
        sex: chipVal("#meSex"), weightLb: parseFloat($("#meWeight").value) || null,
        heightCm: ftInToCm($("#meFt").value, $("#meIn").value),
        experience: chipVal("#meExp") || "Beginner",
        goalNotes: $("#meNotes").value.trim(), proteinTarget: parseFloat($("#meProtein").value) || null,
        equipmentNotes: $("#meEquip").value.trim(), known: $("#meKnown").value.trim(),
      });
      S().recCache = null; Store.save(); renderToday(); toast("Profile saved");
    });
    $("#saveKey").addEventListener("click", () => { S().settings.apiKey = $("#meKey").value.trim(); S().settings.model = $("#meModel").value; Store.save(); renderToday(); toast("Saved"); });

    $$("[data-data]").forEach((b) => b.addEventListener("click", () => dataAction(b.dataset.data)));
    $("#importFile").addEventListener("change", (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { try { Store.importData(JSON.parse(rd.result)); location.reload(); } catch { toast("Bad file"); } };
      rd.readAsText(f); e.target.value = "";
    });
  }

  /* ---------- boot ---------- */
  bind();
  renderAll();
  restoreActive();
  startOnboardingIfNeeded();
  if (!hasKey() && S().onboarded) setTimeout(() => toast("Add your API key in Me to wake the coach"), 700);
})();
