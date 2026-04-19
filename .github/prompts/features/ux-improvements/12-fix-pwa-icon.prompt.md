---
description: "Fix PWA app icon to remove black padding — use rounded gradient background like native apps"
---

# Fix PWA Icon — Remove Black Padding

## Problem

The TeslaSync PWA icon on desktop/mobile taskbars shows a small logo surrounded by
a large black padded square. This looks out of place next to other app icons that
fill their space with a vibrant colored background.

**Current:** Small lightning bolt icon on black square with visible padding
**Desired:** Full-sized icon with rounded colored background (like the music app example)

## Current State

```
web/public/icons/
  icon-192.png              — purpose: 'any'  (taskbar/dock icon) — has black padding ❌
  icon-512.png              — purpose: 'any'  (taskbar/dock icon) — has black padding ❌
  icon-maskable-192.png     — purpose: 'maskable' (Android adaptive) — separate asset
  icon-maskable-512.png     — purpose: 'maskable' (Android adaptive) — separate asset
  logo.svg                  — source logo
  logo-original.png         — original logo asset

web/vite.config.ts:23-47   — manifest icon entries
```

### Why It Looks Padded
The `purpose: 'any'` icons were likely exported with the full safe zone padding
intended for maskable icons (which need ~40% padding for the adaptive icon system).
Desktop/dock icons should fill the entire square with the design — the OS handles
rounding and masking.

## Task

### Step 1: Generate New Icon Assets

Create new icon PNGs that look like a native app icon:

**Design spec for `icon-192.png` and `icon-512.png` (purpose: any):**
- Full 192×192 / 512×512 canvas
- Rounded rectangle background (not the OS — bake the radius into the image)
  - Corner radius: ~22% of size (≈42px for 192, ≈112px for 512)
  - Background: gradient from `#0d1117` (dark) to `#151b23` (slightly lighter)
    OR solid `#0a0f1a` with subtle gradient
  - Alternative: use the theme primary color `#00f0ff` (neon cyan) as the
    background for a more vibrant look — like the music app example
- Logo/lightning bolt centered at ~60-65% of the icon size
- Logo color: white or neon cyan (`#00f0ff`) depending on background choice
- Subtle glow/shadow behind the logo for depth (optional)
- **No extra padding** — the rounded rect fills the entire canvas

**Two design options (let implementer choose the better one):**

Option A — Dark background (matches app theme):
```
┌──────────────┐
│ ╭──────────╮ │
│ │   dark    │ │
│ │    ⚡     │ │  ← neon cyan bolt on dark bg
│ │  (cyan)   │ │
│ ╰──────────╯ │
└──────────────┘
```

Option B — Vibrant background (stands out on taskbar):
```
┌──────────────┐
│ ╭──────────╮ │
│ │   cyan    │ │
│ │    ⚡     │ │  ← dark/white bolt on cyan bg
│ │  gradient │ │
│ ╰──────────╯ │
└──────────────┘
```

**Design spec for `icon-maskable-192.png` and `icon-maskable-512.png` (purpose: maskable):**
- Full canvas with safe zone padding (icon content within center 80%)
- Solid background filling entire canvas (no transparency)
- Background color: `#0a0a0f` (app background) or `#00f0ff` (theme primary)
- Logo centered within the safe zone (center 80% of canvas)

### Step 2: Generate Icons Programmatically

If manual design isn't available, use a script to generate icons from the existing
SVG logo. Create `scripts/generate-icons.mjs`:

```javascript
// Use sharp (already common in Node projects) or canvas
// npm install sharp (dev dependency)

import sharp from 'sharp';
import { readFileSync } from 'fs';

const SIZES = [192, 512];
const BG_COLOR = { r: 10, g: 15, b: 26, alpha: 1 };  // dark blue-black
const RADIUS_RATIO = 0.22;  // 22% corner radius

for (const size of SIZES) {
  const radius = Math.round(size * RADIUS_RATIO);
  const logoSize = Math.round(size * 0.6);
  const padding = Math.round((size - logoSize) / 2);

  // Create rounded rect background
  const roundedRect = Buffer.from(
    `<svg width="${size}" height="${size}">
      <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}"
        fill="url(#bg)"/>
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0d1117"/>
          <stop offset="100%" stop-color="#151b23"/>
        </linearGradient>
      </defs>
    </svg>`
  );

  // Composite logo on top
  await sharp(roundedRect)
    .composite([{
      input: 'web/public/icons/logo.svg',
      top: padding,
      left: padding,
      width: logoSize,
      height: logoSize,
    }])
    .png()
    .toFile(`web/public/icons/icon-${size}.png`);

  // Maskable version (full bleed, more padding)
  const maskPadding = Math.round(size * 0.2);
  const maskLogoSize = size - (maskPadding * 2);

  await sharp({
    create: { width: size, height: size, channels: 4, background: BG_COLOR }
  })
    .composite([{
      input: 'web/public/icons/logo.svg',
      top: maskPadding,
      left: maskPadding,
      width: maskLogoSize,
      height: maskLogoSize,
    }])
    .png()
    .toFile(`web/public/icons/icon-maskable-${size}.png`);
}
```

Run: `node scripts/generate-icons.mjs`

### Step 3: Add Apple Touch Icon

iOS doesn't use the PWA manifest icons for the home screen — it uses `apple-touch-icon`.
Add to `web/index.html`:

```html
<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">
```

Generate `apple-touch-icon.png` at 180×180 with the same design as `icon-192.png`.

iOS automatically applies corner rounding, so the apple-touch-icon should have
a **square** image with the colored background filling the entire canvas (no baked
radius). iOS will mask it.

### Step 4: Update Manifest if Needed

The current manifest entries in `vite.config.ts` are correctly structured with
separate `any` and `maskable` purpose icons. No changes needed unless file names change.

If adding the apple-touch-icon, also add it to `includeAssets`:
```typescript
includeAssets: ['favicon.svg', 'icons/*.svg', 'icons/*.png'],
```

### Step 5: Update Favicon

The `favicon.svg` should also be updated to match the new icon design. SVG favicons
support transparency, so it can just be the logo on transparent background — the
browser tab provides its own background.

## Verification

- [ ] `icon-192.png` and `icon-512.png` fill the full canvas with rounded colored background
- [ ] No excess black padding visible around the icon
- [ ] Icon looks good on Windows taskbar (pinned site)
- [ ] Icon looks good on macOS Dock (PWA)
- [ ] Icon looks good on Android home screen (maskable version used)
- [ ] Icon looks good on iOS home screen (apple-touch-icon used)
- [ ] Favicon in browser tab is clear and recognizable at 16×16

### Test PWA Icon
```bash
cd web && npm run build
# Check generated manifest.webmanifest in dist/
# Verify icon paths resolve and images look correct
```

## Commit

```bash
git add -A
git commit -m "fix(web): replace padded PWA icons with full-bleed rounded design

- Regenerate icon-192/512.png with gradient background and centered logo
- Regenerate maskable icons with proper safe zone padding
- Add apple-touch-icon for iOS home screen
- Update favicon.svg to match new design"
```
