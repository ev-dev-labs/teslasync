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

Reset controls live in **Reset & recovery**, separate from everyday preferences.
The overview retains the current-preference summary, export link, guided-tour
launcher, and setup-checklist restart.

[← All groups](./catalogue.md)
