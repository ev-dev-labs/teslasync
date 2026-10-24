# TeslaSync chart palette

## Categorical palette

The chart palette is independent of the user's UI accent preset.

| Series | Hue | Light hex | Dark hex | OKLCH light |
|---|---|---|---|---|
| Blue | Driving / primary | `#398ad6` | `#67aaed` | `oklch(0.62 0.14 250)` |
| Teal | Parked / home | `#18a7a1` | `#52bfb9` | `oklch(0.66 0.11 190)` |
| Green | Online / healthy data | `#4fa866` | `#73bb83` | `oklch(0.66 0.13 150)` |
| Amber | Charging / caution data | `#b8790e` | `#e7b369` | `oklch(0.75 0.13 75)` |
| Orange | Alternative category | `#e57255` | `#ee8f63` | `oklch(0.68 0.15 45)` |
| Rose | Alternative category | `#cd6199` | `#e98092` | `oklch(0.64 0.15 10)` |
| Violet | Asleep / secondary category | `#876cca` | `#a48fe1` | `oklch(0.60 0.14 295)` |
| Slate | Offline / neutral | `#748192` | `#8c9aab` | `oklch(0.60 0.03 255)` |

## Scales and semantics

- Categorical: blue, teal, green, amber, orange, rose, violet, slate.
- Sequential: `CHART_SEQUENTIAL` for low-to-high intensity and heatmaps.
- Diverging: `CHART_DIVERGING` / dark variant for above and below baseline.
- Neutral: `CHART_NEUTRAL` for Other, unknown, comparison baseline, or idle.
- Positive, warning, and danger colors are reserved for real status.
- Rankings and efficiency bands use ordered categorical or sequential colors, never danger red as a neutral ranking color.

## Semantic mapping

| Meaning | Light color | Dark color |
|---|---:|---:|
| Driving | `#398ad6` | `#67aaed` |
| Charging | `#b8790e` | `#e7b369` |
| Parked | `#18a7a1` | `#52bfb9` |
| Online | `#4fa866` | `#73bb83` |
| Asleep | `#876cca` | `#a48fe1` |
| Offline / unknown | `#748192` | `#8c9aab` |
| Solar | `#b8790e` | `#e7b369` |
| Battery | Violet | Violet-dark |
| Grid | Rose | Rose-dark |
| Home | Teal | Teal-dark |

## Usage

### Do

- Import `CHART_COLORS`, `CHART_COLORS_DARK`, `CHART_SEMANTIC`, `CHART_SEQUENTIAL`, or `CHART_DIVERGING` from `@/lib/colors`.
- Use `chartTokens.series` or `dashboardTokens.chart.series` for reusable chart surfaces.
- Use labels, legends, patterns, or tooltips in addition to color.
- Use the neutral token for Other, unknown, or baseline series.

### Do not

- Add hex, RGB, HSL, or OKLCH literals to chart/data-visual call sites.
- Make a single-series chart washed-out or faded.
- Use success, warning, or danger colors for rankings or neutral efficiency bars.
- Use the user-selected UI accent to encode unrelated chart semantics.
- Depend on color alone when a data table or legend can carry the meaning.
