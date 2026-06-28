# Overload — Adaptive Progressive-Overload Trainer

A strength app with a **deterministic, auditable engine** at its core. You
calibrate once (test one lift per movement pattern to failure), and from then on
it prescribes the exact weight and rep target for *any* exercise — and gets
harder or backs off every session based on the reps and reps-in-reserve you
actually log.

No accounts, no backend, no build step. A static page that stores everything in
your browser's `localStorage`. Everything is in **pounds (lb)**.

## How it's built (and why)

The math lives in a pure, dependency-free engine. **There is no AI anywhere in
the prescription path** — every weight and rep target is plain, testable
arithmetic locked to a spec.

| File | Role |
| --- | --- |
| `engine.js` | The locked model — Epley 1RM with RIR folding, %-by-reps table, goal modes, exercise-coefficient table, EMA strength blend, double progression, deload triggers, plate rounding. Pure functions, zero dependencies. |
| `engine.test.js` | 21 spec test vectors as assertions. Run `node engine.test.js`. |
| `data.js` | Persistence behind a repository interface (localStorage now, swap in SQLite later). Implements the resolution rule and the trusted-only update guarantee. |
| `recognize.js` | The **only** AI: identifies an exercise/machine from a name or photo and returns *metadata only* (pattern, load type, coefficient). It never picks a weight or rep. |
| `app.js` | UI + the session loop (calibrate → prescribe → log → recalibrate → progress). |
| `index.html`, `styles.css` | Interface. |

### The model, briefly

- **1RM** = `weight × (1 + (reps + RIR) / 30)` (Epley). An estimate only counts
  ("trusted") when `reps + RIR ≤ 12` — high-rep sets never move your strength
  number.
- **Prescription** = your estimated 1RM × the %-for-bottom-of-range, rounded to
  loadable plates. Always at the bottom of the range, so there's room to add reps
  before adding weight (double progression).
- **Autoregulation** — hit the top of the range on every set at RIR ≥ 1 → add
  load next time; land inside the range → hold and chase reps; come up short or
  grind to RIR 0 → repeat the weight. Your strength estimate is blended with an
  EMA (α = 0.3) from each trusted session.
- **Deload** — if a pattern stalls (no load added for 3 sessions), regresses
  (≤ 90% of recent peak), or runs 8 weeks without one, the next session drops to
  88% at mid-range reps and RIR 3, then resumes.

### Photograph any machine

Hit an obscure machine you can't name? Snap a photo (or just type a hint) and the
AI classifies it into the engine's terms — movement pattern, load type, and a
strength coefficient relative to the big reference lift. The engine takes it from
there. The AI only *labels* the exercise; the loads stay deterministic.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Setup

1. **⋯ → AI settings** → paste an
   [Anthropic API key](https://console.anthropic.com/settings/keys) (only needed
   for photo/name identification; stored only in this browser).
2. **Calibrate** → fill your profile, then test the six reference lifts (a top set
   of 5–8 reps to a stated RIR each).
3. **Train** → pick or photograph an exercise → do the prescribed sets → log your
   reps + reps-in-reserve → save. The next plan adapts automatically.
4. **Progress** → estimated-1RM and volume curves, with deload markers.

No key handy? **⋯ → Load sample data** fills it in so you can explore (the
photo-identify feature still needs a key).

## Verifying the engine

```bash
node engine.test.js     # 21/21 spec vectors
```
