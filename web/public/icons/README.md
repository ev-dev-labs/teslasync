# PWA Icon Assets

This directory holds the icons referenced from `web/vite.config.ts` (the PWA
manifest) and `web/index.html` (favicon, apple-touch-icon).

## Required files

| File | Size | Purpose | Referenced from |
| --- | --- | --- | --- |
| `icon-192.png` | 192×192 | Standard launcher icon | manifest `icons[]` (any), shortcuts |
| `icon-512.png` | 512×512 | Splash screen / large launcher | manifest `icons[]` (any) |
| `icon-maskable-192.png` | 192×192 | Adaptive (Android) launcher icon — must include ~10% safe-zone padding | manifest `icons[]` (maskable) |
| `icon-maskable-512.png` | 512×512 | Adaptive (Android) splash icon — same padding rule | manifest `icons[]` (maskable) |
| `apple-touch-icon.png` | 180×180 | iOS home-screen icon | `<link rel="apple-touch-icon">` in `web/index.html` |
| `icon-192.svg` / `icon-512.svg` | — | Vector source for regenerating PNGs | (regen only) |
| `logo.svg` / `logo-original.png` | — | Marketing/in-app logo asset | various components |

## Maskable icons

Android's adaptive icon system clips the icon to a circle, square, or rounded
shape. The maskable variants (`icon-maskable-*.png`) MUST keep the meaningful
artwork inside an inner safe zone — roughly the central 80% of the canvas (the
outer ~10% on each side may be cropped). See https://web.dev/maskable-icon/ for
the visual spec.

Both maskable files are referenced twice in the manifest:
1. Once with `purpose: 'any'` so they also serve as a fallback on browsers that
   don't request a separate maskable asset.
2. Once with `purpose: 'maskable'` so adaptive-icon-aware browsers (Chrome on
   Android, Edge on Windows) pick them up explicitly.

## Theme colors

The manifest uses:
- `theme_color: '#00f0ff'` — neon cyan, used by the browser chrome (URL bar)
- `background_color: '#0a0a0f'` — near-black, used during the splash screen

Keep new icons consistent with the dark UI palette in
`web/src/lib/tokens.ts`.

## Regenerating PNGs from SVG

If you change the SVG sources, regenerate the PNGs at the listed sizes (any
SVG-to-PNG tool works — ImageMagick, `sharp`, `svgexport`, Figma export). For
the maskable variants, ensure the artwork is centered with the 10% safe-zone
padding applied before export.

## Verification

After changing any icon:
1. `cd web && npm run build && npm run preview`
2. Open Chrome DevTools → Application → Manifest. Confirm:
   - "Installable" badge is present
   - Every icon row resolves (no 404 / red error)
   - Maskable icons preview correctly inside the circle/squircle frames
3. (Optional) Lighthouse → PWA category should score ≥ 90.
