# Design pack decisions

## Parallel review capture

The shared preview/dev server is owned by the orchestrator. The pack capture
runner accepts a pack, page list and viewport-project list and requires an
already-running local server; its Playwright configuration never starts one.
For pack reviews it saves one viewport image per page and project, scans the
scrolling content without saving extra frames, and keeps each pack's test
artifacts separate. Existing stitched images are historical evidence. The
two-round limit applies to subsequent per-pack reviews, not past captures.
Viewport-only reviews save the settled initial view before detailed assertions,
so a failing geometry check can still be inspected. A saved image is not a
pass; the capture command's complete diagnostics remain authoritative. Use
the explicit default font scale suffix for new spot checks to keep historical
viewport and stitched images intact.
Begin with eight isolated pack workers and refill each slot as it finishes.
This keeps browser and build load bounded on the shared machine while the
full unit suite is running; it is not an eight-pack completion gate.
Four additional workers may implement their owned stylesheets while the
browser slots are occupied; they must wait for an explicit capture release.
The initial Vite process watched Playwright trace files, reloaded active
reviews and exited with `EBUSY` on a locked `.network` trace. The orchestrator
restarted the same local origin with the transient capture-artifact directory
excluded from its watcher and confirmed HTTP 200. An interrupted invocation
still counts toward the affected pack's two-round cap; its missing or failed
evidence must be reported, not silently replaced.
Capture invocations now use a unique temporary Playwright output directory
outside the Vite root and remove that directory after completion; the
requested review images remain under `shots`. Direct use of the capture
configuration also defaults outside the Vite root. Workers restricted to
project-local scratch can set `DESIGN_PACK_CAPTURE_OUTPUT_ROOT` to their own
existing pack shots directory; the runner creates and removes only its unique
child. Roots inside `web` are rejected. The focused runner tests reported:

```text
tests 4
pass 4
fail 0
```

The first eight dashboard captures were compared side by side without taking
new screenshots. Horizon Loft looked too close to Classic and Concierge, and
Precision Ledger too close to Studio. Their owners were sent back for
pack-only, screenshot-free differentiation; the existing images predate
those refinements and are not proof that the distinction is resolved.
Precision Ledger and Executive Concierge exceeded the 45-minute slot. Both
were asked to stop and reported their incomplete evidence; this runtime did
not expose an agent-kill operation. No concurrent replacement was allowed to
edit either owned stylesheet while its worker was still active. Concierge's
single retry is screenshot-free because both capture invocations were spent;
the original Ledger owner is doing the distinctness follow-up.

The real phone bar was clipped when the lazy-loaded `sidenav.css` applied its
60px minimum after the app-design styles. The shared mobile layer now
overrides that minimum with the existing 44px touch token and controls the
shell's competing padding and gap. A screenshot-free regression loads the
real styles in that order and checks all 27 profiles at 360/390/430px, with
additional 400/401px, density, scale and safe-inset combinations for Classic
and Studio, in normal and forced colors. It checks bounds, overlap, whole
labels and status-bar reservation:

```text
2 passed (1.2m)
```

Headerless workbench sections no longer reserve an empty heading column; the
same browser run checks both headed and headerless sections. A separate
follow-up checks the equivalent hidden-heading case and reported:

```text
1 passed (1.8m)
```

The related navigation and design unit tests reported:

```text
Test Files  3 passed (3)
     Tests  72 passed (72)
```

These are synthetic contracts, not full-route or cross-browser acceptance.
The capture runner's invalid-pack test exited 1 as expected and left zero
new temporary output directories; its e2e TypeScript and focused ESLint
checks exited 0.

## Identity and existing preferences

Keep all 27 persisted IDs, names and aliases. The existing verified,
server-scoped preference remains authoritative: do not introduce a browser
cache that can apply another identity's choice. Pack presentation must compose
with the saved mode, accent, fonts, density and accessibility preferences
rather than overwrite them. Keep the existing Card, GlassPanel, DataTable and
ChartContainer APIs and owner isolation; add presentation roles at their
existing token boundary where necessary.

The existing chart palette preference owns actual series colors, including
colorblind-safe and neon choices; replacing it per pack would violate the
design contract and the instruction to preserve behavior. Pack roles therefore
style chart framing, grid and label ink while the existing palette hook keeps
series identities. This constraint is not proof of distinct per-pack palettes.
The shared phone layer extends the existing opted-in mobile grid and heatmap
patterns; it does not guess table identities, fields or privacy masks for
tables lacking a mobile presentation.

Pack sheets can compose four app-surface roles from the saved theme, alongside
the shared card, control, grid, chart, conversation, spacing and motion
roles. They must leave semantic surfaces, chart series and saved font settings
with their existing owners. This is a token boundary for pack work, not a
claim that every existing component or chart palette has been redesigned.

The first preview-isolation regression run exposed four Classic phone tokens
that were inherited by nested previews. Reset those tokens at the existing
preview boundary before dispatching pack work. The targeted preservation run
then reported:

```text
Test Files  4 passed (4)
     Tests  205 passed (205)
```

The latest browser contracts, including 27 synthetic profiles at
360/390/430px and normal/forced colors, reported:

```text
6 passed (15.5s)
```

These are component-level contracts, not rendered-route or contrast passes.

After the shared CSS changes, `cd web; npm run build` in the isolated
verification checkout exited 0:

```text
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
```

The changed `app-designs` audit reported zero static inline styles, raw HTML,
direct library imports, old API imports, double prefixes and camelCase query
parameters; its TypeScript check passed. The hook verifier found 571 URL
patterns and reported `ALL EXTRACTED HOOK PATHS MATCH REGISTERED ROUTES`.
The capture change also passed `npx tsc --noEmit -p e2e\tsconfig.json` and
focused ESLint. The full Vitest run started before the last CSS reset, so it
does not independently verify the exact final source.

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

On narrow phones, Classic's bottom navigation uses two rows of whole labels
rather than splitting words or clipping them. Its reserved shell height
includes the saved text scale and bottom safe area; the status bar sits above
it. This trades content space for legible, thumb-reachable controls and does
not change the saved typography preference. The tradeoff remains a visual
defect to revisit as part of the full Classic review.

Classic's operational metric columns use a pack-owned minimum width that
scales with the saved font preference, falling back to one column rather
than breaking words inside narrow labels. The mobile workspace range trigger
shares the available width with vehicle selection and may grow vertically
for long or compared range labels. Its input keeps enough space for enlarged
action targets and the leading icon; both controls retain their existing
selection behavior. The 360/390/430px Energy captures exercise these controls
in both modes at 1.35 scale, including comparison and custom-range changes.
Longer vehicle names can still be truncated and need further review.

Use the existing mobile data-grid presentation for Energy's recent sessions:
retain the desktop columns, session-detail destination and data, and expose
all seven fields in Quick View. Classic's phone text floor applies to the
actual grid text classes as well as detail labels and values. Keep the compact
status bar's secondary status metadata separate from page body-link checks;
its links still participate in the touch-target and contrast diagnostics.
For Help, use the existing page and panel boundaries to compact the desktop
hero and enlarge contextual links without changing its source-locked markup.
The support-bundle JSON may wrap on phones without changing the copied text.
For a single charger category, Energy uses the existing 300px mobile chart
height instead of overriding the chart viewport's containment contract;
multiple categories retain the existing 420px height.

## Visual evidence

Use isolated synthetic API fixtures and block external requests for screenshot
reviews. The capture matrix uses 390 x 844, 768 x 1024 and 1440 x 900, plus
360 x 800 and 430 x 932 for the requested phone-width extremes. Include
production routes and known detail fixtures; missing fixtures, runtime errors,
overflow and incomplete captures are failures, not visual passes. Do not mark
a pack passed until its screenshots have been inspected and all requested
gates have actually run.

The API-hook verifier's route lookup used `grep -q` behind a pipe with
`pipefail`, occasionally treating a successful match as a failure when the
producer received SIGPIPE. A large-route-table regression reproduces the old
failure; feeding the matcher without that pipeline preserves genuine missing
route failures. No application endpoint or hook behavior was changed.

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
`DESIGN_PACK_CAPTURE_OUTPUT_DIR` to a unique task-owned directory when
invoking the capture configuration directly, and pass a unique `--output`
directory to other Playwright commands in a shared workspace. The bounded
capture script now creates its own isolated temporary directory.

`DESIGN_PACK_CHECK_TOUCH=1` additionally fails a phone capture when a visible
interactive target is smaller than 44 x 44 CSS pixels. This is a diagnostic
for rendered states, not proof for unopened menus, off-screen overlays or
assistive technology. `DESIGN_PACK_CHECK_CONTRAST=1` runs Axe's contrast rule
and reports incomplete checks separately; incomplete findings require manual
review and are not passes.
`DESIGN_PACK_CHECK_TEXT_SIZE=1` checks visible unclassified paragraphs, explicit
body roles, feedback copy and history-row primary, route and inline metric
text, page links, mobile-grid text, operational metric labels, and Quick View
details against the 16px phone minimum. Explicit captions and other metric
labels are treated as metadata. It is a diagnostic, not proof for all
unclassified text, nested styles or unopened states.

At 360px, a lazy Battery chart's skeleton sat below the clipped main scrollport
but inside the browser viewport. The readiness check incorrectly waited for
that hidden skeleton. It now intersects activity with clipping ancestors; a
browser contract verifies that fully clipped loading is ignored and partially
visible loading must finish. The dark and light Battery recaptures then passed.

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
