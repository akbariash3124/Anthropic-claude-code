# Coach — AI Recomp Trainer

A personal AI strength coach built for one job: **recomposition** — build
muscle, drop fat — with novice-friendly zone-2 cardio programmed in. Every
weight, rep, volume target, deload, diet call and cardio dose is decided by
Claude; the app's job is to make sure the AI decides from **your full measured
state, never a blank slate**.

Static page, no backend. All data on-device (localStorage). Pounds throughout.

## The brain (why this isn't a thin AI wrapper)

| Layer | File | What it does |
| --- | --- | --- |
| **Athlete Model** | `store.js` | The coach's own living notebook about you — responder patterns, RIR calibration, niggle history, what worked. AI-written, consolidated weekly, fed to *every* call. |
| **Observatory** | `observatory.js` | Pure measurement: weekly volume ledger (fractional hard sets per muscle, auto-tagged by the AI), e1RM trends + slopes, bodyweight EMA trend, prediction-engine metrics, muscle freshness decay, exercise ROI, cardio load, adherence — distilled into the compact context bundle behind every prompt. |
| **Brain** | `brain.js` | All AI calls: per-exercise coaching (photo-ID, feeler, partial re-dial, swap, timebox, rescale), session planner, daily focus (which body parts are due + the cardio call), the **weekly deep review** (extended thinking + an adversarial critique pass), free-form coach chat, post-workout debrief, physique photo audit. |
| **Prediction engine** | prescriptions *are* predictions | Every prescribed set is compared to what you logged: accuracy-within-±1-rep, your personal RIR reporting bias, your fatigue curve (reps lost per set). Shown in Trends ("how well the coach knows you") and fed back into every prescription. |

### The loops
- **Per set:** mark a set done → rest timer starts (AI-chosen duration). Badly
  miss the prediction on set 1 → the app offers to **rescale the whole
  remaining session** to today's actual condition.
- **Per exercise:** 🎯 re-dial re-prescribes **only the sets you haven't done**;
  🔁 swap replaces an unavailable machine with the same-stimulus substitute,
  fully prescribed.
- **Per day:** Today's Focus reads the ledger + freshness + block week and says
  what's due — lifting *and* zone-2 cardio minutes (novice-progressed, never
  before legs).
- **Per week:** the Weekly Deep Review adjudicates recomp (weight trend vs
  strength trend), sets next week's per-muscle volume targets, makes the
  block/deload call, runs n=1 volume experiments, rotates out flat exercises,
  flags stalls with diagnostic questions, doses cardio, and rewrites the
  Athlete Model. A second adversarial pass attacks the plan before it ships.
- **Per month:** physique photo audit — the scale can't see recomp; photos can.
- **Forever:** hierarchical memory (weekly → block → career rollups) so month
  14 is smarter than month 2.

### Also in there
Active-workout persistence (survives closing the app; sticky bar + finish →
AI debrief), plate math, PR detection, niggle registry the coach programs
around, multi-muscle session planning with a time budget, mid-workout
add-by-photo, protein target + free-form goals fed to every call.

## Run it

Open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000   # http://localhost:8000
```

Onboard (60s), then paste your Anthropic API key once under **Me → Coach**
(stored on-device; GitHub push protection forbids committing a real key —
`config.js` exists for private self-hosting only).

## Verify

`node engine.test.js` is gone — there is no math engine. The test surface is
the mocked end-to-end browser suite used during development (Playwright), plus
`observatory.js` unit checks; the AI's judgment is steered by the system
prompts in `brain.js`.
