# Overload — AI Progressive Overload Coach

A strength-training app that figures out **how strong you are right now** from a
single all-out set, then uses AI to prescribe the exact sets and weights for
*any* exercise that trains the same muscles — and progressively overloads you
session to session.

No accounts, no backend, no build step. One static page that stores everything
in your browser's `localStorage`. The only network call is to the Anthropic API,
made directly from your browser with your own key.

## The idea

1. **Assess.** Pick a muscle group (Shoulders, Chest, Back, Legs, Arms, Core) and
   do its benchmark lift — e.g. shoulder press — to failure. Enter the weight and
   how many reps you managed. Overload estimates your current 1-rep max for that
   muscle group.
2. **Train.** Tell it any exercise for that muscle group ("Arnold press",
   "lateral raise", "cable fly"…). Claude reads your strength baseline plus your
   last session for that movement and prescribes warm-up sets, working sets,
   weights, rep targets, and the progressive-overload reasoning.
3. **Log & progress.** Record what you actually did. Each new plan progresses
   from the last one. A graph tracks estimated 1RM / volume / top set over time.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Setup

Open **⋯ → AI settings** and paste an
[Anthropic API key](https://console.anthropic.com/settings/keys). Pick your units
(kg/lb) and a model (Opus 4.8 by default).

- The key is stored **only in this browser** (`localStorage`) and sent **directly
  to Anthropic** — never to any other server. It is excluded from exported
  backups.
- Calls use Anthropic's browser-access header and structured outputs, so the
  coaching plan comes back as reliable JSON the app renders into sets and reps.

## How the AI plan works

Each request sends Claude (`claude-opus-4-8` by default) a compact JSON payload:

- the muscle group and your **to-failure baseline** (weight × reps → estimated 1RM),
- the **target exercise**, and
- your **most recent session** for that exercise, if any.

The system prompt instructs an experienced S&C coach to apply *double
progression*: hit your targets and it nudges weight or reps up by the smallest
sensible increment; fall short and it holds or backs off. It accounts for the
target exercise being lighter than the big benchmark lift and rounds to realistic
gym increments. The response is constrained to a JSON schema
(`summary`, `warmupSets`, `workingSets`, `progressionNote`, `coachingTips`).

Estimated 1RM uses the Epley formula, `weight × (1 + reps/30)`, with reps capped
at 12 so high-rep sets don't distort the estimate.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup, views, settings modal |
| `styles.css` | Dark theme styling |
| `app.js` | State, persistence, Claude API client, coaching engine, charts |

## Tip

No key handy? Open **⋯ → Load sample data** to explore the app with a few weeks
of example assessments and sessions already filled in.
