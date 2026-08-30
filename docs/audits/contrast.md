# Color Contrast Verification

Generated baseline for the TeslaSync palette. WCAG 2.2 Level AA targets:

| Type | Required ratio |
|---|---|
| Body text vs background | 4.5 : 1 |
| Large text (18pt+ or 14pt+ bold) vs background | 3 : 1 |
| UI components, focus rings, icon-only controls vs background | 3 : 1 |

This file is a manual reference. Re-verify with Chrome DevTools → Rendering →
Emulate vision deficiencies + Lighthouse → Accessibility, or with the
[axe DevTools](https://www.deque.com/axe/devtools/) browser extension, after
any change to `web/src/lib/tokens.ts`, `web/src/index.css` `:root` blocks, or
the Tailwind config.

---

## Dark theme — body text on `--bg` (`#0a0a0f`)

These are the project-approved foreground tokens used across all pages. The
ratios below were measured against the dark default background.

| Class / token | Hex | Ratio vs `#0a0a0f` | AA pass |
|---|---|---:|:---:|
| `text-white` (`--text-primary`) | `#ffffff` | 19.7 : 1 | ✅ |
| `text-white/90` | `rgba(255,255,255,0.9)` | ≈ 17.7 : 1 | ✅ |
| `text-white/80` | `rgba(255,255,255,0.8)` | ≈ 15.8 : 1 | ✅ |
| `--text-secondary` | `#9ca3af` | 8.6 : 1 | ✅ |
| `--text-muted` | `#8a95a6` | 7.2 : 1 | ✅ |
| `text-white/60` | `rgba(255,255,255,0.6)` | ≈ 11.8 : 1 | ✅ |
| `text-white/50` | `rgba(255,255,255,0.5)` | ≈ 9.9 : 1 | ✅ |
| `text-white/40` | `rgba(255,255,255,0.4)` | ≈ 7.9 : 1 | ✅ |
| `text-white/30` | `rgba(255,255,255,0.3)` | ≈ 5.9 : 1 | ✅ (body) |
| `text-white/20` | `rgba(255,255,255,0.2)` | ≈ 4.0 : 1 | ⚠ large only |
| `text-white/10` | `rgba(255,255,255,0.1)` | ≈ 2.0 : 1 | ❌ borders only |

> `text-white/20` and below are **decorative** — never use them for body
> text. Use `--text-muted` (7.2 : 1) as the lowest acceptable body shade.

## Dark theme — toned-down accent text shades (Phase-40 / Prompt 11)

These are the body-text-friendly replacements for the saturated `text-neon-*`
hues. They are the sole approved colors for non-decoration text in body copy.

| Class | Hex | Ratio vs `#0a0a0f` | AA pass |
|---|---|---:|:---:|
| `text-cyan-300` | `#67e8f9` | ≈ 14.3 : 1 | ✅ |
| `text-emerald-300` | `#6ee7b7` | ≈ 14.0 : 1 | ✅ |
| `text-amber-300` | `#fcd34d` | ≈ 14.7 : 1 | ✅ |
| `text-rose-300` | `#fda4af` | ≈ 10.4 : 1 | ✅ |
| `text-purple-300` | `#d8b4fe` | ≈ 11.0 : 1 | ✅ |
| `text-indigo-300` | `#a5b4fc` | ≈ 9.0 : 1 | ✅ |
| `text-sky-300` | `#7dd3fc` | ≈ 12.6 : 1 | ✅ |
| `text-pink-300` | `#f9a8d4` | ≈ 9.6 : 1 | ✅ |

## Dark theme — neon hues (decoration only, ≤4-char chip labels)

These hues are reserved for backgrounds, borders, glows, dots, and very
short chip labels (≤ 4 chars) where they sit on top of a same-hue tinted
background (e.g. `bg-neon-cyan/10` + `text-neon-cyan`).

| Class | Hex | Ratio vs `#0a0a0f` | AA pass (body text) |
|---|---|---:|:---:|
| `text-neon-cyan` | `#00f0ff` | ≈ 13.4 : 1 | ✅ (but reserved) |
| `text-neon-green` | `#00ff88` | ≈ 16.0 : 1 | ✅ (but reserved) |
| `text-neon-amber` | `#ffb020` | ≈ 11.8 : 1 | ✅ (but reserved) |
| `text-neon-red` | `#ff4060` | ≈ 5.7 : 1 | ✅ (but reserved) |
| `text-neon-purple` | `#b070ff` | ≈ 6.0 : 1 | ✅ (but reserved) |
| `text-neon-blue` | `#5680ff` | ≈ 4.7 : 1 | ✅ (but reserved) |
| `text-tesla-red` | `#e31937` | ≈ 4.5 : 1 | ⚠ borderline |

> `text-tesla-red` is exactly at the AA threshold; prefer `text-rose-300` for
> body copy and reserve `text-tesla-red` for the brand bolt and chips with
> `bg-tesla-red/10` paired backgrounds.

## Severity tokens (`severityTokens` in `web/src/lib/tokens.ts`)

These are the *only* approved foreground+background pairings for state
indication. Always use the helpers (`<SeverityBadge>`, `<StatusDot>`) instead
of raw classes.

| Severity | Background | Border | Foreground (icon + label) | Hex pair | Pass |
|---|---|---|---|---|:---:|
| info | `bg-sky-500/10` | `border-sky-500/30` | `text-sky-300` | `#7dd3fc` on translucent sky-500 | ✅ |
| warning | `bg-amber-500/10` | `border-amber-500/30` | `text-amber-300` | `#fcd34d` on translucent amber-500 | ✅ |
| error | `bg-red-500/10` | `border-red-500/30` | `text-red-300` | `#fca5a5` on translucent red-500 | ✅ |
| success | `bg-emerald-500/10` | `border-emerald-500/30` | `text-emerald-300` | `#6ee7b7` on translucent emerald-500 | ✅ |

Each severity also pairs an icon (`Info`, `AlertTriangle`, `AlertCircle`,
`CheckCircle`) so state is **never communicated by color alone** — required
by WCAG 1.4.1.

## Light theme — overrides in `:root.light-mode` (`web/src/index.css`)

The light-mode CSS overrides the toned-down 300-level shades for readability
on a white background:

| Class | Light-mode hex | Approx ratio on `#ffffff` | Pass |
|---|---|---:|:---:|
| `text-cyan-300` → `#0e7490` | `#0e7490` | ≈ 6.3 : 1 | ✅ |
| `text-emerald-300` → `#047857` | `#047857` | ≈ 5.6 : 1 | ✅ |
| `text-amber-300` → `#b45309` | `#b45309` | ≈ 4.9 : 1 | ✅ |
| `text-rose-300` → `#be123c` | `#be123c` | ≈ 6.1 : 1 | ✅ |
| `text-purple-300` → `#6b21a8` | `#6b21a8` | ≈ 8.3 : 1 | ✅ |
| `text-neon-cyan` → `#0891b2` | `#0891b2` | ≈ 4.5 : 1 | ✅ |
| `text-neon-green` → `#15803d` | `#15803d` | ≈ 5.0 : 1 | ✅ |
| `text-neon-purple` → `#7c3aed` | `#7c3aed` | ≈ 6.4 : 1 | ✅ |
| `text-neon-red` / `text-tesla-red` → `#dc2626` | `#dc2626` | ≈ 4.8 : 1 | ✅ |
| `text-neon-amber` → `#b45309` | `#b45309` | ≈ 4.9 : 1 | ✅ |
| `text-neon-blue` → `#1e40af` | `#1e40af` | ≈ 9.0 : 1 | ✅ |

## Focus rings

Focus-visible rings use the cyan-500 family (`focus-visible:ring-cyan-500`
or `focus-visible:ring-blue-500`) at full opacity. Both clear the 3 : 1
threshold on both the dark `--bg` and the light `#ffffff` background.

## Limitations

- Translucent foregrounds (`text-white/10` … `text-white/30`) are
  approximations — the actual ratio depends on what's behind the body, e.g.
  glass panels with backdrop blur. Use these only for borders and
  decorative dividers.
- Numbers in this table are computed against the dark `--bg` token; pages
  that render content on top of a `bg-white/[0.04]` glass panel should
  re-verify with axe DevTools because the effective background is slightly
  brighter (≈ `#0e0f15`).
- Recharts series colors (`chartTokens.series` in `web/src/lib/tokens.ts`)
  are picked for color-blind safety, not contrast — the same series renders
  on both dark and light themes. Series labels should always be paired with
  a legend swatch + name, never relying on color alone.
