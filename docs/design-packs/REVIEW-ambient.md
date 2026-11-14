# Ambient design review

## Round 1 — interrupted

Command: `node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs ambient`

The run was interrupted before completion after discovering that the shared
runner places its Playwright output in the system temporary directory. There
is no completed exit status. Two images were available and inspected:

- `round-1/dashboard-phone-390.png`
- `round-1/drives-phone-390.png`

The energy phone image and all three desktop images were not captured in this
round. The dashboard contrast diagnostic reported zero violations but three
nodes requiring manual review; this is not a complete contrast pass.

### Findings and owned changes

1. **Drive hierarchy:** compact operational readings looked smaller than their
   labels. Increased their scale-aware minimum without changing semantic color.
2. **Drive spacing:** consecutive rows of metric islands touched vertically.
   Added a modest row gap at tablet and phone widths.
3. **Dashboard polish:** the active layout name was visibly truncated despite
   available space. Allow context-menu labels to wrap instead of truncating on
   phones.
4. **Dashboard typography:** the layout context label used a 12px treatment.
   Apply the shared phone body-size floor to these labels.
5. **Mobile composition:** the header used excessive vertical padding around
   wrapped actions on both pages. Reduced phone-only padding and gaps while
   retaining touch-target sizing.

The layout selector's accessible name still omits the selected layout; see
`requests\ambient.md`.

## Round 2 — completed with failures

The same wrapper was invoked once more with Edge, scale 1, and contrast enabled.
To keep capture output in the owned project directory, this invocation used a
process-local filesystem preload to redirect the runner's output directory; no
diagnostic was disabled. The wrapper exited **1**: **5 failed, 1 passed**.

All six images were inspected:

- `phone-390-scale-1\dashboard.png`, `drives.png`, `energy.png`
- `desktop-scale-1\dashboard.png`, `drives.png`, `energy.png`

The phone dashboard now shows the full wrapped layout name; phone drive
readings are larger and their rows are separated. Desktop still clipped that
name, so wrapping was subsequently extended to desktop. The three phone
captures reported the navigation buttons' computed 11px font; an Ambient-only
phone-size override was added afterwards. Dashboard also reported 12–14px
widget text; owned footer and metric text received phone-size overrides.
These post-capture refinements have **not** been recaptured.

### Remaining diagnostics

- Phone dashboard: two small targets (`Open` 36×36 and `Refresh data` 10×28)
  and small text, including protected Digital Twin content. Phone drives and
  energy also failed the navigation-button text-size check. The post-capture
  overrides do not establish that the real routes now pass.
- Desktop dashboard and drives failed with `/api/v1/pinned` still pending after
  the 5-second routing check. Their contrast diagnostics did not complete.
- Contrast reported zero violated rules but required manual review of 3 nodes
  on phone dashboard, 1 on phone drives and 13 on desktop energy. Phone energy
  reported zero violations and zero incomplete nodes. Desktop energy was the
  only passing capture test; its incomplete contrast findings are not a full
  contrast pass.
- No third capture was run. See `requests\ambient.md` for the shared and
  protected-widget follow-ups.

### Other checks

- `npx tsc --noEmit` from `web`: passed before the CSS-only post-capture edits.
- Ambient-focused Vitest preservation suite: **8 passed, 222 skipped** after
  the post-capture edits.
- Earlier all-pack preservation run: **211 passed, 2 failed** (the concurrently
  edited v5/v6 DataTable identities).
- The screenshot-free all-pack phone geometry contract passed before the
  post-capture edits. A subsequent contract and DOM check did not start because
  their PowerShell scratch-path setup failed (`Join-Path`: null path).
- Scoped engineering audit reported no violations. No build was run.

The orchestrator subsequently ran `npm run build` in the isolated verification
worktree with the final Ambient stylesheet: **exit 0**. Its SHA-256 matched the
working stylesheet. This does not resolve the capture, contrast or mobile
accessibility gaps above.
