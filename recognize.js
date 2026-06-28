/* ============================================================
   recognize.js — AI exercise/machine identifier.

   The ONLY AI in the app. Given a photo of a machine/exercise OR a
   typed name, Claude returns METADATA ONLY: canonical name, movement
   pattern, load type, and a coefficient (the exercise's 1RM as a
   fraction of its pattern's reference lift). This metadata seeds the
   deterministic engine — the AI never chooses a weight or rep target,
   so the "no LLM in the prescription path" rule is preserved.
   ============================================================ */

const Recognize = (function () {
  "use strict";

  const API_URL = "https://api.anthropic.com/v1/messages";
  const ANTHROPIC_VERSION = "2023-06-01";

  const PATTERNS = ["vertical_push", "horizontal_push", "vertical_pull", "horizontal_pull", "squat", "hinge"];
  const LOAD_TYPES = ["barbell", "dumbbell_pair", "dumbbell_single", "machine", "bodyweight", "bodyweight_loaded"];

  const SCHEMA = {
    type: "object",
    properties: {
      name: { type: "string", description: "Canonical exercise name, e.g. 'Hammer Strength Iso-Lateral Row'." },
      pattern: { type: "string", enum: PATTERNS },
      loadType: { type: "string", enum: LOAD_TYPES },
      isBodyweight: { type: "boolean", description: "True if load is the body itself (no external weight)." },
      coeff: { type: "number", description: "Exercise 1RM as a fraction of the pattern's reference lift. 0 if bodyweight." },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      notes: { type: "string", description: "Brief note: what it is and why this pattern/coeff." },
    },
    required: ["name", "pattern", "loadType", "isBodyweight", "coeff", "confidence", "notes"],
    additionalProperties: false,
  };

  const SYSTEM =
    "You identify resistance-training exercises for a strength engine. You are given a PHOTO of a " +
    "machine/exercise and/or a name. Identify the canonical exercise and classify it. Never prescribe " +
    "weights, reps, or sets — output classification only.\n\n" +
    "Movement patterns and their barbell reference lifts:\n" +
    "- vertical_push (ref: Overhead Press)\n- horizontal_push (ref: Bench Press)\n" +
    "- vertical_pull (ref: Weighted Pull-up)\n- horizontal_pull (ref: Barbell Row)\n" +
    "- squat (ref: Back Squat)\n- hinge (ref: Deadlift)\n\n" +
    "coeff = the exercise's estimated 1RM as a FRACTION of that pattern's reference lift, for a typical " +
    "trainee. Calibrate against these known values: Overhead Press 1.0, Dumbbell Shoulder Press 0.90, " +
    "Lateral Raise 0.22, Bench 1.0, Incline Bench 0.85, Tricep Pushdown 0.30, Pulldown 0.85, " +
    "Straight-arm Pulldown 0.35, Barbell Row 1.0, Cable Row 0.85, Face Pull 0.30, Bicep Curl 0.40, " +
    "Back Squat 1.0, Leg Press 1.80, Leg Extension 0.45, Deadlift 1.0, Romanian Deadlift 0.80, " +
    "Hip Thrust 0.90, Leg Curl 0.35. Machines that stack many plates (leg press, hack squat) have " +
    "coeff > 1. Isolation movements are low (0.2–0.5). If bodyweight, set isBodyweight true and coeff 0.\n\n" +
    "loadType: barbell, dumbbell_pair (two dumbbells), dumbbell_single (one), machine (plate stack/leverage/cable), " +
    "bodyweight, or bodyweight_loaded (dips/pull-ups with added weight).";

  function parseDataUrl(dataUrl) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
    if (!m) return null;
    return { mediaType: m[1], data: m[2] };
  }

  // opts: { name?, imageDataUrl?, apiKey, model }
  async function identify({ name, imageDataUrl, apiKey, model }) {
    const key = (apiKey || "").trim();
    if (!key) throw new Error("NO_KEY");
    if (!name && !imageDataUrl) throw new Error("Give a name or a photo.");

    const content = [];
    const img = imageDataUrl && parseDataUrl(imageDataUrl);
    if (img) {
      content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
    }
    content.push({
      type: "text",
      text:
        (name ? `Name hint: "${name}".\n` : "") +
        (img ? "Identify the exercise/machine in the photo and classify it." :
               "Classify this exercise by name.") +
        " Return the classification as structured output.",
    });

    const body = {
      model: model || "claude-opus-4-8",
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
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
    if (data.stop_reason === "refusal") throw new Error("The model declined to identify that.");
    const text = (data.content || []).find((b) => b.type === "text");
    if (!text) throw new Error("No identification returned.");
    let r;
    try { r = JSON.parse(text.text); } catch { throw new Error("Could not parse the identification."); }

    return {
      name: r.name,
      pattern: r.pattern,
      loadType: r.isBodyweight ? "bodyweight" : r.loadType,
      coeff: r.isBodyweight ? null : r.coeff,
      confidence: r.confidence,
      notes: r.notes,
    };
  }

  return { identify };
})();

if (typeof window !== "undefined") window.Recognize = Recognize;
