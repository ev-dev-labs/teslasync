# Settings

Sidebar group **Settings**. In the app, expand this section in the left nav (or search `/explore`).

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| General Settings | `/settings` | Categorized preferences: overview, units/language/costs, workspace, appearance, fonts, confirmations, and reset/recovery. | Categories remain available while settings load or are unavailable. |
| Fleet Setup | `/settings/fleet-setup` | Connect Tesla, refresh the Fleet token, subscribe telemetry, and confirm streaming. | Empty until Tesla Fleet API is connected in Settings → Fleet Setup. |
| Helix Chat | `/chatbot` | Ask Helix anything about your car or this app. | Hidden until Helix is enabled in Settings. |
| Developer Tools | `/dev-tools` | In-app developer surface — flags, debuggers, and inspectors. | Renders an empty state when no data is available — the page is not hidden. |

Use the category navigation on desktop or the category selector on mobile.
Search opens the relevant category; existing links such as `/settings#general`
and `/settings#appearance` continue to work. Switching categories preserves
unsaved form edits and does not save automatically. Each section retains its own
save or instant-apply behavior.

**Decimal precision** in Units, language & costs controls measurement, currency
and percentage displays across pages, tables, widgets and chart tooltips.
Changing the saved preference updates mounted displays without reloading data.
Counts, identifiers and clock durations remain integers or clock-formatted;
scientific diagnostics may retain a minimum number of decimals to avoid hiding
meaningful detail, while honoring a higher selected precision. This preference
changes presentation only, not stored SI values, calculations or filter limits.

Numeric alert and automation editors use preferred units and locale-aware
decimals when the signal's dimension is available. Thresholds are converted
back to the API's canonical units without rounding; computed metrics retain
their existing wire-unit contract. Percentage-change thresholds use percentages,
not the metric's measurement unit. Numeric membership lists use semicolons in
the editor so decimal commas remain unambiguous. Currency preferences change
presentation, not exchange rates. Focusing and leaving an unchanged rounded
field does not replace its precise stored value.

**Fonts & readability** at `/settings#typography` offers a searchable UI and
monospace font library, live font samples, and a text field for trying your own
copy. Font selection, reading presets, scale, line height, letter spacing, and
heading weight apply across the app immediately. Selected fonts are persisted
with the rest of the settings and restored before the first page paint.

Reset controls live in **Reset & recovery**, separate from everyday preferences.
The overview retains the current-preference summary, export link, guided-tour
launcher, and setup-checklist restart.

Overview shortcuts stack their descriptions above their actions instead of
squeezing them alongside buttons. Cards reflow with the available width and
wrap their titles. Summary values also wrap to accommodate larger fonts and
long font-family names without overlapping adjacent cards.
Browser regression checks cover 320–2560px viewports in
light and dark themes, at normal and 135% text size.

[← All groups](./catalogue.md)
