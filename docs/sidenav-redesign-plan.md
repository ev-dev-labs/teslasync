# Side navigation redesign

## Findings and coverage contract

Base: origin/ui/simplification at e512fc53cd. Worktree: D:/repos/teslasync-sidenav. Branch: ui/sidenav-redesign. Dependencies: web/node_modules junction to the existing installation; never install.

The current shell mounts CommandDeck → SectionRail and AtlasPanel. Canonical primary/secondary data is Layout.navSections; collections.ts folds it into named secondary groups without removing routes. Layout derives activeSectionTitle using longest matching path and collectionPrimaryPath. Pins/recent paths use lib/navPins.ts (existing localStorage, server pin synchronization); lib/recentPages.ts provides the longer page history. Suggested derives from sidebarSuggest.ts. Saved/All pages currently occupy rail shortcuts; Alerts and Display occupy its footer. ThemeQuickSwitcher supplies the existing theme menu. Account destinations lived in the Account section; there was no shared account menu to reuse, so the new menu reuses Avatar and those same destinations. Tooltip/IconButton, lib/icons.ts, shellFocusTrap/useDialogFocus and existing accent/on-accent/nav surface tokens will be reused. StatusBar already uses shell-tab-bar-height and safe-area tokens; change the mobile breakpoint from xl to md for the new tablet rail.

## Checklist

- [x] Isolated worktree and linked dependencies; inventory recorded before changing UI.
- [x] Responsive rail, contextual panel, phone sheets and persisted state.
- [x] Translation audit and generated catalog/fingerprints.
- [x] Unit/coverage tests and Edge layout guard/screenshots.
- [ ] Gates, final results, stop server and push.

## Decisions

Keep the existing visible section order and permissions/persona derivation. Desktop rail is always 76px and panel 272px. Reuse AtlasPanel grouping/search/pin rows and existing theme/account controls. Local storage follows the CommandDeck mechanism: read section/open/group state synchronously before first render, validate stored section against data, and use the route when missing. Route changes select the route section; browsing a section persists without navigating. Phone highlights by route and never restores open sheets. Rail scroll is restored by scrolling the selected section into view.

## Complete original canonical primary and secondary inventory

The JSON sibling is the machine-readable frozen coverage contract. Collection expansions retain these same destinations.

### Home

- Dashboard: `/`
- Action center: `/action-center`
- Explore features: `/explore`
- Live map: `/live`
- Timeline: `/timeline`
- Activity timeline: `/activity`
- Weekly digest: `/weekly-digest`

### Vehicles

- My vehicles: `/vehicles`
- Vehicle management: `/vehicle-management`
- Vehicle live view: `/digital-twin`
- Day log: `/day-log`
- Compare vehicles: `/vehicle-comparison`
- Saved locations: `/locations`
- Parking analytics: `/parking`
- Utilization: `/utilization`
- Time machine: `/time-machine`
- Physics cockpit: `/physics-cockpit`
- Fleet operations: `/fleet-operations`
- Warranty & resale vault: `/resale-vault`

### Driving

- Drives: `/drives`
- Trips: `/trips`
- Journeys: `/journeys`
- Trip planner: `/trip-planner`
- Navigation: `/navigation`
- Geofences: `/geofences`
- Mileage log: `/mileage`
- Trip logbook: `/logbook`
- Mileage budget: `/mileage-budget`
- Driving rhythm: `/driving-rhythm`
- Speed sweet spot: `/speed-sweetspot`
- Efficiency target: `/efficiency-target`
- Cold start cost: `/cold-start`
- Drive compare: `/drive-compare`
- Explorer: `/explorer`
- Drive calendar: `/drive-calendar`
- Milestones: `/milestones`
- Lifetime stats: `/lifetime-stats`
- Drive score: `/drive-score`
- FSD insights: `/fsd`
- Speed profile: `/speed-profile`
- Driving dynamics: `/driving-dynamics`
- Regen braking: `/regen-efficiency`
- Route efficiency: `/route-efficiency`
- Drive DNA: `/drive-dna`
- What-if simulator: `/what-if`
- Departure forecast: `/departure-forecast`
- Arrival reliability: `/arrival-reliability`
- Destination transitions: `/destination-transitions`
- Journey fragmentation: `/journey-fragmentation`
- Seasonal efficiency: `/seasonal-efficiency`
- Ghost racing: `/segments`

### Charging

- Charging overview: `/charging`
- Charge history: `/tesla-charging-history`
- Charging curve: `/charging-curve`
- Charging patterns: `/charging-heatmap`
- Smart charging: `/smart-charge`
- Charger health: `/charger-health`
- Charge interruption: `/charge-interruption`
- Charger resilience: `/charger-resilience`
- Charge alignment: `/charge-departure-alignment`
- Charging thermal tax: `/charging-thermal-tax`
- Powershare: `/powershare`

### Battery

- Battery health: `/battery`
- Battery cells: `/battery-cells`
- Battery degradation: `/battery-degradation`
- Projected range: `/projected-range`
- Vampire drain: `/vampire-drain`
- Sleep efficiency: `/sleep-efficiency`
- Battery passport: `/battery-passport`
- Pack capacity: `/pack-capacity`
- Battery cycle stress: `/cycle-stress`
- Range buffer: `/range-buffer`
- Battery care: `/battery-care`
- Charge advisor: `/charge-advisor`

### Energy

- Energy usage: `/energy`
- Energy flow: `/energy-flow`
- Power flow: `/power-flow`
- Solar & Powerwall: `/energy-products`
- Energy ledger: `/energy-ledger`
- Energy orchestrator: `/energy-orchestrator`

### Cabin

- Climate control: `/climate-control`
- Cabin thermal Model: `/cabin-thermal`
- HVAC Cycling: `/hvac-cycling`
- Comfort consistency: `/comfort-consistency`
- Preconditioning effectiveness: `/preconditioning-effectiveness`
- Media player: `/media-player`

### Service

- Tire pressure: `/tire-pressure`
- Tire differential drift: `/tire-differential-drift`
- Drivetrain health: `/drivetrain-health`
- Software updates: `/software-updates`
- Firmware impact: `/firmware-impact`
- Maintenance: `/maintenance`
- Recall & service intelligence: `/service-intelligence`
- Service evidence pack: `/diagnostics/service-evidence`

### Reports

- Statistics: `/statistics`
- Analytics: `/analytics`
- Period comparison: `/period-compare`
- Efficiency: `/efficiency`
- Temperature impact: `/temperature-impact`
- Cost analysis: `/cost-analysis`
- Cost of ownership: `/tco`
- Share card studio: `/share-card`
- Carbon intelligence: `/analytics/carbon`
- Drive archetypes: `/drive-archetypes`
- Private benchmarks: `/benchmarks/privacy`

### Commands

- Send commands: `/commands`
- Command history: `/command-history`
- Command reliability: `/command-reliability`

### Automation

- Automations: `/automations`
- Automation history: `/automations/history`
- Alert studio: `/notifications/studio`
- Alert rules: `/notifications/rules`
- Alert packs: `/notifications/packs`

### Notifications

- All notifications: `/notifications/inbox`
- Notification channels: `/notifications/channels`
- Browser notifications: `/notifications/browser`
- Quiet hours: `/notifications/quiet-hours`
- Notification health: `/notifications/health`

### Advanced intelligence

- Vehicle twin lab: `/intelligence/twin-lab`
- Firmware canary: `/intelligence/firmware-canary`
- Component survival: `/intelligence/component-survival`
- Road hazard mesh: `/intelligence/road-hazards`
- Behavioral sentinel: `/intelligence/behavioral-sentinel`
- Charging forensics: `/intelligence/charging-forensics`
- Journey assurance: `/intelligence/journey-assurance`
- Charging site twin: `/intelligence/charging-site-twin`
- Federated learning: `/intelligence/federated-learning`
- Emergency resilience: `/intelligence/emergency-resilience`
- Causal experiment lab: `/intelligence/causal-lab`
- TCO optimizer: `/intelligence/tco-optimizer`

### Ownership intelligence

- Insurance telematics: `/ownership/insurance-telematics`
- Utility tariff lab: `/ownership/tariff-lab`
- Invoice reconciliation: `/ownership/charging-reconciliation`
- Driver attribution: `/ownership/driver-attribution`
- Warranty command: `/ownership/warranty-command`
- Data governance: `/ownership/data-governance`
- Model trust lab: `/ownership/model-trust`
- Jurisdiction compliance: `/ownership/jurisdiction-compliance`
- Consumables lifecycle: `/ownership/consumables-lifecycle`
- Subscription ROI: `/ownership/subscription-roi`

### Tesla physics

- Physics overview: `/tesla-physics`
- Science lab: `/science`

### Security

- Security & access: `/security-access`
- Safety settings: `/safety-settings`
- Guard mode: `/guard-mode`

### Account

- Tesla account: `/tesla-account`
- Active orders: `/tesla-orders`
- Fleet API: `/fleet-api`
- Region & API: `/tesla-region`
- Feature flags: `/tesla-features`
- Two-factor auth: `/account/2fa`
- Active sessions: `/account/sessions`
- Privacy: `/account/privacy`
- My activity: `/me/activity`

### Settings

- General settings: `/settings`
- Fleet setup: `/settings/fleet-setup`
- Helix chat: `/chatbot`
- Developer tools: `/dev-tools`

### Integrations

- Helix: `/integrations/helix`
- API keys: `/api-keys`
- Gas prices: `/gas-price`
- Intelligence packs: `/intelligence-packs`

### Data

- Data export: `/data-export`
- Backup & restore: `/backup`
- Data repair: `/data-repair`

### Diagnostics

- System status: `/system-status`
- Tesla API usage: `/tesla-api-usage`
- Outage autobiography: `/outage`
- Database health: `/db-health`
- Anomaly detection: `/anomaly-detection`
- Remaining useful life: `/diagnostics/rul`
- Root-cause intelligence: `/diagnostics/root-cause`
- Dashcam & Sentry: `/dashcam`
- Live signals: `/signals`
- Live signal inspector: `/admin/live-signals`
- Ingest X-Ray: `/admin/ingest-xray`
- DLQ inspector: `/admin/dlq`
- Platform feature flags: `/admin/flags`
- Schema drift: `/admin/schema-drift`
- Slow queries: `/admin/slow-queries`
- Vehicle cost: `/admin/vehicle-cost`
- Data quality: `/admin/data-quality`
- Disk forecast: `/admin/disk-forecast`
- Secret rotation: `/admin/secret-rotation`
- Audit log: `/admin/audit-log`
- GDPR exports: `/admin/gdpr-exports`
- State debugger: `/state-debugger`
- MQTT inspector: `/mqtt-inspector`
- Signal correlation: `/signal-correlation`
- Signal entropy: `/signal-entropy`
- Signal trend: `/signal-trend`
- Signal change points: `/signal-change-points`
- Signal deadband advisor: `/signal-deadband`
- Nonlinear signal coupling: `/signal-mutual-information`
- Redis signals: `/redis-signals`
- Telemetry coverage: `/admin/telemetry/coverage`
- API logs: `/api-logs`
- API playground: `/api-playground`

### About

- Roadmap: `/roadmap`

## Step 2 implementation and early verification

Replaced the old rail/secondary rendering and removed 900+ obsolete shell lines. Reused AtlasPanel rows, filters, suggestions and pin controls. New rail uses only existing section data, 76px width, 60px items, 20px icons, 11px short labels, exact theme-accent/theme-on-accent tokens, roving focus and scroll-position fades. Panel is 272px; tablet overlays and phone sheets use the shared Modal focus/Escape/backdrop primitive. Phone tabs are Home, Vehicles, Driving, Charging and More. Existing StatusBar tokens now switch tab-bar reservation at 768px, so only the lowest phone bar pads for the safe area.

Stored section selection is read synchronously; valid stored selection overrides route, missing/invalid stored selection falls back to route. Panel visibility and collapsed-group state persist. Phone sheets stay closed after reload and tab highlight follows route. Desktop reload/browser assertions pass for browsed section and closed panel.

Early verification: new unit tests 39/39 passed; Edge gallery/reload 8/8 passed. Guard initially 11/12 chunks passed (24 page/width measurements); live map at 1280px found a per-character wrapped retry label. Corrected the button to use a full row; rerun pending. The first trio run found AtlasPanel requires a new fingerprint and an inherited DashboardPage checkpoint mismatch; DashboardPage source is unchanged in this branch and its complete translation audit passes, so refresh only its stale fingerprint. All frozen hashes are generated by the existing checkpoint script after successful audit.

## Step 3 review and cleanup

Removed the remaining obsolete compact-panel/mobile-drill implementation from AtlasPanel (another 600+ lines). The shared panel now has one rendering path for desktop, tablet and phone. Collapsed groups unmount their links, so focus trapping excludes hidden pages. The Hide-panel action returns desktop focus to the selected rail item. Tablet backdrop starts beside the rail, keeping section switching available. Account uses the existing Avatar and expands the complete Account collection. Section recents now subscribe to lib/recentPages.ts and merge its 50-entry history with the prior nav history.

The map issue was a nested grid using viewport-based three columns inside a narrow card; made source-card columns depend on their available width. Focused Edge guard at /live, 1280px: PASS. The subsequent full guard/gallery run passed 20/20 before the final cleanup; a final run is in progress. The standalone production build including all postbuild contracts passed before final cleanup; repeat is in progress.

Expanded tests cover Home hub reachability, unpinning without losing canonical routes, invalid collapsed-state storage, real browser Tab/Shift+Tab wrapping with a collapsed group, tablet outside-click/navigation closure, and phone navigation followed by reload. All translation calls in the five navigation files pass the typed audit, including actual collection label domains. AtlasPanel now has an authorized combined byte checkpoint, generated by i18n-trio-combined-checkpoint.mjs after verification.

### Blocked legacy test compatibility (tests preserved)

The unchanged BottomTabBar.test.tsx and CommandDeck.test.tsx return **4 passed / 56 failed**. Exact examples: `Unable to find an accessible element with the role "link" and name "Home"` (new phone tabs open sheets as buttons), `expected 5 to be 6` (requested five tabs replace six links), and missing rail button `Suggested` (requested Home-panel placement). Other failures demand resizable/icon-only secondary columns and the old mobile drill levels, which the redesign explicitly removes. These tests were not deleted, skipped, rewritten or weakened. Their old interaction contract conflicts with the requested design; the new 42-check navigation suite exercises the replacement contract and the 199-destination coverage inventory. This remains an explicitly reported compatibility limitation, not a passing gate.

## Utility coverage contract

| Existing option | Preserved destination or action |
| --- | --- |
| Suggested | Home panel → Suggested feed (same suggestions/pin actions) |
| Saved | Home panel → Saved pages (same pin storage/sync) |
| All pages | `/explore` |
| Alerts | `/notifications/inbox`, same unread count |
| Display | Existing ThemeQuickSwitcher appearance menu; fallback `/settings#appearance` |
| Collapse | Hide panel / re-press selected rail section; saved open/closed state |
| Account | Same Account collection destinations, expanded in avatar menu |
| Filter | Existing token/group matching, scoped to selected section |

Primary section ordering and every original route are checked against the frozen JSON inventory, in addition to rendering all 22 section panels. Existing shared width tokens remain because cn/token tests still consume their public API; obsolete two-column rendering and collapse styles were removed from navigation.

## Step 4 overlay interaction review

Verified and fixed tablet Escape after section selection leaves focus on the rail; handling now closes only the topmost navigation drawer and respects nested dialogs. Scoped the shared Modal centering wrapper to pointer-events:none for navigation sheets/drawers, with pointer events restored on the panel itself, so real backdrop clicks close them. Focused Edge cases at 375px and 768px pass with outside-click, navigation closure and reload assertions. Rail tooltips now fill the rail item width, keeping icons/labels centered at 38px; native full-name titles provide a clipping-safe fallback.

Final standalone tsc --noEmit: PASS. Latest targeted unit run: 42/42 navigation checks PASS. Combined new navigation, data-source and trio run: 7,749/7,749 PASS (42 navigation + 35 data-source + 7,672 i18n). No code changes remain planned; final Edge screenshots, full lint after removing the isolated development cache, and production build are in progress.

## Step 5 final filter behavior

The complete Edge layout/gallery matrix passed **20/20**, with all **24 route/width measurements passing** and 24 final light/dark screenshots captured. Restored the existing filter interaction detail: matching groups can be collapsed during filtering, while those temporary changes do not overwrite saved group collapse state. Both the unit filter case and desktop browser cases now assert this. Regenerated AtlasPanel source and combined fingerprints only after its complete translation audit passed again. Final interaction rerun and gates follow below.

## Step 6 accessibility and final gate preparation

Completed the accessibility convention repairs without suppressions: account Escape handlers live on the interactive summary/links, and the offline-pin description uses VisuallyHidden. The rail also scrolls its selected section into view on route changes within the same section; the existing route-change unit case now checks this. Regenerated AtlasPanel fingerprints through the checked source/combined generators after the shared-primitive change. New navigation/data-source/trio tests remain **7,749 passed / 0 failed / 0 skipped**.

All 24 screenshots and the screenshot index are ready. The port-3100 server is stopped and no listener remains. Its generated cache and intermediate reports are retained in the ignored, worktree-local `.sidenav-vite-cache/` folder outside the source lint scan; they are not committed. No source/test exclusions were added to ESLint. The full production build and lint pipelines are being rerun for this final source state. The three Muse-owned plan/progress files have no diff from the branch baseline.

## Step 7 action classification and reproducible fingerprints

Clarified the reversible bookmark action with the existing Unpin label. The action-audit finding itself was the clear-filter control; its standard `not-destructive` source annotation states that only transient query text is reset, matching the repo's existing filter controls. Audit code and tests are unchanged. Focused freshness-actions audit: **8 tests passed, zero findings**.

Normalized owned source files to LF before regenerating frozen source/combined checkpoints, so their byte hashes match committed Git blobs on a fresh checkout. The build that crossed a commit correctly failed the PWA SHA-identity gate (worker embedded 0b20b9726c while HEAD had advanced to 5421d5349b); the final build will run with HEAD held fixed. No PWA checks were changed.

Workflow limitation: the preview service stayed up for about 32 minutes across browser iterations, exceeding the 20-minute command cap before its final stop. It is stopped now. Verification commands themselves stayed under 20 minutes. This overrun is recorded rather than treated as compliance with the cap.
