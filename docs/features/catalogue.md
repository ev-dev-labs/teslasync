# Feature catalogue

Operator index of TeslaSync screens. Labels and paths come from the live sidebar (`navSections` in `web/src/components/layout/Layout.tsx`). One-line descriptions come from Explore (`web/src/features/explore/featureCatalog.ts`).

**In the app:** sidebar groups, or **Explore Features** at `/explore`.
Related views are nested directly under their task in the sidebar. The current
task opens automatically, so switching between its views is one click: no
intermediate landing page or second row of tabs. Group counts show how many
destinations are available; Expand a group to reveal every original route.
Sections with just one collection list their pages directly; sections with
multiple collections show one more connected level. Counts are displayed as
plain numbers at each branch; the selected page has its own accent. The full
searchable catalogue, direct URLs, pins and visibility rules remain.
Sidebar section, collection and page names and glyphs are distinct, so a
branch cannot be mistaken for one of its destinations. A pinned page moves
to Quick access instead of appearing a second time in its original branch;
unpinning restores it there without changing the route.
The section list also shares a vertical rail, so collapsed sections are part
of the same hierarchy as their expanded collections and pages.
The desktop sidebar can be resized by dragging its edge or using the arrow keys
on its resize handle; the chosen width is saved in this browser. Labels wrap to
fit instead of being clipped.

| Sidebar group | Screens | Catalogue page |
| ------------- | ------: | -------------- |
| Home | 7 | [catalogue-home.md](./catalogue-home.md) |
| Vehicles | 11 | [catalogue-vehicles.md](./catalogue-vehicles.md) |
| Tesla Physics | 16 | [catalogue-tesla-physics.md](./catalogue-tesla-physics.md) |
| Driving | 32 | [catalogue-driving.md](./catalogue-driving.md) |
| Charging | 11 | [catalogue-charging.md](./catalogue-charging.md) |
| Battery | 12 | [catalogue-battery.md](./catalogue-battery.md) |
| Energy | 6 | [catalogue-energy.md](./catalogue-energy.md) |
| Service | 8 | [catalogue-service.md](./catalogue-service.md) |
| Cabin | 6 | [catalogue-cabin.md](./catalogue-cabin.md) |
| Reports | 11 | [catalogue-reports.md](./catalogue-reports.md) |
| Commands | 3 | [catalogue-commands.md](./catalogue-commands.md) |
| Automation | 3 | [catalogue-automation.md](./catalogue-automation.md) |
| Notifications | 9 | [catalogue-notifications.md](./catalogue-notifications.md) |
| Advanced Intelligence | 12 | [catalogue-advanced-intelligence.md](./catalogue-advanced-intelligence.md) |
| Ownership Intelligence | 10 | [catalogue-ownership-intelligence.md](./catalogue-ownership-intelligence.md) |
| Security | 3 | [catalogue-security.md](./catalogue-security.md) |
| Account | 9 | [catalogue-account.md](./catalogue-account.md) |
| Settings | 4 | [catalogue-settings.md](./catalogue-settings.md) |
| Integrations | 4 | [catalogue-integrations.md](./catalogue-integrations.md) |
| Data | 3 | [catalogue-data.md](./catalogue-data.md) |
| Diagnostics | 32 | [catalogue-diagnostics.md](./catalogue-diagnostics.md) |
| About | 1 | [catalogue-about.md](./catalogue-about.md) |

## How to use this

1. Find the **sidebar group** (same titles as the app).
2. Open the path in your installation (example: `https://your-host/charging`).
3. If a panel is empty, use the **When empty** column — missing telemetry is not a blank product.

Detail pages such as `/drives/:id` and `/charging/:id` are opened from list rows, not the sidebar.

Regenerate after nav changes:

```bash
node docs/scripts/generate-feature-catalogue.mjs
```
