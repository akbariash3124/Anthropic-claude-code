/* ============================================================
   ai.js — the coach. Every weight, rep, and progression decision
   comes from Claude. Called directly from the browser with the
   user's own key (structured outputs for reliable parsing).
   ============================================================ */

const AI = (function () {
  "use strict";

  const API_URL = "https://api.anthropic.com/v1/messages";
  const VERSION = "2023-06-01";

  const SET = {
    type: "object",
    properties: { weight: { type: "number" }, reps: { type: "integer" }, targetRIR: { type: "integer" } },
    required: ["weight", "reps", "targetRIR"],
    additionalProperties: false,
  };

  const COACH_SCHEMA = {
    type: "object",
    properties: {
      resolvedName: { type: "string", description: "Canonical exercise name." },
      muscleGroup: { type: "string", description: "Primary muscle(s), short." },
      equipment: { type: "string", enum: ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "other"] },
      perHand: { type: "boolean", description: "True if weights are per-hand (dumbbells/kettlebells)." },
      warmup: { type: "array", items: SET },
      workingSets: { type: "array", items: SET },
      estimatedOneRepMax: { type: "number", description: "Your best estimate of the user's 1RM on this lift, lb (0 if bodyweight)." },
      rationale: { type: "string", description: "One or two sentences, referencing their profile/history/feeler." },
      cues: { type: "array", items: { type: "string" }, description: "1-3 short form cues." },
      readiness: { type: "string", enum: ["confident", "estimate", "needs_feeler"] },
    },
    required: ["resolvedName", "muscleGroup", "equipment", "perHand", "warmup", "workingSets", "estimatedOneRepMax", "rationale", "cues", "readiness"],
    additionalProperties: false,
  };

  const PLAN_SCHEMA = {
    type: "object",
    properties: {
      title: { type: "string" },
      note: { type: "string", description: "One-line framing of the session." },
      exercises: {
        type: "array",
        items: {
          type: "object",
          properties: {
            resolvedName: { type: "string" },
            muscleGroup: { type: "string" },
            equipment: { type: "string", enum: ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "other"] },
            perHand: { type: "boolean" },
            warmup: { type: "array", items: SET },
            workingSets: { type: "array", items: SET },
            estimatedOneRepMax: { type: "number" },
            cues: { type: "array", items: { type: "string" } },
          },
          required: ["resolvedName", "muscleGroup", "equipment", "perHand", "warmup", "workingSets", "estimatedOneRepMax", "cues"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "note", "exercises"],
    additionalProperties: false,
  };

  const COACH_SYSTEM =
    "You are a world-class strength coach embedded in a training app. The user names an exercise (or sends a " +
    "photo of a machine) and you prescribe their exact sets to do RIGHT NOW. Be decisive and specific — never " +
    "hedge, never ask questions, never say you need more data.\n\n" +
    "WEIGHTS: pounds. Round to realistic gym increments — barbell to 5 lb, dumbbells to real sizes " +
    "(5,10,12.5,15,20,25,30,35,40,45,50,55,60...), machines/cables to ~5-10 lb. For dumbbells/kettlebells set " +
    "perHand=true and give the per-hand weight.\n\n" +
    "FIRST-SESSION COMPETENCE: even with NO logged history, produce a confident, well-judged starting weight from " +
    "the user's sex, bodyweight, height, experience, and goal — exactly like an expert coach sizing up a new client. " +
    "Do not lowball into uselessness and do not ask them to 'test' first.\n\n" +
    "AUTOREGULATE DECISIVELY: when history or a feeler set is provided, correct hard in ONE step. If they beat the " +
    "target reps or left 3+ in reserve, add meaningful load. If they missed reps or hit failure early, drop load. " +
    "The user should be at the right weight by their second session at the latest — never creep by tiny amounts.\n\n" +
    "REP RANGES by goal (adapt per exercise): build muscle 8-12, get stronger 3-6, endurance 12-20. Give a short " +
    "warmup ramp for barbell/compound lifts; skip warmup for small isolation moves. Working sets carry a target RIR " +
    "(usually 1-2; 2-3 for the first exposure to a new lift). Provide estimatedOneRepMax (your best guess of their " +
    "1RM on this lift in lb; 0 for bodyweight) so the app can chart strength. Set readiness: 'confident' with good " +
    "history, 'estimate' for a fresh prescription from profile, 'needs_feeler' only if the movement is genuinely " +
    "hard to gauge. Rationale = one or two sentences that reference their profile/history/feeler. cues = 1-3 short " +
    "form cues. If a photo is provided, identify the exercise/machine first, then prescribe.";

  const PLAN_SYSTEM =
    "You are a world-class strength coach. Build a complete, well-ordered training session for the requested focus, " +
    "tailored to the user's profile and recent history. Choose 4-6 exercises (compounds first, then accessories/" +
    "isolation), and for EACH prescribe warmup (where sensible) and working sets with pounds, reps, and target RIR, " +
    "plus estimatedOneRepMax and 1-2 cues. Same weighting rules as usual: realistic increments, decisive loads from " +
    "profile even without history, per-hand for dumbbells. Keep it efficient and balanced for the goal.";

  function headers(key) {
    return {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }

  async function call(body, key) {
    const res = await fetch(API_URL, { method: "POST", headers: headers(key), body: JSON.stringify(body) });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error?.message || ""; } catch {}
      const err = new Error(detail || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    if (data.stop_reason === "refusal") throw new Error("The coach declined this request.");
    const text = (data.content || []).find((b) => b.type === "text");
    if (!text) throw new Error("Empty response from the coach.");
    try { return JSON.parse(text.text); } catch { throw new Error("Could not read the coach's response."); }
  }

  function parseDataUrl(u) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(u || "");
    return m ? { mediaType: m[1], data: m[2] } : null;
  }

  // opts: { profile, exerciseName, imageDataUrl, history, feeler, apiKey, model }
  async function coach(opts) {
    const key = (opts.apiKey || "").trim();
    if (!key) throw new Error("NO_KEY");

    const payload = {
      unit: "lb",
      profile: opts.profile,
      goal: opts.profile && opts.profile.goal,
      exercise: opts.exerciseName || null,
      history: opts.history || null,
      feelerSet: opts.feeler || null,   // {weight, reps, rir} the user just did, to dial in the rest
    };

    const content = [];
    const img = opts.imageDataUrl && parseDataUrl(opts.imageDataUrl);
    if (img) content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
    content.push({
      type: "text",
      text:
        (img ? "Identify the exercise/machine in the photo, then prescribe today's sets.\n" :
               "Prescribe today's sets for this exercise.\n") +
        "```json\n" + JSON.stringify(payload, null, 2) + "\n```\n" +
        "Return the prescription as structured output.",
    });

    return call({
      model: opts.model || "claude-opus-4-8",
      max_tokens: 1200,
      system: COACH_SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { format: { type: "json_schema", schema: COACH_SCHEMA } },
    }, key);
  }

  // opts: { profile, focus, history, apiKey, model }
  async function plan(opts) {
    const key = (opts.apiKey || "").trim();
    if (!key) throw new Error("NO_KEY");
    const payload = { unit: "lb", profile: opts.profile, goal: opts.profile && opts.profile.goal, focus: opts.focus, recentHistory: opts.history || null };
    return call({
      model: opts.model || "claude-opus-4-8",
      max_tokens: 3000,
      system: PLAN_SYSTEM,
      messages: [{ role: "user", content: "Build the session.\n```json\n" + JSON.stringify(payload, null, 2) + "\n```\nReturn structured output." }],
      output_config: { format: { type: "json_schema", schema: PLAN_SCHEMA } },
    }, key);
  }

  return { coach, plan };
})();

if (typeof window !== "undefined") window.AI = AI;
