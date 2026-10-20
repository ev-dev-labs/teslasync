# Task: Card/widget UI simplification for the TeslaSync web app (AUTONOMOUS agentic loop)

You are running unattended. The user is unavailable. Do NOT ask questions or wait for
input at any point. Make every decision yourself using the rules in section 4, record it
in the Decision log, and keep going until the "Done when" criteria are met or every
remaining item is blocked.

Another AI tool may continue this task later (tools rotate when usage limits are hit).
Keep `docs/ui-simplification-plan.md` updated and committed after every row so the next
tool can resume exactly where you stopped.

Work in `web/` of the TeslaSync repo (React + TypeScript; i18n in `web/src/i18n`;
icons in `web/src/lib/icons.ts`). Four changes, built once as shared components and
rolled out to every page and dashboard widget:

  A. Evidence card: simpler header, details drawer, flat tile layout
  B. Icon-only actions (Refresh, More, Customize, View history and similar) with tooltip
  C. Data freshness indicator (pulse dot) in the top-right corner of every dashboard widget
  D. Flatten nested "boxed" cards: one surface per widget, no card-in-card-in-card

There is no design reference file. Follow the written spec in section A exactly.
Known starting points (confirm in Explore):
- Card with "Review details": `web/src/components/data-display/OperationalBrief.tsx`
- Refresh buttons are inline on 40+ pages (search the Refresh icon import from `lib/icons`).
- Dashboard widgets already show a freshness indicator (dot + Wi-Fi icon + "just now")
  next to the title. Find that component; C replaces it.
- Examples of heavy nesting: "Next charge" → "Charging options", and
  "Live overview" → "Range and charging".

---------------------------------------------------------------------------------
## 0. Start / resume
- If `docs/ui-simplification-plan.md` exists, you are resuming: read it, continue from the
  first row that is not done/blocked, and do not redo finished work.
- Otherwise: create the branch `ui/simplification` from `fix/dashboard-followups`.
  Never work directly on `main`. Don't use git worktrees; work directly in the repo folder.
- Never run npm install, npm ci, or anything that changes node_modules, package.json or
  package-lock.json. Use the dependencies already installed.

---------------------------------------------------------------------------------
## 1. Hard rules / guardrails (never break these, even to finish)
- UI only. Do NOT change calculations, queries, API contracts, units, or any number shown.
  Exception (C only): if a widget doesn't expose `lastSyncAt` / error / isFetching, add the
  minimum needed in its data layer. Don't redesign fetching.
- Stay inside `web/` (plus `docs/` for the plan file and screenshots). Don't touch backend,
  auth, CI, or build config. If a step can't work without it, mark that row blocked.
- Use existing design tokens and shared-component patterns. No new UI library or new
  runtime dependency. Don't change app-wide surface tokens; only remove nesting.
- Build shared components first; pages adopt them. No per-page copies.
- Keep existing i18n keys working; add new keys to `en.json` and the split locale files.
  Moved text (footnotes, descriptions) keeps its existing keys. Every new user-facing
  string uses t() with a key in the catalog; whole sentences only; i18next count for plurals.
- Never delete, skip, or weaken a test to make it pass. If a test queries by visible text
  (`getByText('Refresh' | 'More' | 'Customize' | 'View history' | 'Review details')`),
  switch it to `getByRole('button' | 'link', { name: '…' })` with the same intent.
- Git: small commits. Push only the `ui/simplification` branch, after each commit.
  Never push to other branches, never merge, never force-push, never rebase/reset/rewrite
  history, never `git stash` without a unique tag, never delete branches.
  Never use `--no-verify`. Never `git add -A` without checking; never commit temporary files.
- Never leave the working tree broken between rows: every commit must pass build,
  lint, and type-check.

---------------------------------------------------------------------------------
## 2. Spec (source of truth)

### Shared card/widget header layout (applies to A, B, C, D)
`[Title ...........] [range chip?] [primary text action?] [secondary icons] [Review details icon] [age text?] [freshness dot]`
- The freshness dot is ALWAYS the right-most element, pinned to the widget's top-right
  corner, vertically centered on the title line. Same position on every widget.
- Title gets the remaining width; truncate with ellipsis + full title in `title` attribute.
- All header controls keyboard-reachable in visual order.
- One heading per block: drop an eyebrow/label when it repeats the section or title.
- Hide a caption/label below the value when it equals the title (e.g. "Battery" under
  a "Battery" widget).

### A. Evidence card
Header:
- Remove from the card: status badge ("Returned evidence" / "Source snapshot"),
  description sentence ("These are not server-wide totals…"), full date range, and the
  inline meta row (e.g. "Next charge decision · Source snapshot · Oct 15, 2026, 03:13 PM").
- Optional `showRange` prop; default = show a short chip ("Last 90 days") only when the
  card's window differs from the page-level filter.

Review details:
- Icon-only button, same icon on every card, immediately left of the freshness dot
  (or right-most if the card has no dot).
- `aria-label` = "Review details" (or `Review <title> details`); tooltip shows that text.
- When a card has several actions, the primary stays text (e.g. "Open Autopilot",
  "Compare drives") and secondary ones become icons.
- On hover/focus the icon's line "draws" once (~400 ms). No constant glow/pulse.
- Status dot on the icon ONLY if the data already carries a review/exception flag:
  amber = review recommended, red = exception, none otherwise. Never invent a flag.

Details drawer:
- Header holds: status badge, full date range, description sentence, snapshot timestamp.
- Per-metric section holds that metric's methodology/footnote text (moved from the card).
- Render only fields with values. Hide "Not provided", "No confidence basis was supplied",
  "No measurement supplied" and similar. Footer note: "N empty fields hidden".

Metric tiles (leftover grey space + cramped tiles):
- No grey container behind the tiles and no background/border on each tile.
  Separate tiles with spacing, or a 1px hairline divider (subtle border token).
- Flex-wrap layout; tiles `flex: 1 1 200px`, so short rows stretch and no cell is left empty.
- Optional `maxPerRow` (e.g. 3) to avoid a lone stretched tile.
- Tile content stacked: label (small, muted) on top, value (large) below, unit inline.
  Never label and value side by side. Values never break mid-word
  (`overflow-wrap: normal; word-break: normal`); long text values wrap at spaces only
  or truncate with a tooltip.
- Card face shows label + value only. Footnotes ("Measured distance; canonical input is
  meters", "Amount in its recorded denomination; no currency conversion",
  "Source-provided status, retained without numeric coercion") move to the drawer.
  Remove the small decorative icons under values.
- All-empty state: if every metric is empty for the same reason, show one empty state
  instead of "—" tiles: message + primary action (if any) + metric names as small chips.
  Examples: "Select a charging session to see heater metrics" + "Choose session";
  Charging options with Home now / Wait window / Supercharger all "—" →
  "No price data yet for charging options".

### B. Icon-only actions (Refresh, More, Customize, View history and similar)
- Applies app-wide to repeated icon + text buttons: Refresh, More (⋯), Customize (⚙),
  View history (clock), Export, Filter, Settings, etc. Show the icon only; the text
  moves into the tooltip.
- Form/flow CTAs (Save, Choose session, Compare drives, Open Autopilot) stay as text.
- Keep each control's visual weight: Customize stays a filled/primary icon button;
  More, Refresh, View history stay ghost/secondary. Only the text label is removed.
- One shared `IconButton` (or extend the existing button component) with props:
  `icon`, `label` (required by type), `variant` (primary | secondary | ghost),
  `onClick`, `href?`, `busy?`, `disabled?`, `tooltipSide?`, plus pass-through for menu
  triggers (`aria-haspopup`, `aria-expanded`) so More keeps working as a menu button.
- If the control navigates (e.g. View history is a link), render a real `<a>`/router link
  styled as an icon button, so middle-click / open-in-new-tab still work.
- `label` drives both `aria-label` and tooltip text.
- Shared `Tooltip`: shows on mouse hover (~300 ms delay) AND keyboard focus; hides on
  mouse leave, blur, Esc. Touch: long-press shows it, tap runs the action.
  No tooltip while the control's own menu (More) is open.
- Same icon for the same action everywhere (from `lib/icons.ts`). Icon 16–18 px,
  hit area ≥ 32×32 px (44 on touch), consistent spacing in page headers.
- Refresh while loading: icon spins, `aria-busy="true"`, label becomes "Refreshing…".
- Page-level Refresh refreshes all widgets on the page; separate from C's per-widget dot.
- Reuse existing i18n keys (`common.refresh`, `common.more`, `…customize`,
  `…viewHistory`) as labels.

### C. Data freshness indicator (every dashboard widget)
Placement: top-right corner of the widget header (see layout). Replaces the current
dot + Wi-Fi icon + "just now" indicator. No Wi-Fi/connection icon.

Four states, judged per widget against its OWN refresh interval:

| State   | Rule                                                  | Dot                                              | Age text                      | Content                      |
|---------|-------------------------------------------------------|--------------------------------------------------|-------------------------------|------------------------------|
| fresh   | age <= 2 × refreshInterval                             | solid green; pings 2× on new data, then still    | hidden (muted on hover/focus) | normal                       |
| stale   | age > 2 × refreshInterval (manual widgets: > 15 min)   | hollow orange ring                               | visible, orange               | value + chart at 45% opacity |
| failed  | last fetch errored (keep last good data)               | solid red, slow continuous pulse                 | visible, red                  | value + chart at 45% opacity |
| syncing | fetch in flight                                        | blue, breathing                                  | hidden                        | unchanged                    |

- When age text is visible it sits immediately LEFT of the dot; the dot stays in the corner.
- Age format: "<1m", "7m", "2h" (no "just now"). Tick every 30 s via ONE shared ticker
  for the page. Never re-render the whole grid per tick; only the age labels update.
- Dot is a button: click = refresh that widget (retry when failed).
- Tooltip + aria-label: "Battery, Model Y: Out of date, updated 24m ago. Click to refresh."
  (uses the shared Tooltip from B).
- Tokens (add if missing), light / dark:
  fresh #15803D / #4ADE80, stale #C2410C / #FB923C, failed #B91C1C / #F87171,
  sync #2563EB / #60A5FA.
- Restart animations only on status change (ping must not replay each tick).
- Optional `edgeOnFailed` prop: 3 px red top strip on failed widgets. Default off.
- No pill, label text, or icon for healthy widgets. Minimal is the requirement.
- Missing refresh interval → treat as manual (stale at 15 min) and log it.

### D. Flatten nested boxed cards
Problem today: section card → evidence card → grey tile grid = 3 nested
borders/backgrounds, plus repeated headings ("Next charge decision" eyebrow +
"Next charge decision" title; "Live overview" section + "Live overview" eyebrow).

Rules:
- At most ONE bordered/raised surface per widget. Everything inside it is flat:
  no border, no background, no shadow, no extra padding box.
- Evidence card (`OperationalBrief`) gets `variant`: `standalone` (default, own surface) |
  `embedded` (no border/background/padding; header aligns with parent content).
  Use `embedded` whenever it renders inside another card/widget.
- Page sections ("Live overview") are a heading + spacing, not another card around cards.
- Group with whitespace and dividers, not boxes: 24 px between groups, 1px hairline only
  where a visual break is truly needed.
- Model to follow: the "Live state" card (single surface, title, content).

### Motion (all parts)
- `prefers-reduced-motion: reduce` disables draw, spin, ping, pulse, breathe.
  States must stay distinguishable by shape/fill (solid vs ring) and text.

---------------------------------------------------------------------------------
## 3. Agentic loop

Plan file: `docs/ui-simplification-plan.md` = single source of truth and resume point.
Sections: Findings, Checklist, Decision log, Open questions, Report-only findings, Summary.

### Step 1: Explore (first run only)
Find and record under Findings:
- Every usage of the evidence card (`OperationalBrief` and look-alikes: search i18n keys
  `operations.reviewDetails`, `returnedDisclosure`, `windowTitle`, "Source snapshot").
- Every icon + text action: Refresh icon import, `t('…refresh')`, More/⋯ menus,
  Customize/gear buttons, View history/clock buttons or links, other repeated ones.
- The existing widget freshness indicator ("just now", Wi-Fi icon import,
  `lastSync`/`updatedAt` rendering) and every widget that renders it.
- Every card/surface rendered inside another card/surface (nested `Card`/`Panel`/
  `OperationalBrief` in widget bodies), and every tile footnote string to move to the drawer.
- Dashboard page(s), widget component(s), how widgets fetch data, where design tokens live,
  how each widget knows its refresh interval / last-success time / error / isFetching.
- Existing button/tooltip/menu/card components to extend instead of creating new ones.
- The exact commands for build, lint, type-check, unit tests, e2e (from package.json).
- Baseline: run them once before any change and record which already fail. Pre-existing
  failures are not yours to fix; just don't make them worse.

### Step 2: Plan
Checklist table:
| # | file | page/route | widget/card | A | B | C | D | data-layer gap | attempts | status |
Status: todo / in-progress / done / blocked(reason). Order rows: shared components first,
then the dashboard, then the highest-traffic pages, then the rest.
Commit: `docs(ui): add simplification plan`.

### Step 3: Build shared pieces (once; each its own commit, each with tests)
1. Tokens: freshness colors (light + dark), subtle divider token if missing.
2. `Tooltip` (hover + focus + Esc + touch long-press) and `IconButton`
   (variants, link mode, menu trigger, busy).
   Tests: accessible name = label; tooltip on hover and on focus; Esc hides; aria-busy;
   no tooltip while menu open; link mode renders `<a>` with href; primary keeps filled style.
3. Shared widget header: layout above, dot slot pinned top-right, caption hidden when
   equal to title, duplicate eyebrow suppressed.
4. Evidence card: new header, icon Review button (draw on hover/focus, flag dot),
   `showRange`, drawer (badge/range/description/timestamp, per-metric footnotes,
   empty-field hiding + count note).
   Tests: `showRange` logic; hidden-field count; footnotes in drawer not on card;
   accessible names; flag dot only when data flag present.
5. Flat tiles + `variant="embedded"`: no tile backgrounds/grey container, dividers,
   stacked label/value, flex-wrap, `maxPerRow`, all-empty state.
   Tests: embedded renders no border/background; all-empty state; values don't break
   mid-word (style check).
6. Freshness: shared ticker, `useFreshness(lastSyncAt, refreshIntervalMs,
   { isFetching, error, manual }) → { status, ageLabel }`, `<FreshnessDot>`.
   Tests: status rules incl. boundary (exactly 2× interval = fresh), manual 15 min,
   failed overrides stale, syncing, age formatting ("<1m", "7m", "2h"),
   ping only on status change, single ticker timer.
Run build, lint, type-check, unit tests after each; fix until green.

### Step 4: Migrate one checklist row at a time (repeat)
a. Set the row to in-progress in the plan file.
b. Apply every part the row needs (A, B, C, D). For C, add minimal data-layer fields
   if missing; apply the 45% fade on stale/failed. For D, switch nested cards to
   `embedded` and remove wrapper surfaces.
c. Run build, lint, type-check, and that page's tests. Fix until green.
d. Verify in the browser at 375 px, 768 px and desktop, light and dark:
   - freshness dot in the top-right corner, same spot on every widget; no Wi-Fi icon
   - at most one border/background per widget; no card-in-card; no grey tile container
   - no leftover empty cells; no mid-word breaks or label/value overlap
   - no repeated eyebrow/title; no meta row or methodology footnotes on the card face
   - Refresh, More, Customize, View history, Review details show icon only; tooltip on
     hover AND focus; Enter activates; More opens its menu; View history navigates as
     before; Esc closes
   - drawer shows badge + range + description + timestamp + per-metric notes,
     no placeholder rows
   - freshness states look right (force stale/failed/syncing via mocks or devtools)
   - reduced motion: no animation, states still distinguishable
   Use the already running dev server on http://localhost:3000 and the Edge browser
   (channel "msedge"); never start your own dev server or download browsers.
   Save before/after screenshots to `docs/ui-simplification/<row#>-<name>-{before,after}-<width>.png`.
   If the browser/dev server can't run, rely on tests + a render/snapshot check, and log it.
e. Self-review the diff for the row: only intended files changed, no numbers/logic touched,
   no leftover debug code, no unused imports.
f. Commit and push the `ui/simplification` branch, e.g.
   `feat(ui): migrate Next charge widget (card, actions, freshness, flatten)`.
g. Mark the row done (or blocked with reason), update attempts, append any decisions.
   Commit and push the plan file update.
h. Re-read the plan file and continue with the next todo row. Do not stop between rows.

### Step 5: Exit check (when no todo/in-progress rows remain)
- Full build, lint, type-check, unit tests, browser/e2e suite. Compare to the baseline.
- Grep for leftovers:
  - inline badge/description/meta row in card headers; text "Review details" buttons
  - icon + visible-text Refresh/More/Customize/View history/Export
  - "just now", the old Wi-Fi freshness icon, widgets without `<FreshnessDot>`
  - nested card/panel inside a widget body without `variant="embedded"`
  - all `<OperationalBrief` call sites, tracing their rendered parents through composed components; every brief inside a card, section surface, or widget must use `variant="embedded"` or have its outer surface removed
  - all `<StatStrip` / `OperationalBrief` metric grids with more than three tiles; verify `maxPerRow` is set or defaults to 3 and the shared layout balances rows (six tiles render 3 + 3, with no orphan tile row)
  - tile footnote strings still rendered on card faces
- Remove the old dot + Wi-Fi + "just now" indicator and any now-unused props/styles.
- Confirm only one ticker timer exists and the grid doesn't re-render per tick
  (React Profiler or render-count test).
- Anything found → add rows to the checklist and go back to Step 4.
- Maximum 3 full exit-check passes; after that, log what's left as blocked and finish.

---------------------------------------------------------------------------------
## 4. Autonomous decision rules (use these instead of asking)
Log every decision in the Decision log as: `row # | situation | decision | why`.

- Spec doesn't cover a case → choose the option that is (1) closest to the spec's intent
  (minimal, one surface, icon + tooltip, nothing hidden that users need), (2) smallest
  change, (3) consistent with what you already did on earlier rows. Log it.
- Breaking prop change needed → allowed. Update every call site in the same commit and
  keep the old prop working as a deprecated alias (JSDoc `@deprecated`) until the exit check,
  where you remove it if nothing uses it.
- Unclear whether a button is a "repeated action" (B) or a CTA → if it appears on 3+ pages
  or in page/widget headers, make it icon-only; otherwise keep text.
- No obvious icon for an action → keep it as text and log it. Don't invent icons outside
  `lib/icons.ts`'s existing set/library.
- Widget has no refresh interval → manual mode (stale at 15 min). No lastSyncAt and it
  can't be added without backend changes → render no dot, mark C blocked for that row.
- Empty-state wording → short, plain: `No <thing> yet` or `Select <thing> to see <metrics>`.
  Add as new i18n keys.
- A test failure you can't trace to your change → check the baseline; if pre-existing,
  ignore it and log; if yours, fix it.
- A test failure caused by data/logic (not UI) → revert your change for that row, mark it
  blocked, add it to Report-only findings, move on.
- Same failure 3 times on a row → revert that row's uncommitted changes
  (`git checkout -- <files>` for that row only), mark blocked with the error, move on.
- Visual check is borderline (e.g. 1–2 px misalignment) → fix if under 10 minutes of work,
  otherwise log under Open questions and move on.
- Two parts of the spec conflict → priority: hard rules > accessibility > section D
  (flatness) > C > B > A styling details. Log it.
- Never decide to skip the guardrails in section 1.

---------------------------------------------------------------------------------
## 5. Report, don't fix (log under Report-only findings with file + evidence)
- Cost mismatch: Overview "$0.0" vs Energy "Recorded cost $11.7" for the same 2 drives
  (configured rate vs session cost).
- "All time" prior-period comparison yields a nonsense window ("Mar 19, 2003 – Dec 31, 2014");
  suggest skipping comparison for all-time.
- Low precision for small amounts ("$0.1/km", "Monthly est. $0.1"); suggest 2 decimals under $1.
- Duplicate metrics between Driving posture and Overview (drives, distance, Wh/km).
- Battery shows "0.00 %" / "0.0 %" and range "0.0 km" while marked fresh; check whether
  missing data is rendered as zero.
- Next charge: "0.0% → 80.0% · 60.0 kWh needed" with "Charge home now" while all charging
  options are empty; check the recommendation's inputs.
- Any other suspected data bug found along the way.

## 6. Done when
- Every checklist row is done or blocked with a reason.
- Build, lint, type-check, unit and e2e tests pass (or match the baseline's pre-existing failures).
- Freshness dot sits in the top-right corner of every widget; old Wi-Fi indicator removed.
- Repeated actions are icon-only with hover + focus tooltips.
- No widget has more than one bordered surface; tiles are flat with stacked label/value.
- One ticker drives all age labels; no full-grid re-render per tick.
- Reduced motion, dark mode, keyboard, and 375 px / 768 px / desktop verified.

## 7. Final handoff (write to the plan file's Summary, then stop)
- Branch name and commit list (`git log --oneline fix/dashboard-followups..HEAD`).
- Shared components + props added/deprecated/removed.
- Rows done / blocked (with reasons and the exact error for each blocked row).
- Data-layer changes.
- Decision log highlights: the 5–10 decisions most worth a human review.
- Open questions and Report-only findings.
- Commands run + final results vs baseline.
- Screenshot folder path.
Leave everything committed and pushed on the `ui/simplification` branch.
Do not open a PR and do not merge.
