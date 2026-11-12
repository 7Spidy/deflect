# Deflect

A daily one-thumb parry-timing game. One foe, ten rounds, three strikes each, one tap
per strike, scored by millisecond offset from impact. A run lasts at least two
minutes. Same encounter for everyone on a given local date.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm test
npm run build
npm run art        # art-src/*.png -> public/guardians/*.webp (see public/guardians/README.md)
```

Set `NEXT_PUBLIC_SITE_URL` in production so Open Graph URLs resolve (on Vercel it
falls back to the project's production URL).

## Tuning

| What                                              | Where                    |
| ------------------------------------------------- | ------------------------ |
| Boss hold/swing ranges, per-round feint and stall chance | `src/game/bosses.ts` |
| Boss art placement, eye anchors, motion, accents  | `src/game/bosses.ts` (`art`) |
| Launch date, score windows, blade angles          | `src/game/config.ts`     |
| Grade thresholds, banner wording, emoji cut-offs  | `src/game/scoring.ts`    |

Run shape and pacing (all in `src/game/config.ts`; everything keys off the first two):

| Constant                | Default | Meaning                                                         |
| ----------------------- | ------- | --------------------------------------------------------------- |
| `ROUNDS_PER_RUN`        | 10      | Rounds per run                                                  |
| `STRIKES_PER_ROUND`     | 3       | Strikes per round (2 gives about 88 s, 1 about 52 s)            |
| `INTRO_MS` / `OUTRO_MS` | 3000 / 2000 | Guardian reveal; pause after the last strike                |
| `GAP_MS`                | 1500    | Minimum recovery after impact                                   |
| `MIN_CYCLE_MS`          | 3600    | Strike start to next strike start, floor. Guarantees run length |
| `ROUND_BREAK_MS`        | 1200    | Extra beat after the last strike of a round                     |
| `TARGET_RUN_MS`         | 120000  | A unit test fails if any boss can run shorter                   |
| `WARMUP_ROUNDS`         | 1       | No feints or stalls in the first round                          |
| `MAX_DECEPTIVE_PER_ROUND` | 1     | A feint or a stall, never both in one strike                    |
| `STALL_DURATION_MS`     | 260-420 | How long the blade hangs mid-swing                              |
| `STALL_AT_FRACTION`     | 0.45-0.7 | Where in the swing travel it hangs                             |

**Feint** (a twitch during the hold) and **stall** (the blade hangs mid-swing, then
snaps through, as in Souls games) are planned per round, so deception is spread
across the whole run. The answer is still fixed when each strike begins.

## Debug

- `?debug=1` shows phase, hold, swing, feint, stall, impact time and raw offset during an
  encounter, plus a date picker and "reset this day" on the title screen.
- `?debug=1&date=YYYY-MM-DD` plays another day. Override runs are saved under their
  own date but never touch stats or streaks.
- `?debug=1&art=off` forces the procedural silhouettes. `?debug=1&eyes=1` draws
  crosshairs at the guardian eye anchors.

## Layout

- `src/game/` pure logic (`prng`, `daily`, `generator`, `pacing`, `scoring`, `stats`,
  `share`, `shareClient`, `copy`, the pose math in `living`) plus the browser-facing
  pieces (`engine`, `scene`, `living` portrait, `audio`, `storage`, `shareImage`).
- `src/components/` React screens. The encounter is a single Canvas 2D element.
- `src/game/__tests__/` Vitest unit tests for the pure logic.
- `public/guardians/` optimized guardian art. Sources live in the gitignored `art-src/`.

## Living portraits

Each guardian image is subtly alive: it breathes, sways, ripples at the hem, blinks and
flinches when a blow lands. It is procedural (canvas slices), not video, so the eye glow
stays attached to the sockets and reacts to the fight. **The idle animation never reads
strike timing** (the pose functions take no strike state), so the boss's body language
cannot be used to time a strike. Reduced-motion users get static art. See
`src/game/living.ts`.
