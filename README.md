# Coach — AI Strength Trainer

An AI coach that tells you exactly what to lift — **right now, from your first
set.** No calibration week, no "do three workouts so the app can learn you." You
tell it your body and goal once, and it prescribes real, dialed-in weights
immediately, then adapts every session from how your sets actually felt.

Every weight, rep, and progression decision comes from Claude. The app itself is
just the interface, local storage, and charts. Pounds throughout. Mobile-first.

## Why it's different

- **Accurate from set one.** From your profile (sex, bodyweight, height,
  experience, goal) the coach gives a competent starting weight — the way a real
  trainer sizes up a new client. No ramp-up period.
- **Dial in within a single session.** Weight feels off? Do one set, tap
  **🎯 re-dial**, and the coach instantly corrects the rest of today's weights.
  Minutes, not workouts.
- **It visibly adapts.** Log reps + how hard each set felt; next time the card
  shows *"↗ Adapted from last time"* and the coach pushes harder or backs off —
  decisively, in one step.
- **Photograph any machine.** Snap a photo of some obscure machine (or just
  describe it) and the coach identifies it and programs it.
- **Plan a whole session.** Pick Push / Pull / Legs / etc. and get a full,
  ordered workout.

## Run it

Open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000     # then http://localhost:8000
```

## Setup (once)

1. On first launch, a 90-second onboarding collects your profile and an
   [Anthropic API key](https://console.anthropic.com/settings/keys). The key is
   stored **only in your browser** and sent directly to Anthropic — it's required
   because this is a client-side AI app. You can add/change it later under **Me**.
2. **Today** → type or 📷 photograph an exercise → **Program my sets** → do the
   work, log reps + reps-in-reserve → **Log session**.
3. Come back tomorrow — it remembers and progresses you.

## Files

| File | Role |
| --- | --- |
| `ai.js` | The coach — all Claude calls (prescribe, plan) via structured outputs. |
| `app.js` | UI, local storage, charts, the session loop. |
| `index.html`, `styles.css` | Mobile-first interface. |

No local exercise database, no strength formulas — the intelligence is the model.
