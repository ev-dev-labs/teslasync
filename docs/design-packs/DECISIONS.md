# Design pack decisions

## Identity and existing preferences

Keep all 27 persisted IDs, names and aliases. The existing verified,
server-scoped preference remains authoritative: do not introduce a browser
cache that can apply another identity's choice. Pack presentation must compose
with the saved mode, accent, fonts, density and accessibility preferences
rather than overwrite them. Keep the existing Card, GlassPanel, DataTable and
ChartContainer APIs and owner isolation; add presentation roles at their
existing token boundary where necessary.

Use restrained, accessible depth and outlines rather than decorative colored
glows. The design contract requires semantic colors, focus visibility, reduced
motion and forced-color support regardless of the pack.

On phones, enforce a 16px minimum for Classic's body-role and brief prose even
when the saved font scale is below 1. Larger saved scales still apply, and the
saved preference is not changed. App-owned widget prose follows the same
floor; protected Digital Twin subtrees remain unchanged and need separate
resolution.
Use the same floor for page-owned field labels, field values and labeled
buttons to keep forms legible and avoid undersized mobile input text. The
browser contract checks the floor and protected-widget exclusion at the saved
scale extremes; production-route coverage is still in progress.
Apply the phone sizing and layout rules in forced-colors mode too, while
leaving system color and control-border treatment intact. A browser contract
checks the 16px floor at the smallest saved scale; full-page forced-colors
and fallback-table review are still required.

The shared WidgetShell is pinned by exact-source contracts. Its footer can be
identified as the sibling of the existing `widget-body` boundary, so use that
existing boundary instead of adding a new attribute to the pinned source.
The preliminary full Vitest run was stopped after reporting four failures
caused by that attribute; it did not finish and is not a passing full run.
The two affected source-contract files were rerun after restoring the pinned
source:

```text
Test Files  2 passed (2)
     Tests  776 passed (776)
```

The browser contract for the existing footer boundary also passed:

```text
1 passed (1.3s)
```

Preserve the exact-source i18n contracts on `Text`, `Tooltip`, `FreshnessDot`
and `ChartContainer`. Classic identifies existing body roles through their
canonical classes rather than changing `Text`'s markup. Enlarge actionable
page and app-owned widget freshness targets through owner-scoped CSS, including
their busy state; leave read-only and protected-widget indicators unchanged.
For app-owned local tooltips only, remove an
opacity-hidden or Escape-dismissed bubble from scroll layout; restore its
original positioning while active. This does not change the trigger, portal
or focus behavior. Body-class matching is a scoped diagnostic, not proof
that every kind of body copy has been identified.

For the weekly chart's forced-colors table, localize the mobile field labels
on the existing page section and inherit them into generated labels. This
preserves the shared chart's exact source and its native accessible table.
The normal data-table alternatives continue using their existing localized
cell attributes. Chrome checks cell names and labels; cross-browser behavior
remains unverified.

## Visual evidence

Use isolated synthetic API fixtures and block external requests for screenshot
reviews. The capture matrix uses 390 x 844, 768 x 1024 and 1440 x 900, plus
360 x 800 and 430 x 932 for the requested phone-width extremes. Include
production routes and known detail fixtures; missing fixtures, runtime errors,
overflow and incomplete captures are failures, not visual passes. Do not mark
a pack passed until its screenshots have been inspected and all requested
gates have actually run.

The application scrolls its `main` element rather than the document, so a
normal Playwright full-page screenshot only captures the first screen. Save
that unaltered screen as `<page>.png` and, when there is more content, save
`<page>--full.png` as a vertical sequence of actual viewport captures while
scrolling the main region. Repeated navigation and chrome in that sequence are
intentional; they do not represent a single continuous screen. Each attempt
clears that page's previous viewport and full images; a normal capture leaves
its separate interactive-table image intact. State captures clear the old
table image before attempting to replace it. New images are written only after its
mock API, browser error and overflow assertions pass, even when the subsequent
touch or prose diagnostics fail. Those images are defect evidence, not passes.
The cleanup contract and a real Charging recapture verified that an existing
table image survives an ordinary run:

```text
2 passed (683ms)
1 passed (19.7s)
Interactive table unchanged: True
```

Composite or file-write
failures remove both outputs rather than leaving a partial page. Capture test
artifacts use a port-specific directory separate from the ordinary Playwright
output: an overlapping harness run removed two active trace files in the
390px probe, so those two results must be rerun. Set
`DESIGN_PACK_CAPTURE_OUTPUT_DIR` to a unique task-owned directory for each
concurrent run, and pass a unique `--output` directory to other Playwright
commands in a shared workspace.

`DESIGN_PACK_CHECK_TOUCH=1` additionally fails a phone capture when a visible
interactive target is smaller than 44 x 44 CSS pixels. This is a diagnostic
for rendered states, not proof for unopened menus, off-screen overlays or
assistive technology. `DESIGN_PACK_CHECK_CONTRAST=1` runs Axe's contrast rule
and reports incomplete checks separately; incomplete findings require manual
review and are not passes.
`DESIGN_PACK_CHECK_TEXT_SIZE=1` checks visible unclassified paragraphs, explicit
body roles, feedback copy and history-row primary, route and inline metric
text against the 16px phone minimum. Explicit captions and metric labels are
treated as metadata. It is a diagnostic, not proof for unclassified text,
nested styles or unopened states.

For the interactive Charging Patterns heatmap, keep every weekday/hour slot,
the existing roving keyboard order, detail popover and data table. On phones,
wrap each day into six-hour rows with 44px targets instead of horizontally
scrolling a 24-column chart. On coarse-pointer tablets, choose balanced
six-, eight-, twelve- or twenty-four-hour rows from the plot's available
width and stack the native data table. The chart viewport follows its
content's height on touch devices; fine-pointer desktop sizing is preserved.
The 768px touch-tablet dark/light production captures passed geometry,
keyboard, open-table and overflow checks, with 20 incomplete Axe nodes per
mode. A forced-colors tablet capture found 12px fallback captions and
headers; the responsive rule was extended and the production recapture
passed in both modes. One Axe node per forced-colors capture still requires
manual review. Incomplete Axe findings are not contrast passes.

The current capture excludes `/connect`, `/glance`, `/onboarding`, `/s/:token`,
`/watch` and `/year-review/:year`: those standalone routes do not all use the
authenticated shell or its verified design bridge. Their coverage and
identity-safe theming remain unresolved and block a full-app pass.

### Temporarily skipped: period comparison capture

The initial 390px probe, a targeted phone/desktop retry, and an isolated
desktop diagnostic all failed to settle `/period-compare`. The browser trace
recorded 250 successful `/api/v1/settings` reads in about 10 seconds, with
repeated query-observer subscriptions. Do not mask the churn or change API
behavior as part of this visual-only work. Skip this route temporarily and
revisit it at the final gate; it has no passing screenshot evidence.

## Protected surfaces

Keep the Digital Twin and Digital Twin Mini layouts and existing Tesla vehicle
images. Pack changes may affect their existing presentation tokens, not their
data, geometry, interactions or image assets.

The dashboard marks the full panel of each protected twin as an application
composition boundary, including the fullscreen panel. The design-scope
observer removes app-owned selector markers inside that boundary, including
on inserted or reparented content, while inherited theme and widget-pack
tokens remain available. Other widgets and app previews retain their existing
ownership. Phone target sizes inside these protected widgets still require
separate verification; preserving geometry alone is not a mobile pass.
The before/after comparison records each widget at its actual viewport width.
Because the surrounding desktop shell can change the grid's available width,
it then measures both widget compositions at the same width; the captured
images remain the unaltered, naturally sized widgets.

### Temporarily skipped: protected widget phone targets and text

The original 390px diagnostic, an instrumented retry, and a rebuilt
refinement still leave the protected twins' 36 x 36 Open control, 10 x 28
refresh control and 14.1px text below the requested phone minima. The
non-protected dashboard targets and prose in the observed fixture improved,
but the protected-subtree boundary deliberately prevents their rules from
altering the twins. Do not waive these findings or change the preserved
design without a compatible token-only solution. Revisit at the final gate;
Classic remains in progress.
