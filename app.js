/* ============================================================
   app.js — UI + state for the AI strength coach.
   The AI decides every weight and rep; this file is just the
   interface, local storage, and charts. Pounds throughout.
   ============================================================ */

(() => {
  "use strict";

  const KEY = "coach.v1";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const round = (n) => Math.round(n);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- store ---------- */
  const blank = () => ({
    settings: { apiKey: "", model: "claude-opus-4-8" },
    profile: { sex: "", weightLb: null, heightCm: null, experience: "Beginner", goal: "Build muscle", known: "" },
    onboarded: false,
    sessions: [],
  });
  let store = load();
  function load() { try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { return blank(); } }
  function save() { localStorage.setItem(KEY, JSON.stringify(store)); }

  let mode = "single";
  let pendingPhoto = null;
  let pendingFocus = null;
  let trendMetric = "e1rm";

  let toastT;
  function toast(m) { const el = $("#toast"); el.textContent = m; el.classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add("hidden"), 3400); }

  /* ---------- helpers ---------- */
  const wUnit = (perHand) => (perHand ? "lb/hand" : "lb");
  const cmToFtIn = (cm) => cm ? { ft: Math.floor(cm / 2.54 / 12), in: Math.round((cm / 2.54) % 12) } : { ft: "", in: "" };
  const ftInToCm = (ft, i) => { const f = parseInt(ft, 10) || 0, n = parseInt(i, 10) || 0; return f || n ? Math.round((f * 12 + n) * 2.54) : null; };
  const profileReady = () => store.profile.goal && store.profile.experience;
  const hasKey = () => !!store.settings.apiKey;

  function rirSelect(sel) {
    return `<select class="s-rir">` + [0, 1, 2, 3, 4, 5].map((v) =>
      `<option value="${v}"${v === sel ? " selected" : ""}>${v === 0 ? "0 · failure" : v === 5 ? "5+ · easy" : v + " left"}</option>`).join("") + `</select>`;
  }

  /* ---------- history for the coach ---------- */
  function buildHistory(name) {
    const same = store.sessions.filter((s) => s.name.toLowerCase() === (name || "").toLowerCase()).slice(-3)
      .map((s) => ({ date: s.date.slice(0, 10), sets: s.logged, estimatedOneRepMax: s.estimatedOneRepMax }));
    const recent = store.sessions.slice(-6).map((s) => {
      const top = s.logged.reduce((a, b) => (b.weight > (a ? a.weight : -1) ? b : a), null);
      return { name: s.name, date: s.date.slice(0, 10), topSet: top };
    });
    return { thisExercise: same, recentSessions: recent };
  }

  /* ============================================================
     ONBOARDING
     ============================================================ */
  const ob = { step: 0, draft: {} };
  function startOnboardingIfNeeded() {
    if (store.onboarded) return;
    ob.step = 0; ob.draft = Object.assign({}, store.profile);
    $("#onboard").classList.remove("hidden");
    renderOnboard();
  }
  function dots(active, n = 3) { return `<div class="ob-steps">${Array.from({ length: n }, (_, i) => `<div class="ob-dot ${i <= active ? "on" : ""}"></div>`).join("")}</div>`; }
  function chipRow(name, opts, val) {
    return `<div class="chips small" data-chips="${name}">${opts.map((o) => `<button class="chip ${val === o.v ? "active" : ""}" data-v="${o.v}">${o.t}</button>`).join("")}</div>`;
  }
  function renderOnboard() {
    const b = $("#obBody");
    if (ob.step === 0) {
      b.innerHTML = dots(0) +
        `<h2>Let's build your coach</h2><p class="lead">Ninety seconds. I'll use this to nail your very first weights — no guesswork, no "test week."</p>` +
        `<div class="field"><span>Sex</span>${chipRow("sex", [{ v: "Male", t: "Male" }, { v: "Female", t: "Female" }], ob.draft.sex)}</div>` +
        `<div class="row"><label class="field"><span>Bodyweight (lb)</span><input type="number" id="obW" value="${ob.draft.weightLb || ""}" placeholder="180" /></label>` +
        `<label class="field"><span>Height</span><span class="ht"><input type="number" id="obFt" value="${cmToFtIn(ob.draft.heightCm).ft}" placeholder="5" /><i>ft</i><input type="number" id="obIn" value="${cmToFtIn(ob.draft.heightCm).in}" placeholder="10" /><i>in</i></span></label></div>` +
        `<div class="field"><span>Experience</span>${chipRow("experience", [{ v: "Beginner", t: "New" }, { v: "Intermediate", t: "Some" }, { v: "Advanced", t: "Experienced" }], ob.draft.experience)}</div>` +
        `<div class="field"><span>Main goal</span>${chipRow("goal", [{ v: "Build muscle", t: "Build muscle" }, { v: "Get stronger", t: "Get stronger" }, { v: "Endurance", t: "Endurance" }], ob.draft.goal)}</div>` +
        `<div class="ob-actions"><button class="cta" id="obNext">Continue →</button></div>`;
    } else if (ob.step === 1) {
      b.innerHTML = dots(1) +
        `<h2>Know any of your lifts?</h2><p class="lead">Totally optional — but it sharpens your first session. Just rough numbers.</p>` +
        `<label class="field"><span>Lifts you know</span><input type="text" id="obKnown" value="${esc(ob.draft.known || "")}" placeholder="bench 135x8, squat 225x5, curl 30s" /></label>` +
        `<div class="ob-actions"><button class="ghost" id="obSkip">Skip</button><button class="cta" id="obNext">Continue →</button></div>`;
    } else {
      b.innerHTML = dots(2) +
        `<h2>Connect your coach</h2><p class="lead">The coach runs on Claude. Paste an <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic API key</a> — it's stored only on this device and sent straight to Anthropic. You can add it later in <b>Me</b>.</p>` +
        `<label class="field"><span>API key</span><input type="password" id="obKey" value="${esc(store.settings.apiKey)}" placeholder="sk-ant-..." /></label>` +
        `<div class="ob-actions"><button class="ghost" id="obSkip">Later</button><button class="cta" id="obDone">Start training →</button></div>`;
    }
    wireOnboard();
  }
  function wireOnboard() {
    $$("#obBody [data-chips]").forEach((row) => row.addEventListener("click", (e) => {
      const c = e.target.closest(".chip"); if (!c) return;
      ob.draft[row.dataset.chips] = c.dataset.v;
      $$(".chip", row).forEach((x) => x.classList.toggle("active", x === c));
    }));
    const next = $("#obNext");
    if (next) next.addEventListener("click", () => {
      if (ob.step === 0) {
        ob.draft.weightLb = parseFloat($("#obW").value) || null;
        ob.draft.heightCm = ftInToCm($("#obFt").value, $("#obIn").value);
        if (!ob.draft.sex) ob.draft.sex = "";
      } else if (ob.step === 1) { ob.draft.known = $("#obKnown").value.trim(); }
      ob.step++; renderOnboard();
    });
    const skip = $("#obSkip");
    if (skip) skip.addEventListener("click", () => { if (ob.step === 1) ob.draft.known = ($("#obKnown") || {}).value || ob.draft.known; ob.step++; if (ob.step > 2) finishOnboard(); else renderOnboard(); });
    const done = $("#obDone");
    if (done) done.addEventListener("click", () => { store.settings.apiKey = ($("#obKey").value || "").trim(); finishOnboard(); });
  }
  function finishOnboard() {
    Object.assign(store.profile, ob.draft);
    store.onboarded = true; save();
    $("#onboard").classList.add("hidden");
    renderAll();
    toast("You're set. Tell me what you're training 💪");
  }

  /* ============================================================
     TODAY — coaching
     ============================================================ */
  function setStatus(html) { const s = $("#status"); if (html == null) { s.classList.add("hidden"); s.innerHTML = ""; } else { s.classList.remove("hidden"); s.innerHTML = html; } }
  function loadingCycle(msgs) {
    let i = 0; const show = () => setStatus(`<span class="spinner"></span><span class="pulse">${esc(msgs[i])}</span>`);
    show(); const t = setInterval(() => { i = (i + 1) % msgs.length; show(); }, 1600);
    return () => clearInterval(t);
  }

  async function runCoach() {
    if (!ensureReady()) return;
    const name = $("#exInput").value.trim();
    if (!name && !pendingPhoto) { toast("Type an exercise or add a photo"); return; }
    const src = { name, image: pendingPhoto };
    const adapted = buildHistory(name).thisExercise.length > 0;
    $("#result").innerHTML = "";
    const stop = loadingCycle(["Reading your history…", "Sizing you up…", "Choosing your weights…"]);
    try {
      const rx = await AI.coach({
        profile: store.profile, exerciseName: name, imageDataUrl: pendingPhoto,
        history: buildHistory(name), apiKey: store.settings.apiKey, model: store.settings.model,
      });
      stop(); setStatus(null); clearPhoto();
      $("#result").appendChild(exerciseCard(rx, { standalone: true, src, adapted }));
    } catch (e) { stop(); handleErr(e); }
  }

  async function runPlan() {
    if (!ensureReady()) return;
    if (!pendingFocus) { toast("Pick a focus"); return; }
    $("#result").innerHTML = "";
    const stop = loadingCycle([`Planning your ${pendingFocus.toLowerCase()} day…`, "Picking your lifts…", "Setting your weights…"]);
    try {
      const recent = store.sessions.slice(-8).map((s) => ({ name: s.name, date: s.date.slice(0, 10) }));
      const plan = await AI.plan({ profile: store.profile, focus: pendingFocus, history: { recentSessions: recent }, apiKey: store.settings.apiKey, model: store.settings.model });
      stop(); setStatus(null);
      const head = document.createElement("div");
      head.className = "notice";
      head.innerHTML = `<b>${esc(plan.title)}</b><br>${esc(plan.note)}`;
      $("#result").appendChild(head);
      plan.exercises.forEach((ex) => $("#result").appendChild(exerciseCard(ex, { standalone: false })));
    } catch (e) { stop(); handleErr(e); }
  }

  function ensureReady() {
    if (!hasKey()) { switchView("me"); toast("Add your API key to start coaching"); return false; }
    if (!profileReady()) { switchView("me"); toast("Fill in your profile first"); return false; }
    return true;
  }
  function handleErr(e) {
    setStatus(null);
    if (e.message === "NO_KEY") { switchView("me"); toast("Add your API key in Me"); }
    else if (e.status === 401) { switchView("me"); toast("API key rejected — check it in Me"); }
    else toast(e.message || "Something went wrong");
  }

  /* ---------- exercise card ---------- */
  function exerciseCard(rx, ctx) {
    ctx = ctx || {};
    const el = document.createElement("div");
    el.className = "exercise-card";
    el._rx = rx;
    el._src = ctx.src || null;

    const oneRm = rx.estimatedOneRepMax ? `<div class="xc-1rm"><b>${round(rx.estimatedOneRepMax)}</b><small>est 1RM · lb</small></div>` : "";
    const cues = (rx.cues || []).map((c) => `<span class="cue">${esc(c)}</span>`).join("");
    const warm = (rx.warmup || []);
    const work = (rx.workingSets || []);
    const badge = !ctx.standalone ? "" :
      ctx.adapted ? `<span class="badge adapt">↗ Adapted from last time</span>` : `<span class="badge first">Starting point</span>`;
    const feelerHint = rx.readiness === "needs_feeler" ? `<div class="redial-hint">New or hard-to-gauge lift — do set 1, then re-dial to lock your weight.</div>` : "";

    el.innerHTML =
      `<div class="xc-head">${oneRm}<div class="xc-title">${esc(rx.resolvedName)}</div>` +
      `<div class="xc-sub">${esc(rx.muscleGroup)} · ${esc(rx.equipment)}${rx.perHand ? " · per hand" : ""}</div></div>` +
      `<div class="xc-body">` +
      badge +
      (rx.rationale ? `<div class="rationale">${esc(rx.rationale)}</div>` : "") +
      (cues ? `<div class="cues">${cues}</div>` : "") +
      (warm.length ? `<div class="setgroup-label">Warm-up</div>` + warm.map((s, i) => setRow(s, i, true, rx.perHand)).join("") : "") +
      `<div class="setgroup-label">Working sets · ${wUnit(rx.perHand)}</div>` +
      work.map((s, i) => setRow(s, i, false, rx.perHand)).join("") +
      `<button class="redial" data-act="feeler">🎯 Too heavy or light? Do set 1 &amp; re-dial</button>` +
      feelerHint +
      `<div class="card-actions">` +
      `<button class="cta small" data-act="save">Log session</button>` +
      (ctx.standalone && ctx.src ? `<button class="regen" data-act="regen" title="Regenerate">↻</button>` : "") +
      `</div>` +
      `</div>`;

    el.addEventListener("click", (e) => {
      const done = e.target.closest(".donebtn");
      if (done) { done.closest(".setrow").classList.toggle("done"); return; }
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "save") saveCard(el);
      else if (act.dataset.act === "feeler") feelerDialIn(el);
      else if (act.dataset.act === "regen") regenerateCard(el);
    });
    return el;
  }

  async function regenerateCard(el) {
    const src = el._src; if (!src) return;
    const btn = $('[data-act="regen"]', el); btn.textContent = "…"; btn.disabled = true;
    try {
      const rx = await AI.coach({
        profile: store.profile, exerciseName: src.name, imageDataUrl: src.image,
        history: buildHistory(src.name), apiKey: store.settings.apiKey, model: store.settings.model,
      });
      el.replaceWith(exerciseCard(rx, { standalone: true, src, adapted: buildHistory(src.name).thisExercise.length > 0 }));
    } catch (e) { btn.textContent = "↻"; btn.disabled = false; handleErr(e); }
  }

  function setRow(s, i, warm, perHand) {
    return `<div class="setrow ${warm ? "warm" : ""}" data-warm="${warm ? 1 : 0}">` +
      `<span class="setnum">${warm ? "W" : i + 1}</span>` +
      `<input class="s-w" type="number" step="0.5" value="${s.weight}" />` +
      `<span class="x">×</span>` +
      `<input class="s-r" type="number" step="1" value="${s.reps}" />` +
      (warm ? `<span class="unit">warm</span>` : rirSelect(s.targetRIR != null ? s.targetRIR : 1)) +
      `<button class="donebtn" title="Done">✓</button>` +
    `</div>`;
  }

  function readSets(el, workingOnly) {
    return $$(".setrow", el).filter((r) => !workingOnly || r.dataset.warm === "0").map((r) => ({
      warm: r.dataset.warm === "1",
      weight: parseFloat($(".s-w", r).value),
      reps: parseInt($(".s-r", r).value, 10),
      rir: $(".s-rir", r) ? parseInt($(".s-rir", r).value, 10) : null,
      done: r.classList.contains("done"),
    }));
  }

  async function feelerDialIn(el) {
    const rx = el._rx;
    const first = $$(".setrow", el).find((r) => r.dataset.warm === "0");
    if (!first) return;
    const feeler = { weight: parseFloat($(".s-w", first).value), reps: parseInt($(".s-r", first).value, 10), rir: $(".s-rir", first) ? parseInt($(".s-rir", first).value, 10) : 1 };
    if (!(feeler.weight >= 0) || !(feeler.reps > 0)) { toast("Log your first set, then dial in"); return; }
    const btn = $('[data-act="feeler"]', el); const prev = btn.textContent;
    btn.textContent = "Dialing in…"; btn.disabled = true;
    try {
      const nrx = await AI.coach({
        profile: store.profile, exerciseName: rx.resolvedName, history: buildHistory(rx.resolvedName),
        feeler, apiKey: store.settings.apiKey, model: store.settings.model,
      });
      const fresh = exerciseCard(nrx, { standalone: !!el._src, src: el._src, adapted: buildHistory(nrx.resolvedName).thisExercise.length > 0 });
      el.replaceWith(fresh);
      toast("Dialed in from your set 💪");
    } catch (e) { btn.textContent = prev; btn.disabled = false; handleErr(e); }
  }

  function saveCard(el) {
    const rx = el._rx;
    const logged = readSets(el, true).filter((s) => s.reps > 0 && s.weight >= 0)
      .map((s) => ({ weight: s.weight, reps: s.reps, rir: s.rir == null ? null : s.rir }));
    if (!logged.length) { toast("Log at least one working set"); return; }
    store.sessions.push({
      id: uid(), name: rx.resolvedName, muscleGroup: rx.muscleGroup, equipment: rx.equipment, perHand: rx.perHand,
      date: new Date().toISOString(), warmup: rx.warmup || [], workingSets: rx.workingSets || [],
      logged, estimatedOneRepMax: rx.estimatedOneRepMax || null, rationale: rx.rationale || "",
    });
    save();
    el.querySelector(".card-actions").innerHTML = `<div class="notice" style="width:100%">✓ Logged. Next time I'll push you harder or back off based on how that felt.</div>`;
    $("[data-act='feeler']", el)?.remove();
    renderHistory();
    toast("Logged 💪");
  }

  /* ============================================================
     HISTORY + CHART
     ============================================================ */
  function renderHistory() {
    const list = $("#historyList");
    const sorted = store.sessions.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    list.innerHTML = sorted.length ? sorted.map(sessionCard).join("") : `<p class="empty">No sessions yet.</p>`;
    // trend select
    const names = [...new Set(store.sessions.map((s) => s.name))];
    const sel = $("#trendExercise");
    const prev = sel.value;
    sel.innerHTML = names.length ? names.map((n) => `<option>${esc(n)}</option>`).join("") : `<option>—</option>`;
    if (prev && names.includes(prev)) sel.value = prev;
    renderChart();
  }
  function sessionCard(s) {
    const pills = s.logged.map((x) => `<span class="pill">${round(x.weight)}${s.perHand ? "/h" : ""}×${x.reps}${x.rir != null ? ` @${x.rir}` : ""}</span>`).join("");
    const vol = s.logged.reduce((t, x) => t + x.weight * x.reps * (s.perHand ? 2 : 1), 0);
    return `<div class="session"><div class="session-head"><span class="name">${esc(s.name)}</span><span class="date">${fmtDate(s.date)}</span></div>` +
      `<div class="session-sets">${pills}</div><div class="session-meta"><span>Vol ${round(vol)} lb</span>${s.estimatedOneRepMax ? `<span>Est 1RM ${round(s.estimatedOneRepMax)} lb</span>` : ""}</div></div>`;
  }

  function renderChart() {
    const el = $("#chart");
    const name = $("#trendExercise").value;
    const sess = store.sessions.filter((s) => s.name === name).sort((a, b) => new Date(a.date) - new Date(b.date));
    const pts = sess.map((s) => ({
      date: s.date,
      y: trendMetric === "volume" ? s.logged.reduce((t, x) => t + x.weight * x.reps * (s.perHand ? 2 : 1), 0) : s.estimatedOneRepMax,
    })).filter((p) => p.y != null);
    if (pts.length < 1) { el.innerHTML = `<p class="empty">Log sessions to see your trend.</p>`; return; }

    const W = 620, H = 200, pl = 40, pr = 12, pt = 14, pb = 24;
    const ys = pts.map((p) => p.y); let mn = Math.min(...ys), mx = Math.max(...ys);
    if (mn === mx) { mn = Math.max(0, mn - 1); mx += 1; }
    const py = (mx - mn) * 0.15; mn = Math.max(0, mn - py); mx += py;
    const n = pts.length;
    const sx = (i) => pl + (n === 1 ? (W - pl - pr) / 2 : (i / (n - 1)) * (W - pl - pr));
    const sy = (y) => pt + (1 - (y - mn) / (mx - mn)) * (H - pt - pb);
    let grid = "";
    for (let i = 0; i <= 3; i++) {
      const y = pt + (i / 3) * (H - pt - pb);
      const val = round(mx - (i / 3) * (mx - mn));
      grid += `<line x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}" stroke="#26314f"/>` +
        `<text x="${pl - 6}" y="${y + 4}" text-anchor="end" fill="#5b6988" font-size="10">${val}</text>`;
    }
    const line = pts.map((p, i) => `${i ? "L" : "M"} ${sx(i).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
    const area = `${line} L ${sx(n - 1).toFixed(1)} ${H - pb} L ${sx(0).toFixed(1)} ${H - pb} Z`;
    const dots = pts.map((p, i) => `<circle cx="${sx(i).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="4" fill="#33d6c0" stroke="#0b1020" stroke-width="2"><title>${round(p.y)} · ${fmtDate(p.date)}</title></circle>`).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#33d6c0" stop-opacity=".35"/><stop offset="100%" stop-color="#33d6c0" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#g)"/><path d="${line}" fill="none" stroke="#33d6c0" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`;
  }

  /* ============================================================
     ME
     ============================================================ */
  function renderMe() {
    const p = store.profile;
    setChips("#meSex", p.sex); setChips("#meExp", p.experience); setChips("#meGoal", p.goal);
    $("#meWeight").value = p.weightLb || "";
    const h = cmToFtIn(p.heightCm); $("#meFt").value = h.ft; $("#meIn").value = h.in;
    $("#meKnown").value = p.known || "";
    $("#meKey").value = store.settings.apiKey;
    $("#meModel").value = store.settings.model;
  }
  function setChips(sel, val) { $$(`${sel} .chip`).forEach((c) => c.classList.toggle("active", c.dataset.v === val)); }
  function chipVal(sel) { const c = $(`${sel} .chip.active`); return c ? c.dataset.v : ""; }

  /* ============================================================
     RENDER + NAV
     ============================================================ */
  function renderAll() { renderToday(); renderHistory(); renderMe(); }
  function renderToday() {
    const p = store.profile;
    $("#hello").textContent = p.sex || p.weightLb ? "Ready to train?" : "Welcome";
    $("#subhello").textContent = hasKey() ? "Tell me what you're doing." : "Connect your coach to start.";
    $("#keyBanner").classList.toggle("hidden", hasKey());
    // recent-exercise quick chips (unique, most-recent first)
    const seen = new Set(); const recent = [];
    store.sessions.slice().reverse().forEach((s) => { const k = s.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); recent.push(s.name); } });
    $("#recentChips").innerHTML = recent.slice(0, 6).map((n) => `<button class="chip" data-recent="${esc(n)}">${esc(n)}</button>`).join("");
  }
  function switchView(v) {
    $$(".navbtn").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    $$(".view").forEach((s) => s.classList.toggle("active", s.id === `view-${v}`));
    if (v === "today") renderToday();
    if (v === "history") renderHistory();
    if (v === "me") renderMe();
  }

  /* ---------- photo ---------- */
  function handlePhoto(file) {
    const img = new Image();
    const rd = new FileReader();
    rd.onload = () => { img.onload = () => downscale(img); img.src = rd.result; };
    rd.readAsDataURL(file);
  }
  function downscale(img) {
    const max = 1024;
    let { width: w, height: h } = img;
    if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    pendingPhoto = c.toDataURL("image/jpeg", 0.82);
    $("#photoChip").innerHTML = `📷 photo attached <button id="rmPhoto">✕</button>`;
    $("#photoChip").classList.remove("hidden");
    $("#rmPhoto").addEventListener("click", clearPhoto);
  }
  function clearPhoto() { pendingPhoto = null; $("#photoChip").classList.add("hidden"); $("#photoChip").innerHTML = ""; }

  /* ============================================================
     EVENTS
     ============================================================ */
  function bind() {
    $("#nav").addEventListener("click", (e) => { const b = e.target.closest(".navbtn"); if (b) switchView(b.dataset.view); });
    $("#meBtn").addEventListener("click", () => switchView("me"));

    $("#modeSeg").addEventListener("click", (e) => {
      const b = e.target.closest(".seg"); if (!b) return;
      mode = b.dataset.mode;
      $$(".seg").forEach((s) => s.classList.toggle("active", s === b));
      $("#singleEntry").classList.toggle("hidden", mode !== "single");
      $("#planEntry").classList.toggle("hidden", mode !== "plan");
      $("#result").innerHTML = ""; setStatus(null);
    });

    $("#coachBtn").addEventListener("click", runCoach);
    $("#exInput").addEventListener("keydown", (e) => { if (e.key === "Enter") runCoach(); });
    $("#recentChips").addEventListener("click", (e) => { const c = e.target.closest("[data-recent]"); if (!c) return; $("#exInput").value = c.dataset.recent; runCoach(); });
    $("#keyBannerBtn").addEventListener("click", () => switchView("me"));
    $("#camBtn").addEventListener("click", () => $("#photoInput").click());
    $("#photoInput").addEventListener("change", (e) => { if (e.target.files[0]) handlePhoto(e.target.files[0]); e.target.value = ""; });

    $("#focusChips").addEventListener("click", (e) => {
      const c = e.target.closest(".chip"); if (!c) return;
      pendingFocus = c.dataset.focus;
      $$("#focusChips .chip").forEach((x) => x.classList.toggle("active", x === c));
      $("#planBtn").disabled = false;
    });
    $("#planBtn").addEventListener("click", runPlan);

    $("#trendExercise").addEventListener("change", renderChart);
    $$(".chart-tabs .chip2").forEach((c) => c.addEventListener("click", () => { $$(".chart-tabs .chip2").forEach((x) => x.classList.remove("active")); c.classList.add("active"); trendMetric = c.dataset.metric; renderChart(); }));

    // Me
    $$("#meSex .chip, #meExp .chip, #meGoal .chip").forEach((c) => c.addEventListener("click", () => {
      const wrap = c.parentElement; $$(".chip", wrap).forEach((x) => x.classList.toggle("active", x === c));
    }));
    $("#saveMe").addEventListener("click", () => {
      store.profile = { sex: chipVal("#meSex"), weightLb: parseFloat($("#meWeight").value) || null, heightCm: ftInToCm($("#meFt").value, $("#meIn").value), experience: chipVal("#meExp") || "Beginner", goal: chipVal("#meGoal") || "Build muscle", known: $("#meKnown").value.trim() };
      save(); renderToday(); toast("Profile saved");
    });
    $("#saveKey").addEventListener("click", () => { store.settings = { apiKey: $("#meKey").value.trim(), model: $("#meModel").value }; save(); renderToday(); toast("Saved"); });

    $$("[data-data]").forEach((b) => b.addEventListener("click", () => dataAction(b.dataset.data)));
    $("#importFile").addEventListener("change", importData);
  }

  function dataAction(a) {
    if (a === "export") {
      const copy = JSON.parse(JSON.stringify(store)); copy.settings.apiKey = "";
      const blob = new Blob([JSON.stringify(copy, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const el = document.createElement("a"); el.href = url; el.download = `coach-backup-${new Date().toISOString().slice(0, 10)}.json`; el.click(); URL.revokeObjectURL(url);
      toast("Exported (key excluded)");
    } else if (a === "import") $("#importFile").click();
    else if (a === "reset") { if (confirm("Erase everything?")) { store = blank(); save(); renderAll(); startOnboardingIfNeeded(); toast("Cleared"); } }
  }
  function importData(e) {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { try { const d = JSON.parse(rd.result); const k = store.settings.apiKey; store = Object.assign(blank(), d); store.settings.apiKey = k; store.onboarded = true; save(); renderAll(); toast("Imported"); } catch { toast("Bad file"); } };
    rd.readAsText(f); e.target.value = "";
  }

  /* ---------- boot ---------- */
  bind();
  renderAll();
  startOnboardingIfNeeded();
})();
