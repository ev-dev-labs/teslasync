# TeslaSync chart palette

## Categorical palette

The chart palette is independent of the user's UI accent preset.

| Series | Hue | Light hex | Dark hex | OKLCH light |
|---|---|---|---|---|
| Blue | Driving / primary | `#1779e1` | `#65a7fa` | `oklch(0.58 0.18 255)` / `oklch(0.72 0.14 255)` |
| Teal | Parked / home | `#009d9e` | `#25c2c2` | `oklch(0.62 0.13 195)` / `oklch(0.74 0.12 195)` |
| Green | Online / healthy data | `#20a04e` | `#5bbd74` | `oklch(0.62 0.16 150)` / `oklch(0.72 0.14 150)` |
| Amber | Charging / caution data | `#ca8000` | `#eba941` | `oklch(0.66 0.16 75)` / `oklch(0.78 0.14 75)` |
| Orange | Alternative category | `#e75c3a` | `#f78955` | `oklch(0.65 0.18 35)` / `oklch(0.74 0.15 45)` |
| Rose | Alternative category | `#d4407c` | `#f37986` | `oklch(0.60 0.19 0)` / `oklch(0.72 0.15 15)` |
| Violet | Asleep / secondary category | `#7f57d1` | `#ab91f2` | `oklch(0.56 0.18 295)` / `oklch(0.72 0.14 295)` |
| Slate | Offline / neutral | `#63748a` | `#8a9bb3` | `oklch(0.552 0.04 255)` / `oklch(0.685 0.04 255)` |

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
| Driving | `#1779e1` | `#65a7fa` |
| Charging | `#ca8000` | `#eba941` |
| Parked | `#009d9e` | `#25c2c2` |
| Online | `#20a04e` | `#5bbd74` |
| Asleep | `#7f57d1` | `#ab91f2` |
| Offline / unknown | `#63748a` | `#8a9bb3` |
| Solar | `#ca8000` | `#eba941` |
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
