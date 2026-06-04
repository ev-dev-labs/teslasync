# ADR-005 — Design system: cross-platform tokens mapped to Fluent / Material 3 / HIG

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

The web app has a distinct visual identity (glassmorphism panels, a dark telemetry
aesthetic, an SI-aware number/format style, semantic colors for charts and status).
Four native apps must feel **at home on their OS** (ADR-002) *and* be recognizably
TeslaSync. These two goals conflict if we either (a) clone the web pixel-for-pixel onto
every OS (un-native) or (b) let each platform freelance (inconsistent brand).

## Decision

Define a **platform-agnostic design-token layer** in `apps/design/` (color roles,
typography scale, spacing, radii, elevation, motion, semantic/status colors, chart
palette) extracted from the web app's tokens, then **map** each token to the platform's
native system:

| Token | Windows (Fluent) | Android (Material 3) | Apple (HIG) |
|---|---|---|---|
| color roles | Fluent brush / theme resources | M3 `ColorScheme` (dynamic color opt-in) | SwiftUI `Color` + semantic colors |
| typography | Fluent type ramp | M3 `Typography` | SF / Dynamic Type text styles |
| elevation/glass | Mica/Acrylic | M3 surfaces/tonal elevation | materials/`.regularMaterial` |
| motion | Fluent motion | M3 motion | SwiftUI animations |

**Brand identity comes from tokens (colors, charts, iconography, spacing rhythm);
native-ness comes from honoring each platform's components, navigation, and materials.**
Where the web uses a custom glass panel, each platform uses its *native* equivalent
material tinted by brand tokens — never a hand-rolled glass hack.

## Consequences

- ✅ Consistent brand + native feel; one token source feeds three theme systems.
- ✅ Light/dark + platform theming (Windows accent, Material dynamic color, iOS appearance)
  work natively.
- ⚠️ Tokens must be expressed in a neutral format (e.g. JSON / Style Dictionary) and
  generated into `.xaml`, Kotlin `Theme`, and Swift `Color`/`Font` extensions. P1 builds this.
- ⚠️ Pixel-parity is **semantic**, not literal: "the FleetStatus panel shows the same data,
  hierarchy, and brand colors," not "identical px on every OS." ADR-006 encodes this.

## Alternatives rejected

- **Pixel-clone the web everywhere:** violates ADR-002 (un-native).
- **No shared tokens:** brand drift across platforms.
