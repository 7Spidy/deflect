# Guardian art

One image per weekday boss. The procedural silhouette in `src/game/scene.ts` is
the fallback: any missing or broken file just means that boss is drawn as a
silhouette, so assets can land one at a time and CI builds without them.

## Contract

- Files: `public/guardians/<boss.id>.webp`
  `toll-keeper`, `thornbound-knight`, `warden-vesper`, `penitent-twins`,
  `gravecaller-oswin`, `mother-marrow`, `unlit-king`.
- 1080 x 1920 (9:16). webp, target <= 220 KB each (the optimizer fails over 350 KB).
- Subject on **pure black `#000000`**. The engine composites with `screen`, so
  black is transparent. (The image generator cannot output alpha, which is why.)
- No weapon in the image: the blade is drawn by the game.
- Eyes as **dark sockets**: the engine adds the glow, so a pre-glowing eye would
  double up.
- Lower body dissolving into black.

## Pipeline

The source PNGs (6 to 7 MB each) never ship and are not in git. Keep them in
`art-src/` (gitignored) and back them up outside the repo.

```bash
npm run art                      # art-src/*.png -> public/guardians/*.webp
npm run art -- --black-point 14  # crush more haze to true black (default 10)
npm run art -- --quality 92      # if the mist bands
```

The script resizes to 1080 x 1920 (`cover`), crushes the black point so
near-black haze becomes true black, writes webp, and prints per file: size and
the max luminance of the outer 8 px border before and after the crush. It fails
on any output over 350 KB and warns if the border is above 3 after the crush.
The art layer also feathers the image edges at runtime, so a faint residue at
the border does not show.

## Wiring

Per-boss placement and motion live in `src/game/bosses.ts` under `art`:

| Field      | Meaning                                                                    |
| ---------- | -------------------------------------------------------------------------- |
| `src`      | `/guardians/<id>.webp`                                                     |
| `scale`    | Multiplier on the base fit (image width = canvas width)                    |
| `offsetY`  | Vertical nudge, fraction of canvas height                                  |
| `eyes`     | Eye anchors in image fractions (0..1). Replaces the silhouette eye points  |
| `neckY`    | Neck line in image fractions; the head-tilt shear applies above it         |
| `motion`   | Overrides for the living-portrait defaults (`src/game/living.ts`)          |
| `accents`  | Soft glows pinned to image points (lantern, star halo, bell)               |

Debug: `?debug=1&art=off` forces the silhouette. `?debug=1&eyes=1` draws
crosshairs at the eye anchors for calibration.
