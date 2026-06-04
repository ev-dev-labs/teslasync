# `apps/design` — TeslaSync neutral design tokens

This directory holds the **platform-agnostic design-token layer** mandated by
**ADR-005** (`.github/prompts/monorepo/adrs/ADR-005-design-system.md`). Brand identity
(colors, chart palette, spacing rhythm, typography) lives here once; native-ness comes
from each platform mapping these tokens onto its own component/material system.

> **This prompt (P0/0007) defines the token SHAPE only.** Token *values* are extracted
> from the real web theme (`web/src`) in **P1/S9** (`p1-shared/S9-0001-design-tokens.prompt.md`),
> and the generator implementations are authored there too. The placeholders here establish
> the directory contract that every downstream UI prompt depends on.

## Files

| Path | Status | Purpose |
|---|---|---|
| `tokens.schema.json` | authored here (P0/0007) | JSON Schema for the neutral token document. Validates the 7 token categories. |
| `tokens.json` | filled in P1 from web tokens | The neutral token VALUES, extracted from `web/tailwind.config.*`, `web/src/lib/tokens.*`, `web/src/lib/colors.*`, and CSS vars (`--text-primary`, …). Conforms to `tokens.schema.json`. |

## Token categories (schema)

The schema requires all 7 of the following categories. Each is a semantic role layer, not
raw scattered hex:

1. **`color`** — semantic color roles: `bg`, `surface`, `surfaceGlass`, `textPrimary`,
   `textSecondary`, `textMuted`, `accent`, `border`, and `status` (`success` / `warning` /
   `danger` / `info`). Light / dark / high-contrast variants are added in P1.
2. **`chart`** — ordered categorical palette (`categorical`, matching web `CHART_COLORS`)
   plus per-series semantic colors (`series`).
3. **`typography`** — type ramp (`display` / `title` / `section` / `panel` / `body` /
   `bodySm` / `caption` / `label`) plus named `weights`.
4. **`spacing`** — spacing scale on a 4pt `base` with named `scale` steps.
5. **`radius`** — corner radii: `sm` / `md` / `lg` / `pill`.
6. **`elevation`** — elevation `levels` plus glass/`material` mapping (Mica/Acrylic,
   M3 tonal surfaces, SwiftUI materials).
7. **`motion`** — `durations` plus `easing` curves.

## ADR-005 token → platform mapping

Brand comes from tokens; native-ness comes from honoring each platform's components,
navigation, and materials. The neutral token roles map to each OS design system as follows:

| Token | Windows (Fluent) | Android (Material 3) | Apple (HIG) |
|---|---|---|---|
| color roles | Fluent brush / theme `ResourceDictionary` | M3 `ColorScheme` (dynamic color opt-in) | SwiftUI `Color` + semantic colors |
| typography | Fluent type ramp | M3 `Typography` | SF / Dynamic Type text styles |
| elevation / glass | Mica / Acrylic | M3 surfaces / tonal elevation | materials / `.regularMaterial` |
| motion | Fluent motion | M3 motion | SwiftUI animations |
| spacing / radius | DIP layout units | dp layout units | pt layout units |
| chart palette | shared brand `CHART_COLORS` | shared brand `CHART_COLORS` | shared brand `CHART_COLORS` |

Where the web uses a custom glass panel, each platform uses its **native** equivalent
material tinted by brand tokens — never a hand-rolled glass hack. Pixel-parity is
**semantic**, not literal (ADR-006).

## Generation targets

P1/S9 authors generators that emit these deterministically (with a `--check` drift mode):

```
apps/design/tokens.json                  # filled in P1 from web tokens
apps/design/generated/windows/Tokens.xaml   # Fluent ResourceDictionary
apps/design/generated/android/Theme.kt       # Material 3 ColorScheme + Typography
apps/design/generated/apple/Tokens.swift     # SwiftUI Color / Font extensions
```

The three generation target directories (`generated/windows`, `generated/android`,
`generated/apple`) exist now (kept by `.gitkeep`) so downstream prompts have a stable
contract to write into.
