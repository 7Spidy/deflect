# Dflect Everywhere

A daily one-thumb parry-timing game. One foe, ten rounds, three strikes each, one tap
per strike, scored by millisecond offset from impact. A run lasts at least two
minutes. Same encounter for everyone on a given local date, and no two dates fight
alike: each day has an omen, a favoured move, and a guardian that turns halfway.

The player-facing name lives in `GAME_NAME` (`src/game/config.ts`). Seeds, storage keys
and the repo keep the old `deflect` id on purpose, so renaming never resets streaks or
changes anyone's encounter.

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
| Moves, omens, signature odds, move motifs          | `src/game/moves.ts`      |
| Stagger gains, round recovery, Deathblow rhythm and window | `src/game/stagger.ts` |
| Each boss's movesets, phase-two line and eye, between-round beat | `src/game/bosses.ts` |
| Between-round beats, arena marks, omen sky, phase-two turn | `src/game/arena.ts` |

## Stagger and the Deathblow

Good deflects fill the guardian's stagger meter (True +12, Clean +8, Glancing +4,
Grazed 0, a miss -12) and it drains by 8 after every round. All Clean breaks it in
round six, all True in round four, Glancing alone never does. When it breaks the
guardian slumps, three heartbeats count down (500 ms apart) while a ring closes on the
guard line, and one tap on the third beat (within 90 ms) lands the Deathblow. One slip is
forgiven: a miss on the first mark gets one retry a beat later, a second miss fails it.
One per run. It never
changes the score; it is the climax, a lifetime count in Records, and the last mark on
the share row (⚔️ landed, 💨 missed). The meter is a pure function of the results, so a
resumed run rebuilds it exactly, and a run is not finished while a Deathblow is owed.

## Share

One emoji per round (that round's average, strike cut-offs), so a run is one row of
ten, then the Deathblow mark and the day's omen in the header:

```
Dflect Everywhere #12 · A (88) · Blood Moon
🟡🟢🟢🟠🟢🟡🟢🟢🟡🟢 ⚔️
Avg 41ms off, leaning early
```

## Why every day feels different

- **Moves.** Each round is one named attack string (Measured Cuts, The Quickening,
  The Lull, Heavy Hand...). A move is a rhythm shape over the boss's own hold and swing
  ranges, plus jitter: learnable (a Lull is always quick, quick, long), never exact.
  A move with a tell always puts its feint or stall in the same slot. The banner between
  rounds names the next move, and a short motif plays it: one mallet note per strike in
  the guardian's own key, gaps following the move's hold shape, pitch its swing speed.
  The motif is built from the move's public shape, never a strike's real timing.
- **Signature.** Each day the guardian favours one move: forced once per phase, then
  `SIGNATURE_CHANCE` per round. Shown on the title screen.
- **Omen.** One per date, shared by every guardian: Clear Night, Blood Moon (faster
  swings), Long Night (longer waits), Thin Veil (more lies), Steady Hand (clean rhythm),
  Ashfall (frayed rhythm). Tints the arena and is added to the share text.
- **Phase two.** From `PHASE_TWO_ROUND` (round 6 of 10) the guardian uses a harder
  moveset, swings `PHASE_TWO_SWING` faster and lies `PHASE_TWO_DECEIT` more. The break
  before it is `PHASE_SHIFT_MS` longer for the turn: the arena dims, the eyes change
  colour, the guardian's line appears.
- **Between-round beats.** After every round the guardian plays a short beat and leaves
  a mark that stays for the rest of the fight: the Toll Keeper drops a coin on a growing
  pile, briar creeps in for the Knight, a star appears and dusk deepens for Vesper, a
  votive is lit for the Twins, Oswin's bell tolls and one more soul drifts in, a pale root
  climbs for Mother Marrow, and a candle in the Unlit King's crown catches and dies as
  the dark closes in. Beats run inside the round break and never read strike timing
  (unit tested, like the living portraits).

Run shape and pacing (all in `src/game/config.ts`; everything keys off the first two):

| Constant                | Default | Meaning                                                         |
| ----------------------- | ------- | --------------------------------------------------------------- |
| `ROUNDS_PER_RUN`        | 10      | Rounds per run                                                  |
| `STRIKES_PER_ROUND`     | 3       | Strikes per round (2 gives about 88 s, 1 about 52 s)            |
| `INTRO_MS` / `OUTRO_MS` | 3000 / 2000 | Guardian reveal; pause after the last strike                |
| `GAP_MS`                | 1500    | Minimum recovery after impact                                   |
| `MIN_CYCLE_MS`          | 3600    | Strike start to next strike start, floor. Guarantees run length |
| `ROUND_BREAK_MS`        | 1200    | Extra beat after the last strike of a round                     |
| `PHASE_SHIFT_MS`        | 1800    | Extra beat before phase two                                     |
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
- `?debug=1&date=YYYY-MM-DD` plays another day (handy for seeing each guardian, omen and
  move mix). Override runs are saved under their
  own date but never touch stats or streaks.
- `?debug=1&art=off` forces the procedural silhouettes. `?debug=1&eyes=1` draws
  crosshairs at the guardian eye anchors.

## Layout

- `src/game/` pure logic (`prng`, `daily`, `moves`, `generator`, `pacing`, `scoring`, `stats`,
  `share`, `shareClient`, `copy`, the pose math in `living`) plus the browser-facing
  pieces (`engine`, `scene`, `arena`, `living` portrait, `audio`, `storage`, `shareImage`).
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
