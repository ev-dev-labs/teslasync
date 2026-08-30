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
| `badge-72.png` | 72×72 | Android Web Push status-bar badge — **must be a monochrome (white) silhouette on a transparent background**, alpha-only; Android re-tints it to the system accent. Using a coloured icon here makes Chrome render the icon on both sides of the notification (duplicate-icon bug). | `web/src/sw/sw.ts` `showNotification({ badge })` |
| `icon-192.svg` / `icon-512.svg` / `badge.svg` | — | Vector source for regenerating PNGs | (regen only) |
| `logo.svg` / `logo-original.png` | — | Marketing/in-app logo asset | various components |

## Maskable icons

Android's adaptive icon system clips the icon to a circle, square, or rounded
shape. The maskable variants (`icon-maskable-*.png`) MUST keep the meaningful
artwork inside an inner safe zone — roughly the central 80% of the canvas (the
outer ~10% on each side may be cropped). See https://web.dev/maskable-icon/ for
the visual spec.

The manifest references the full-bleed standard icons with `purpose: 'any'`
and the safe-zone variants with `purpose: 'maskable'`. This keeps the regular
launcher and desktop presentation visually full-size while allowing
adaptive-icon-aware browsers (Chrome on Android, Edge on Windows) to crop the
maskable artwork safely.

## Why no notification `icon`?

The service worker (`web/src/sw/sw.ts`) deliberately **omits** the `icon`
field when calling `showNotification()`. This is a fix landed in
**Phase-49 / Slice 0010** (`notification-icon-fix`).

Background: when both `icon` and `badge` are populated AND the device's
PWA manifest icon is also installed, Android Chrome renders the same
artwork twice on the notification card — once on the left (sourced from
the manifest icon, which Chrome cannot be told to suppress) and once on
the right (sourced from `icon`). This produced the visible duplicate
icon shown in support tickets prior to slice 0010.

The fix:

1. Drop `Icon` from `internal/webpush.Payload` (server side) so the
   field is no longer transmitted on the wire.
2. Drop `icon?: string` from `PushPayload` (`web/src/sw/sw.ts`) and
   never assign `options.icon` in the `showNotification(...)` call.
3. Keep `badge: '/icons/badge-72.png'` because the badge populates the
   Android status-bar slot — a separate, smaller surface that has no
   duplicate-rendering issue.

Regression tests pin the contract:

- `internal/webpush/service_test.go` — `TestPayload_NoIconField` and
  `TestPayload_JSONShape_OmitsIcon` reject any reintroduction of the
  struct field or its JSON tag.
- `web/src/sw/__tests__/sw.test.ts` — captures the
  `showNotification(...)` call and asserts `options.icon === undefined`
  even when the upstream payload contains a stray `icon` key.

If you need a per-notification visual differentiator in the future,
prefer `image` (large hero on Android, ignored on desktop) over `icon`,
and verify on a real Android device that the manifest icon is no
longer being doubled before merging.

## Theme colors

The manifest uses:
- `theme_color: '#0b0d12'` — low-chroma canvas used by browser chrome
- `background_color: '#0b0d12'` — startup canvas used during the splash screen

Keep new icons consistent with the framed brand mark in
`web/src/lib/appIcon.ts`.

## Regenerating PNGs from SVG

If you change the SVG sources, regenerate the PNGs at the listed sizes (any
SVG-to-PNG tool works — ImageMagick, `sharp`, `svgexport`, Figma export). For
the maskable variants, ensure the artwork is centered with the 10% safe-zone
padding applied before export.

`badge-72.png` is generated from `badge.svg` via `sharp`. To regenerate after
editing the SVG:

```bash
cd web
node -e "require('sharp')('public/icons/badge.svg').resize(72,72).png().toFile('public/icons/badge-72.png')"
```

## Verification

After changing any icon:
1. `cd web && npm run build && npm run preview`
2. Open Chrome DevTools → Application → Manifest. Confirm:
   - "Installable" badge is present
   - Every icon row resolves (no 404 / red error)
   - Maskable icons preview correctly inside the circle/squircle frames
3. (Optional) Lighthouse → PWA category should score ≥ 90.
