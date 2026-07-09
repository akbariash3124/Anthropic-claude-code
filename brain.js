/* ============================================================
   brain.js — every AI call. Each one receives the Athlete Model
   + the Observatory distillation, so the coach always reasons
   from your full measured state, never from a blank slate.

   Calls: coach (single exercise / photo / swap / re-dial / rescale),
   plan (session builder), dailyFocus (what's due + cardio),
   weeklyReview (deep analysis w/ extended thinking + adversarial
   critique pass), chat, debrief (post-workout + model notes),
   photoAudit (monthly physique check).
   ============================================================ */

const Brain = (function () {
  "use strict";

  const API_URL = "https://api.anthropic.com/v1/messages";
  const VERSION = "2023-06-01";

  /* ================= schemas ================= */
  const SET = {
    type: "object",
    properties: { weight: { type: "number" }, reps: { type: "integer" }, targetRIR: { type: "integer" } },
    required: ["weight", "reps", "targetRIR"], additionalProperties: false,
  };
  const MUSCLES = {
    type: "array",
    items: { type: "object", properties: { name: { type: "string", description: "lowercase muscle, e.g. chest, back, side delts, triceps, quads, hamstrings, glutes, biceps, calves, abs" }, fraction: { type: "number", description: "hard-set credit 0.25-1.0" } }, required: ["name", "fraction"], additionalProperties: false },
  };
  const EX_FIELDS = {
    resolvedName: { type: "string" },
    muscleGroup: { type: "string", description: "Short human label, e.g. 'Chest, triceps'." },
    muscles: MUSCLES,
    equipment: { type: "string", enum: ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "other"] },
    perHand: { type: "boolean" },
    warmup: { type: "array", items: SET },
    workingSets: { type: "array", items: SET },
    estimatedOneRepMax: { type: "number" },
    restSeconds: { type: "integer" },
    unitLabel: { type: "string", description: "'lb' normally. If the machine uses a numbered stack / non-lb increments (known from athlete notes or their adjustNote), the unit to prescribe in, e.g. 'level' or 'plate #'." },
    cues: { type: "array", items: { type: "string" } },
  };
  const COACH_SCHEMA = {
    type: "object",
    properties: Object.assign({}, EX_FIELDS, {
      rationale: { type: "string" },
      readiness: { type: "string", enum: ["confident", "estimate", "needs_feeler"] },
    }),
    required: Object.keys(EX_FIELDS).concat(["rationale", "readiness"]), additionalProperties: false,
  };
  const PLAN_SCHEMA = {
    type: "object",
    properties: {
      title: { type: "string" }, note: { type: "string" },
      exercises: { type: "array", items: { type: "object", properties: EX_FIELDS, required: Object.keys(EX_FIELDS), additionalProperties: false } },
    },
    required: ["title", "note", "exercises"], additionalProperties: false,
  };
  const FOCUS_SCHEMA = {
    type: "object",
    properties: {
      restDay: { type: "boolean" },
      recommendedFocus: { type: "array", items: { type: "string" } },
      headline: { type: "string" },
      rationale: { type: "string" },
      muscleStatus: { type: "array", items: { type: "object", properties: { muscle: { type: "string" }, status: { type: "string", enum: ["ready", "recovering", "overdue"] }, lastTrained: { type: "string" } }, required: ["muscle", "status", "lastTrained"], additionalProperties: false } },
      cardio: { type: "object", properties: { recommend: { type: "boolean" }, modality: { type: "string" }, minutes: { type: "integer" }, timing: { type: "string" }, why: { type: "string" } }, required: ["recommend", "modality", "minutes", "timing", "why"], additionalProperties: false },
    },
    required: ["restDay", "recommendedFocus", "headline", "rationale", "muscleStatus", "cardio"], additionalProperties: false,
  };
  const REVIEW_SCHEMA = {
    type: "object",
    properties: {
      headline: { type: "string" },
      analysis: { type: "string", description: "The full written review, several paragraphs, direct and specific." },
      recompVerdict: { type: "object", properties: { status: { type: "string", enum: ["on_track", "lean_gaining", "too_aggressive", "stalled", "insufficient_data"] }, note: { type: "string" } }, required: ["status", "note"], additionalProperties: false },
      muscleTargets: { type: "array", items: { type: "object", properties: { muscle: { type: "string" }, setsLow: { type: "integer" }, setsHigh: { type: "integer" }, note: { type: "string" } }, required: ["muscle", "setsLow", "setsHigh", "note"], additionalProperties: false } },
      blockCall: { type: "object", properties: { action: { type: "string", enum: ["continue", "deload", "new_block"] }, weekNum: { type: "integer" }, note: { type: "string" } }, required: ["action", "weekNum", "note"], additionalProperties: false },
      specialization: { type: "object", properties: { muscles: { type: "array", items: { type: "string" } }, note: { type: "string" } }, required: ["muscles", "note"], additionalProperties: false },
      experiment: { type: "object", properties: { status: { type: "string", enum: ["none", "start", "continue", "conclude"] }, description: { type: "string" }, finding: { type: "string" } }, required: ["status", "description", "finding"], additionalProperties: false },
      dietCall: { type: "object", properties: { mode: { type: "string", enum: ["hold_deficit", "tighten", "maintenance_break", "surplus_nudge"] }, note: { type: "string" } }, required: ["mode", "note"], additionalProperties: false },
      nutritionCall: { type: "object", properties: { calories: { type: "integer" }, protein: { type: "integer" }, carbs: { type: "integer" }, fat: { type: "integer" }, note: { type: "string" } }, required: ["calories", "protein", "carbs", "fat", "note"], additionalProperties: false },
      cardioCall: { type: "object", properties: { weeklyMinutes: { type: "integer" }, note: { type: "string" } }, required: ["weeklyMinutes", "note"], additionalProperties: false },
      stalls: { type: "array", items: { type: "object", properties: { exercise: { type: "string" }, question: { type: "string" } }, required: ["exercise", "question"], additionalProperties: false } },
      exerciseCalls: { type: "array", items: { type: "object", properties: { exercise: { type: "string" }, call: { type: "string", enum: ["keep", "rotate_out", "watch"] }, note: { type: "string" } }, required: ["exercise", "call", "note"], additionalProperties: false } },
      athleteModel: { type: "string", description: "The COMPLETE updated Athlete Model notebook (replaces the old one). Consolidate pending notes." },
      weeklyRollup: { type: "string", description: "Compact 4-6 sentence factual summary of the week for long-term memory." },
      blockRollup: { type: "string", description: "Only when blockCall.action=new_block: compact summary of the finished block and its findings. Else empty string." },
    },
    required: ["headline", "analysis", "recompVerdict", "muscleTargets", "blockCall", "specialization", "experiment", "dietCall", "nutritionCall", "cardioCall", "stalls", "exerciseCalls", "athleteModel", "weeklyRollup", "blockRollup"],
    additionalProperties: false,
  };
  const MEAL_SCHEMA = {
    type: "object",
    properties: {
      name: { type: "string", description: "Short meal name, e.g. 'Chicken burrito bowl'." },
      items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, calories: { type: "integer" }, protein: { type: "integer" }, carbs: { type: "integer" }, fat: { type: "integer" } }, required: ["name", "calories", "protein", "carbs", "fat"], additionalProperties: false } },
      calories: { type: "integer" }, protein: { type: "integer" }, carbs: { type: "integer" }, fat: { type: "integer" },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      assumptions: { type: "string", description: "Key portion assumptions in one short line, e.g. 'assumed ~1.5 cups rice, 6oz chicken'." },
    },
    required: ["name", "items", "calories", "protein", "carbs", "fat", "confidence", "assumptions"],
    additionalProperties: false,
  };
  const TARGETS_SCHEMA = {
    type: "object",
    properties: { calories: { type: "integer" }, protein: { type: "integer" }, carbs: { type: "integer" }, fat: { type: "integer" }, rationale: { type: "string" } },
    required: ["calories", "protein", "carbs", "fat", "rationale"], additionalProperties: false,
  };
  const RECIPE_ITEM = {
          type: "object",
          properties: {
            name: { type: "string" },
            hook: { type: "string", description: "1-2 sentences selling WHY this is delicious — flavors, textures. Make them hungry." },
            servings: { type: "integer" },
            perServing: { type: "object", properties: { calories: { type: "integer" }, protein: { type: "integer" }, carbs: { type: "integer" }, fat: { type: "integer" } }, required: ["calories", "protein", "carbs", "fat"], additionalProperties: false },
            prepMinutes: { type: "integer" },
            keepsDays: { type: "integer", description: "Days it keeps in the fridge." },
            ingredients: { type: "array", items: { type: "string" } },
            steps: { type: "array", items: { type: "string" }, description: "Short, confident steps. No fluff." },
            prepNote: { type: "string", description: "Storage/reheat/pack tip for eating it over several days." },
          },
          required: ["name", "hook", "servings", "perServing", "prepMinutes", "keepsDays", "ingredients", "steps", "prepNote"],
          additionalProperties: false,
  };
  const SUGGEST_SCHEMA = {
    type: "object",
    properties: {
      intro: { type: "string", description: "One punchy line responding to what they asked for." },
      suggestions: { type: "array", items: RECIPE_ITEM },
    },
    required: ["intro", "suggestions"], additionalProperties: false,
  };
  const GROCERY_SCHEMA = {
    type: "object",
    properties: {
      intro: { type: "string" },
      sections: { type: "array", items: { type: "object", properties: { title: { type: "string" }, items: { type: "array", items: { type: "object", properties: { item: { type: "string" }, note: { type: "string", description: "Why / what it's for, few words." } }, required: ["item", "note"], additionalProperties: false } } }, required: ["title", "items"], additionalProperties: false } },
      mealIdeas: { type: "array", items: { type: "string" }, description: "3-5 meals this haul can turn into." },
    },
    required: ["intro", "sections", "mealIdeas"], additionalProperties: false,
  };
  const MEALPLAN_SCHEMA = {
    type: "object",
    properties: {
      intro: { type: "string", description: "One punchy line framing the plan." },
      recipes: { type: "array", items: RECIPE_ITEM, description: "2-4 meal-prep recipes that together cover the coming days." },
      eatingPlan: { type: "string", description: "2-4 sentences: how to eat these across the days — what pairs with what, rough daily shape, where snacks fit vs the targets." },
      groceries: { type: "array", items: { type: "object", properties: { title: { type: "string" }, items: { type: "array", items: { type: "object", properties: { item: { type: "string" }, note: { type: "string" } }, required: ["item", "note"], additionalProperties: false } } }, required: ["title", "items"], additionalProperties: false }, description: "ONE combined shopping list for all recipes, by store section." },
    },
    required: ["intro", "recipes", "eatingPlan", "groceries"], additionalProperties: false,
  };
  const BRIEF_SCHEMA = {
    type: "object",
    properties: {
      brief: { type: "string", description: "The morning brief: 3-5 punchy sentences, no lists, no headers." },
    },
    required: ["brief"], additionalProperties: false,
  };

  const DEBRIEF_SCHEMA = {
    type: "object",
    properties: {
      debrief: { type: "string", description: "2-3 sentences: what today's numbers mean, PRs, what changes next time." },
      modelNote: { type: "string", description: "One factual note worth remembering about the athlete from this session, or empty string." },
    },
    required: ["debrief", "modelNote"], additionalProperties: false,
  };
  const AUDIT_SCHEMA = {
    type: "object",
    properties: {
      verdict: { type: "string", description: "Direct physique-trend read: what changed, where, recomp assessment." },
      modelNote: { type: "string" },
    },
    required: ["verdict", "modelNote"], additionalProperties: false,
  };

  /* ================= system prompts ================= */
  const CORE =
    "You are an elite hypertrophy & recomposition coach embedded in a single-athlete training app. The athlete's goal " +
    "is RECOMP: build muscle while losing fat. You receive their full measured state on every call: profile, free-form " +
    "goal notes, the Athlete Model (your own accumulated notebook about them), a volume ledger (fractional hard sets " +
    "per muscle this week vs targets), e1RM trends, prediction-engine metrics (how their logged sets compare to your " +
    "prescriptions: rep accuracy, RIR reporting bias, fatigue curve), bodyweight trend, cardio load, readiness, active " +
    "niggles, block/diet phase, and long-term memory rollups. USE ALL OF IT — reference specific numbers. Be decisive; " +
    "never hedge or ask permission.\n\n" +
    "Weights in pounds, realistic gym increments (barbell 5s, dumbbells real sizes, machines 5-10s). perHand=true for " +
    "dumbbells/kettlebells with per-hand weight. Honor RIR bias: if predictionEngine.meanRIRGapVsTarget shows they " +
    "consistently sandbag or overshoot, silently correct your targets. Respect fatigue curve when setting later sets. " +
    "Respect activeNiggles: never program into a flagged joint; prefer swaps and note it. During a deficit, protect " +
    "the key lifts; if dietPhase says deficit and lifts are sliding, bias volume down, intensity maintained. " +
    "Deload week (block.phase=deload): everything light and crisp, RIR 3-4.\n\n" +
    "NUTRITION CONTEXT: the context includes nutrition — AI-set targets, today's logged intake (with meal times), 7-day " +
    "averages and logging adherence, recent meals, and free-form foodNotes (likes/dislikes/allergies). Use it: if protein " +
    "is behind today or intake is chronically under/over target, say so where relevant.\n\n" +
    "TIME AWARENESS: context.now carries the CURRENT date, day of week, and local time in the athlete's timezone " +
    "(America/Vancouver — Pacific). Every history item is dated (sessions carry dayOfWeek + daysAgo; today's meals carry " +
    "times). Reason with real time: notice gaps and missed days ('you haven't trained since Tuesday — 4 days'), late-day " +
    "protein deficits, whether a lift was hit earlier TODAY, and where they are in the training week. Never guess the date.\n\n" +
    "PERMANENT MEMORY: context.memory contains lifetime stats, an index of EVERY lift ever trained (allLiftsEverTrained: " +
    "count, first/last date, best e1RM), weekly rollups, and the career summary of past blocks. Old history is never " +
    "irrelevant — reference it when useful ('you benched 205 back in March; you're past that now').\n\n" +
    "THE DOSSIER: context.dossier is permanent, baked-in ground truth about this athlete (identity, DEXA body composition, " +
    "measured RMR, strength benchmarks, enhancement protocol, food identity), and profile.dossier holds his own permanent " +
    "additions. Treat both as authoritative. When profile.stats carries MEASURED numbers (DEXA body fat %, lean mass, " +
    "RMR), always anchor to measurements over formula estimates: protein scales to LEAN mass, energy math starts from the " +
    "measured RMR.\n\n" +
    "CYCLE AWARENESS: if context.cycle is present, the athlete runs a hormonal protocol he chose (see dossier). You are " +
    "his coach, not his doctor — never moralize, never lecture. Use it: recovery, nutrient partitioning, and volume " +
    "tolerance are elevated, so program and set nutrition targets for the enhanced context. cycle carries per-compound " +
    "day-of-cycle, adherence (missed pins, due today), and estimated blood level vs steady state — reference it when " +
    "relevant ('tren just hit steady state this week — expect strength to move fast') and remind him of due/missed pins " +
    "in daily focus. Stay alert on his behalf: if check-ins, niggles, or chat hint at poor sleep, night sweats, mood " +
    "swings, cardio decline, or BP-adjacent symptoms, flag it plainly and without judgment.";

  const FOOD_CORE =
    "You are also this athlete's nutrition coach, and your food philosophy is non-negotiable: DELICIOUS FIRST. " +
    "Never suggest joyless bro-food (plain chicken-rice-broccoli, dry tilapia, sad salads). Every suggestion must be " +
    "something a good cook would be excited to eat — bold flavors, sauces, texture contrast, real seasoning — that " +
    "*happens* to hit the macros. Default format is MEAL PREP: 3-4 servings, fridge-stable for days, packable, " +
    "reheats well. Respect foodNotes (likes/dislikes/allergies) religiously, use recentMealNames for variety, and fit " +
    "suggestions to what's LEFT of today's targets and the recomp phase (deficit: high-protein, high-volume, " +
    "satiating; maintenance: more room to play).";

  const COACH_SYSTEM = CORE + "\n\n" +
    "TASK: prescribe TODAY'S sets for one exercise (or identify it from a photo first). Rules:\n" +
    "- First exposure with no history: confident starting weight from profile + comparable lifts. Never lowball into uselessness.\n" +
    "- With history: autoregulate hard in ONE step from last performance (beat targets/high RIR -> meaningful jump; missed -> drop).\n" +
    "- feelerSet given: correct today's remaining prescription from it immediately.\n" +
    "- completedSets + remainingCount given: athlete is MID-EXERCISE. Return EXACTLY remainingCount working sets, adjusted from how the completed sets went. Do not repeat completed sets.\n" +
    "- readinessAdjust given (e.g. 'running ~8% below prediction today'): scale accordingly.\n" +
    "- swapFor given: the athlete can't/won't do that exercise (reason included). If the reason names target equipment " +
    "(e.g. 'give me the dumbbell version'), convert the SAME movement to that equipment with correctly re-derived loads " +
    "(dumbbell total ≈ 80-90% of barbell; per-hand weights). Otherwise pick the best same-stimulus substitute. Respect equipmentNotes.\n" +
    "- adjustNote given: direct feedback on YOUR current prescription for this exercise — obey it exactly and decisively. " +
    "'First set too heavy' -> cut the load meaningfully. 'This machine is numbered 1-15, not pounds' -> re-prescribe in " +
    "stack levels with unitLabel set (estimate the right level from context; levels are small integers). '3 sets not 4' -> 3 sets. " +
    "Their word beats your estimate, always.\n" +
    "- unitLabel: 'lb' unless the machine is known (athlete model / adjustNote) to use numbered increments — then prescribe " +
    "whole stack levels and set unitLabel (e.g. 'level').\n" +
    "- timeboxMinutes given: fit the work to the time (fewer sets, antagonist supersets in cues, shorter rest).\n" +
    "- muscles: fractional hard-set credit per muscle (sum roughly 1.5-2.0 for compounds, 1.0-1.25 isolation) — this drives their volume ledger, be accurate.\n" +
    "- Rep ranges: hypertrophy 5-12 by movement (compounds lower, isolation higher), respect their goal notes.\n" +
    "- Warmup ramp for heavy compounds only. restSeconds realistic.";

  const PLAN_SYSTEM = CORE + "\n\n" +
    "TASK: build a complete session for the requested focus. 4-6 exercises, compounds first. Choose exercises using the " +
    "volume ledger (fill gaps vs weekly targets), exercise ROI (favor what's producing for them), specialization muscles " +
    "(extra volume if set), muscleFreshness, niggles, and their equipment. Every exercise fully prescribed (warmup where " +
    "sensible, working sets, muscles fractions, rest, 1-2 cues). timeboxMinutes given -> fit the session to it honestly.";

  const FOCUS_SYSTEM = CORE + "\n\n" +
    "TASK: the athlete opened the app — tell them exactly what to train TODAY. Use context.now + session dates to call " +
    "out gaps plainly ('It's Friday — you haven't lifted since Tuesday, chest is overdue'). Use the volume ledger vs " +
    "weekly targets (what's underfed this week?), muscleFreshness, adherence patterns, block week, and readiness. If they've earned a " +
    "rest day, say so (restDay=true). ALWAYS make the cardio call: they are a cardio novice on a recomp — low-friction " +
    "zone-2 only (incline walk, easy bike), progressed by minutes never intensity, scheduled after lifting or standalone, " +
    "never before legs; factor cardio.minutesThisWeek vs the current weekly cardio target. Be specific and punchy.";

  const REVIEW_SYSTEM = CORE + "\n\n" +
    "TASK: the WEEKLY DEEP REVIEW — your Sunday coach's analysis. Think hard. Cover:\n" +
    "1. RECOMP ADJUDICATION: bodyweight trend vs strength trend — now WITH the logged intake data (nutrition.last7d vs " +
    "targets). When context.dexaHistory has more than one scan, the DEXA deltas (lean mass up? fat mass down?) are the " +
    "gold standard — adjudicate against them over scale-weight inference, and note the next scan is due monthly. " +
    "Falling weight + rising lifts = on track. Falling fast + sliding lifts = too aggressive. Flat everything: " +
    "check intake first — if they're logging over target, the diet is the problem, not the training. Also issue " +
    "nutritionCall: next week's calorie/protein/carb/fat targets, adjusted from the real intake + trend data (protein " +
    "~0.8-1g/lb; move calories in 100-200 steps).\n" +
    "2. VOLUME: per-muscle targets for next week from this week's ledger, response data, specialization, and recovery.\n" +
    "3. BLOCK: continue (increment weekNum), deload (fatigue signals: RIR drift, rep quality decay, 5+ weeks accumulating), " +
    "or new_block (after deload / experiment concluded).\n" +
    "4. EXPERIMENTS: run n=1 dose-response tests across blocks (e.g. chest 12 vs 16 sets) — start/continue/conclude with findings.\n" +
    "5. EXERCISE ROI: rotate out flat exercises (>=6 exposures, no trend), keep producers.\n" +
    "6. STALLS: lifts flat 3+ exposures -> one diagnostic question each for the athlete.\n" +
    "7. CARDIO DOSE: next week's zone-2 minutes (novice-friendly progression; cut it if lifts sliding in deficit).\n" +
    "8. ATHLETE MODEL: rewrite the complete notebook — consolidate pendingCoachNotes, add this week's learnings (responder " +
    "patterns, RIR calibration, niggle status, what worked). Keep it dense, factual, under 400 words.\n" +
    "9. weeklyRollup: compact factual memory of this week — it is your PERMANENT archive, so it must capture: sessions " +
    "trained (count + days), key lifts and PRs with numbers, avg calories/protein logged and adherence, bodyweight trend, " +
    "cardio minutes, and anything future-you needs to reconstruct this week.\n" +
    "The analysis must cite actual numbers from the data. No generic advice.";

  const MEAL_SYSTEM = CORE + "\n\n" +
    "TASK: estimate the nutrition of a meal from a photo and/or description. Itemize what you see, estimate portions " +
    "like an experienced nutrition coach (use plate/hand/container size cues), and total it. Be decisive — give your " +
    "best single estimate, not ranges. State your key portion assumptions in one line. confidence: high (clear, " +
    "standard foods), medium (some guessing), low (sauces/oils/hidden ingredients could swing it). If the user " +
    "provides a correction to a prior estimate, re-estimate honoring their correction exactly.";

  const TARGETS_SYSTEM = CORE + "\n\n" +
    "TASK: set daily nutrition targets for this recomp athlete from their profile, bodyweight/trend, training load, " +
    "and goal notes. If profile.stats has a measured RMR, build maintenance from it (RMR × activity from training/cardio " +
    "load) instead of formulas; if DEXA lean mass is present, set protein from lean mass (1.0-1.2 g/lb lean; up to " +
    "~1.3-1.5 g/lb lean when context.cycle shows an active protocol). Recomp defaults: moderate deficit (~300-500 below " +
    "maintenance), fat not below ~0.3g/lb bodyweight, rest carbs. Round to clean numbers. Rationale: 1-2 sentences citing " +
    "the measured numbers used.";

  const SUGGEST_SYSTEM = CORE + "\n\n" + FOOD_CORE + "\n\n" +
    "TASK: the athlete tells you a craving, a situation, or just asks what to eat. Give 2-3 meal-prep suggestions " +
    "(or 3-4 quick options if they clearly want a snack/single meal — then servings=1, keepsDays as appropriate). " +
    "The hook must make them hungry. Steps are short and confident. Per-serving macros must be honest estimates.";

  const GROCERY_SYSTEM = CORE + "\n\n" + FOOD_CORE + "\n\n" +
    "TASK: the athlete is at (or heading to) a store. Build a focused shopping list organized by store section — " +
    "proteins, produce, carbs/pantry, dairy, flavor-makers (sauces/spices — the difference between boring and " +
    "delicious), smart snacks. Note why each item earns its place. Then 3-5 meals the haul turns into. Fit the " +
    "week's targets and their foodNotes; account for savedRecipes they already rotate.";

  const MEALPLAN_SYSTEM = CORE + "\n\n" + FOOD_CORE + "\n\n" +
    "TASK: the athlete wants his next few days of eating planned — RIGHT NOW, whenever he asks, not on any fixed day. " +
    "Build 2-4 meal-prep recipes (3-4 servings each, fridge-stable) that TOGETHER cover roughly the number of days he " +
    "asked for (default ~4 days if unspecified), hit his daily calorie/protein targets when combined with reasonable " +
    "snacks, and maximize variety against recentMealNames and savedRecipes. Then eatingPlan: exactly how to run the days " +
    "(what pairs with what, daily shape vs targets). Then ONE combined grocery list for everything, by store section. " +
    "Every recipe must make him hungry — this is the deliciousness engine at full power.";

  const BRIEF_SYSTEM = CORE + "\n\n" +
    "TASK: the athlete just opened the app for the first time today. Write his MORNING BRIEF: one tight paragraph " +
    "(3-5 sentences, no lists) that fuses everything into marching orders. Priority order: (1) pins due or missed today " +
    "(context.cycle), (2) what to train today and why (ledger gaps, freshness, days since last session — or call the rest " +
    "day), (3) nutrition pace (protein/calories vs target, yesterday's intake if notable), (4) one sharp observation from " +
    "the data (trend, PR proximity, steady-state milestone, weigh-in streak). Address him directly, be specific with " +
    "numbers, zero filler. If it's afternoon/evening, adapt the framing to the time left in the day.";

  const CRITIQUE_SYSTEM =
    "You are a second, adversarial hypertrophy coach reviewing a colleague's weekly plan for a recomp athlete. You get " +
    "the same full data plus their draft review. ATTACK it: contradictions with the data, volume targets that ignore " +
    "recovery or the ledger, wrong recomp verdict, missed deload signals, cardio calls that hurt lifting, anything " +
    "generic. Then output the FINAL corrected review in the same structured format — keep what's right, fix what's wrong. " +
    "If the draft is sound, refine wording and ship it.";

  const CHAT_SYSTEM = CORE + "\n\n" + FOOD_CORE + "\n\n" +
    "TASK: free conversation with your athlete. Answer anything — swap requests, stall diagnosis, food and diet " +
    "questions, cravings, soreness, technique. Reference their real numbers. Keep replies tight and useful (2-6 " +
    "sentences unless they ask for depth). You are their coach, not a search engine.";

  const DEBRIEF_SYSTEM = CORE + "\n\n" +
    "TASK: the athlete just finished and logged a session (provided). Give a sharp 2-3 sentence debrief: what the numbers " +
    "mean vs prediction/history, any PR, and the ONE thing that changes next time. Plus one factual modelNote worth " +
    "remembering long-term (or empty string).";

  const AUDIT_SYSTEM = CORE + "\n\n" +
    "TASK: physique photo audit. Compare the photos (older first, newest last) as a recomp verifier — the scale can't " +
    "see recomposition, photos can. Be direct about visible change (or lack of it) region by region; note lighting/pump " +
    "caveats once, briefly. One modelNote if something is worth remembering.";

  /* ================= transport ================= */
  function headers(key) {
    return { "content-type": "application/json", "x-api-key": key, "anthropic-version": VERSION, "anthropic-dangerous-direct-browser-access": "true" };
  }
  async function call(body, key) {
    const res = await fetch(API_URL, { method: "POST", headers: headers(key), body: JSON.stringify(body) });
    if (!res.ok) {
      let detail = ""; try { detail = (await res.json()).error?.message || ""; } catch {}
      const err = new Error(detail || `Request failed (${res.status})`); err.status = res.status; throw err;
    }
    const data = await res.json();
    if (data.stop_reason === "refusal") throw new Error("The coach declined this request.");
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!text) throw new Error("Empty response from the coach.");
    try { return JSON.parse(text); } catch {
      // salvage: some responses wrap or trail the JSON
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch {} }
      if (data.stop_reason === "max_tokens") throw new Error("The response got cut off — tap again and it'll retry.");
      throw new Error("Could not read the coach's response — try again.");
    }
  }
  function parseDataUrl(u) { const m = /^data:([^;]+);base64,(.+)$/.exec(u || ""); return m ? { mediaType: m[1], data: m[2] } : null; }
  const jsonBlock = (o) => "```json\n" + JSON.stringify(o, null, 1) + "\n```";
  function ctx() { return Obs.distill(Store.get()); }
  function auth() {
    const s = Store.get().settings;
    const key = (s.apiKey || "").trim();
    if (!key) { const e = new Error("NO_KEY"); throw e; }
    return { key, model: s.model || "claude-opus-4-8" };
  }

  /* ================= calls ================= */

  // One coach call covers: fresh Rx, photo-ID, feeler, mid-exercise re-dial, swap, session rescale, timebox.
  async function coach(opts) {
    const { key, model } = auth();
    const payload = Object.assign({ context: ctx() }, {
      exercise: opts.exerciseName || null,
      feelerSet: opts.feeler || null,
      completedSets: opts.completedSets || null,
      remainingCount: opts.remainingCount || null,
      readinessAdjust: opts.readinessAdjust || null,
      swapFor: opts.swapFor || null,
      adjustNote: opts.adjustNote || null,
      currentPrescription: opts.currentPrescription || null,
      timeboxMinutes: opts.timeboxMinutes || null,
    });
    const content = [];
    const img = opts.imageDataUrl && parseDataUrl(opts.imageDataUrl);
    if (img) content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
    content.push({ type: "text", text: (img ? "Identify the exercise/machine in the photo, then prescribe today's sets.\n" : "Prescribe today's sets.\n") + jsonBlock(payload) });
    return call({ model, max_tokens: 4000, system: COACH_SYSTEM, messages: [{ role: "user", content }], output_config: { format: { type: "json_schema", schema: COACH_SCHEMA } } }, key);
  }

  async function plan(opts) {
    const { key, model } = auth();
    const payload = { context: ctx(), focus: opts.focus, timeboxMinutes: opts.timeboxMinutes || null };
    return call({ model, max_tokens: 10000, system: PLAN_SYSTEM, messages: [{ role: "user", content: "Build the session.\n" + jsonBlock(payload) }], output_config: { format: { type: "json_schema", schema: PLAN_SCHEMA } } }, key);
  }

  async function dailyFocus() {
    const { key, model } = auth();
    return call({ model, max_tokens: 3000, system: FOCUS_SYSTEM, messages: [{ role: "user", content: "What do I train today?\n" + jsonBlock({ context: ctx() }) }], output_config: { format: { type: "json_schema", schema: FOCUS_SCHEMA } } }, key);
  }

  // Weekly deep review: draft with extended thinking, then adversarial critique -> final.
  async function weeklyReview(onStage) {
    const { key, model } = auth();
    const context = ctx();
    if (onStage) onStage("Analyzing your week — deep think…");
    const draft = await call({
      model, max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: REVIEW_SYSTEM,
      messages: [{ role: "user", content: "Run my weekly review.\n" + jsonBlock({ context }) }],
      output_config: { format: { type: "json_schema", schema: REVIEW_SCHEMA } },
    }, key);
    if (onStage) onStage("Adversarial pass — attacking the plan…");
    try {
      return await call({
        model, max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: CRITIQUE_SYSTEM,
        messages: [{ role: "user", content: "Data:\n" + jsonBlock({ context }) + "\n\nColleague's draft review:\n" + jsonBlock(draft) + "\n\nOutput the final review." }],
        output_config: { format: { type: "json_schema", schema: REVIEW_SCHEMA } },
      }, key);
    } catch { return draft; } // critique is a bonus pass — never lose the draft
  }

  async function chat(userText) {
    const { key, model } = auth();
    const history = Store.get().chat.slice(-12).map((m) => ({ role: m.role, content: m.text }));
    const messages = [{ role: "user", content: "My current data:\n" + jsonBlock({ context: ctx() }) }, { role: "assistant", content: "Got it — I have your full current picture. What's up?" }]
      .concat(history)
      .concat([{ role: "user", content: userText }]);
    const body = { model, max_tokens: 2500, system: CHAT_SYSTEM, messages };
    const res = await fetch(API_URL, { method: "POST", headers: headers(key), body: JSON.stringify(body) });
    if (!res.ok) { let d = ""; try { d = (await res.json()).error?.message || ""; } catch {} const e = new Error(d || `Request failed (${res.status})`); e.status = res.status; throw e; }
    const data = await res.json();
    if (data.stop_reason === "refusal") throw new Error("The coach declined that.");
    const t = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!t) throw new Error("Empty reply.");
    return t;
  }

  async function debrief(sessionSummary) {
    const { key, model } = auth();
    return call({ model, max_tokens: 1500, system: DEBRIEF_SYSTEM, messages: [{ role: "user", content: "Session just logged:\n" + jsonBlock(sessionSummary) + "\nContext:\n" + jsonBlock({ context: ctx() }) }], output_config: { format: { type: "json_schema", schema: DEBRIEF_SCHEMA } } }, key);
  }

  // Photo and/or text meal -> macro estimate. Pass {correction, prior} to re-estimate.
  async function analyzeMeal(opts) {
    const { key, model } = auth();
    const content = [];
    const img = opts.imageDataUrl && parseDataUrl(opts.imageDataUrl);
    if (img) content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
    const payload = { description: opts.text || null, userCorrection: opts.correction || null, priorEstimate: opts.prior || null, context: { foodNotes: Store.get().profile.foodNotes || null } };
    content.push({ type: "text", text: (img ? "Estimate the nutrition of the meal in this photo.\n" : "Estimate the nutrition of this meal.\n") + jsonBlock(payload) });
    return call({ model, max_tokens: 2500, system: MEAL_SYSTEM, messages: [{ role: "user", content }], output_config: { format: { type: "json_schema", schema: MEAL_SCHEMA } } }, key);
  }

  async function nutritionTargets() {
    const { key, model } = auth();
    return call({ model, max_tokens: 1000, system: TARGETS_SYSTEM, messages: [{ role: "user", content: "Set my daily targets.\n" + jsonBlock({ context: ctx() }) }], output_config: { format: { type: "json_schema", schema: TARGETS_SCHEMA } } }, key);
  }

  // ask: craving / situation / "surprise me"
  async function suggestMeals(ask) {
    const { key, model } = auth();
    return call({ model, max_tokens: 10000, system: SUGGEST_SYSTEM, messages: [{ role: "user", content: `What I want: ${ask}\n` + jsonBlock({ context: ctx() }) }], output_config: { format: { type: "json_schema", schema: SUGGEST_SCHEMA } } }, key);
  }

  async function groceryList(where) {
    const { key, model } = auth();
    return call({ model, max_tokens: 8000, system: GROCERY_SYSTEM, messages: [{ role: "user", content: `Store/situation: ${where}\n` + jsonBlock({ context: ctx() }) }], output_config: { format: { type: "json_schema", schema: GROCERY_SCHEMA } } }, key);
  }

  // ask: how many days / any preferences — plans meals + one combined grocery list, any day of the week
  async function mealPlan(ask) {
    const { key, model } = auth();
    return call({ model, max_tokens: 14000, system: MEALPLAN_SYSTEM, messages: [{ role: "user", content: `Plan request: ${ask || "plan my next ~4 days"}\n` + jsonBlock({ context: ctx() }) }], output_config: { format: { type: "json_schema", schema: MEALPLAN_SCHEMA } } }, key);
  }

  async function morningBrief() {
    const { key, model } = auth();
    return call({ model, max_tokens: 1200, system: BRIEF_SYSTEM, messages: [{ role: "user", content: "Morning brief.\n" + jsonBlock({ context: ctx() }) }], output_config: { format: { type: "json_schema", schema: BRIEF_SCHEMA } } }, key);
  }

  async function photoAudit(photos) {
    const { key, model } = auth();
    const content = [];
    photos.forEach((p) => { const img = parseDataUrl(p.dataUrl); if (img) content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } }); });
    content.push({ type: "text", text: `Photos oldest→newest, dates: ${photos.map((p) => p.date).join(", ")}. Audit my physique trend.\n` + jsonBlock({ context: ctx() }) });
    return call({ model, max_tokens: 2000, system: AUDIT_SYSTEM, messages: [{ role: "user", content }], output_config: { format: { type: "json_schema", schema: AUDIT_SCHEMA } } }, key);
  }

  return { coach, plan, dailyFocus, weeklyReview, chat, debrief, photoAudit, analyzeMeal, nutritionTargets, suggestMeals, groceryList, mealPlan, morningBrief };
})();

if (typeof window !== "undefined") window.Brain = Brain;
