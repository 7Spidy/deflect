# Deflect

A daily one-thumb parry-timing game. One foe, five strikes, one tap each, scored by
millisecond offset from impact. Same encounter for everyone on a given local date.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm test
npm run build
```

Set `NEXT_PUBLIC_SITE_URL` in production so Open Graph URLs resolve (on Vercel it
falls back to the project's production URL).

## Tuning

| What                                   | Where                    |
| -------------------------------------- | ------------------------ |
| Boss hold/swing ranges, feint chance   | `src/game/bosses.ts`     |
| Launch date, phase timings, score windows, feint shape, blade angles | `src/game/config.ts` |
| Grade thresholds, banner wording, emoji cut-offs | `src/game/scoring.ts` |

## Debug

- `?debug=1` shows phase, hold, swing, feint, impact time and raw offset during an
  encounter, plus a date picker and "reset this day" on the title screen.
- `?debug=1&date=YYYY-MM-DD` plays another day. Override runs are saved under their
  own date but never touch stats or streaks.

## Layout

- `src/game/` pure logic (`prng`, `daily`, `generator`, `scoring`, `stats`, `share`)
  plus the browser-facing pieces (`engine`, `scene`, `audio`, `storage`, `shareImage`).
- `src/components/` React screens. The encounter is a single Canvas 2D element.
- `src/game/__tests__/` Vitest unit tests for the pure logic.
