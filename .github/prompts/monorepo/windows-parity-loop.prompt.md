# Windows Parity LOOP v2 — paste this into the running session

Your last "completed" was false: `apps/parity/windows-ledger.json` has **0 rows**, the
native app has **8 XAML views vs the web's 144 pages / 312 components**, and the entire
app shell, theme system, and dashboard layouts were never built. Builds/tests pass on a
divergent UI because **gates cannot see pixels**. This loop fixes that.

You are a **loop**, not a one-shot. Repeat the iteration below until EVERY unit is truly
`done`. **The ledger on disk is the ONLY source of truth — never declare "done" in chat.**
If the ledger is not 100%, you are not done. Re-derive progress from disk each iteration so
you survive context compaction. **Never ask permission or for me to type "continue".**

## The live web app is the reference (always running)
`http://localhost:3000/` is up at all times. For EVERY unit, open the same route in the web
app and match it. `web/src` is the canonical source; the live app is the visual + behavioral
oracle.

## Durable state (read every iteration)
- SPEC: `apps/parity/parity-manifest.json` (1754 units) **+** `apps/parity/parity-chrome-units.json`
  (9 shell/theme/layout units that the manifest scan missed). Treat them as one combined list.
- PROGRESS: `apps/parity/windows-ledger.json` (you write it). Row =
  `{unitId, platform:"windows", status, coveredCount, requiredCount, visualScore, shotPath, deltas, attempts, promptId, evidenceLog}`.
  Create `[]` if missing. `visualScore`/`shotPath`/`deltas`/`attempts` are required additions.
- STOP: if `apps/parity/STOP-windows-loop` exists, stop now.

## One iteration
1. **Read the ledger** fresh from disk.
2. **Pick the next unit** (no row, or status `todo`/`in_progress`; skip `done`/`blocked`).
   Order: chrome/theme/layout units FIRST (`component:shell/*`, `component:theme/*`,
   `component:dashboard/LayoutSystem`, `component:data-display/DigitalTwin3D`), then
   dashboard/widget units, then the rest in manifest order. If none remain → print
   `=== LOOP COMPLETE ===` with done/blocked counts and STOP.
3. **Claim it**: write row `status:"in_progress"`, increment `attempts`. Save.
4. **Implement that ONE unit natively** in `apps/windows/TeslaSync.App` to FULL parity. It is
   `done` only when it passes ALL FOUR dimensions vs the live web route:
   - **A. Visual fidelity** — light/card-based look matching web: theme + token colors
     (`apps/design/generated/windows/Tokens.xaml`, no hardcoded colors), typography scale,
     8pt spacing/density, rounded corners (~12px), soft shadows, hairline borders, icons,
     same grid columns. No "clunky/dated/dark-by-default" drift.
   - **B. Structure / IA** — navigation generated from the SAME route registry as web; the
     sidebar shows the exact Favorites + Pages tree with count badges, search, logo (replace
     the invented flat nav). Same top toolbar, status bar, command palette, floating action.
   - **C. Component inventory (bidirectional)** — implement EVERY child component the web
     route renders, and REMOVE native-only extras the web lacks (e.g. the "Personalize
     TeslaSync" banner and the standalone VEHICLE card if web has no equivalent). Digital Twin
     must render the real 3D vehicle, not a wireframe.
   - **D. Functional** — every interaction, route/nav flow, data source, and all data states
     (`loading`/`empty`/`error`/`success`); all i18n strings bound.
   No stubs, no TODO, no `NotImplementedException`. `coveredCount` must reach `requiredCount`
   (manifest units: panels+charts+maps+states+strings; chrome units: length of `parityChecklist`).
   Native file map: pages → `apps/windows/TeslaSync.App/<Feature>/<Name>Page.xaml(.cs)`+ViewModel;
   widgets → `dashboard-widgets` 4-file pattern; shell → `Shell/` + `Components/`; themes → `Themes/`.
5. **Run the gates** (from repo root):
   - `dotnet build apps/windows/TeslaSync.sln -c Release`
   - `dotnet format apps/windows/TeslaSync.sln --verify-no-changes`
   - `pwsh apps/tools/check-placeholders.ps1 -Path apps/windows -Language csharp`
   - `dotnet test apps/windows/TeslaSync.App.Tests/TeslaSync.App.Tests.csproj`
   - (UITests need WinAppDriver, absent on this host → deferred per
     `apps/environment-pending-verifications.md`; do not fail the loop on it.)
6. **Visual evidence (required — this is the gate that was missing):**
   - Ensure the app is running, navigate to the unit's route, then capture:
     `pwsh .github/prompts/monorepo/capture-window.ps1 -Title TeslaSync -Out apps/windows/.loop-logs/shots/<safeUnitId>.png`
   - Open `http://localhost:3000/<route>` and compare the screenshot to the live web view
     across dimensions A–C. Compute `visualScore` 0–100 and list concrete `deltas`
     (missing components, extra components, color/spacing/typography mismatches).
7. **Record honestly:**
   - `done` ONLY when: all host-runnable gates green **AND** `coveredCount == requiredCount`
     **AND** `visualScore >= 95` **AND** `deltas` has no missing/extra component. Set
     `shotPath` to the saved screenshot, write a `=== PARITY ===` block.
   - Otherwise keep `status:"todo"` (or `blocked` only for a real env gap), record `visualScore`
     + `deltas`, and the NEXT iteration must improve this same unit. After `attempts >= 3`
     without reaching the bar, set `blocked` with the blocking `deltas`.
8. **Commit** (preferred): `git -C <repo> add -A; git -C <repo> commit -m "windows parity: <unitId> (visual <score>)"`.
9. **Beacon** — one line:
   `[loop {done}/{total}] unit={id} status={s} covered={c}/{r} visual={v} deltas={n}`
10. **Immediately start the next iteration.** No summaries, no pausing, no questions.

## Stop conditions
- Every unit (manifest + chrome) has a `done` or `blocked` row, OR
- `apps/parity/STOP-windows-loop` exists, OR
- 5 consecutive units `blocked` (print why, stop).

## Honesty covenant
`done` requires green gates AND `coveredCount==requiredCount` AND `visualScore>=95` AND zero
missing/extra components, with a real `shotPath` on disk. An empty ledger is NOT "completed".
A gate that cannot run on this host is `blocked`, never `done`.

BEGIN LOOPING NOW — start with `component:shell/Sidebar`.
