# Bauhaus visual review

## Round 1

Inspected all six default-scale viewport images: dashboard, drives, and energy
at 390px and desktop. The runner exited **1**: desktop drives and energy
passed; the other four captures failed diagnostics, despite producing images.

Five priority findings and responses:

1. The bottom-navigation buttons computed to 11px text and the selected pill
   retained rounded corners, inconsistent with the Bauhaus grid. The phone
   text floor passed in round 2. A more-specific square-corner correction was
   made after round 2 because the shared shell rule had won the earlier
   cascade; it has not received another screenshot.
2. The 390px drive and energy briefs stacked every metric into one tall
   column. Reduced the responsive minimum to 9rem, allowing two columns where
   space and the saved font scale permit.
3. Compact drive and energy headers put a short title and its command rail on
   separate rows, wasting the first viewport. Round 2 put the energy command
   alongside its title but squeezed “Drive history” onto two lines. A
   post-capture correction gives the title a larger non-shrinking basis so
   commands wrap below when necessary; no further screenshot was taken.
4. The dashboard layout name was truncated on both viewport sizes. Allow that
   specific menu label to wrap within the available width instead of cutting
   off the selected name.
5. Dashboard widget text and protected Digital Twin controls fail the phone
   accessibility thresholds. Their owners are outside this stylesheet's
   permitted scope; requested shared fixes rather than changing widget
   internals or the protected Twin.

The phone dashboard reported the protected Twin's 36×36px Open control and
10×28px refresh control, plus smaller-than-16px text in the Twin and widget
content. Each phone page also reported the navigation buttons' 11px inherited
font size. The desktop dashboard failed because `/api/v1/pinned` was still
pending in the capture fixture; its contrast audit did not complete.

Axe reported no contrast violations on the other five captures, but it marked
one drives-phone node, four drives-desktop nodes, and eighteen energy-desktop
nodes for manual review. These include an obscured navigation label and chart
axis/legend text that cannot all be assessed from the available viewport
images. They remain unresolved, not passes.

## Round 2

Inspected all six viewport images again. The runner exited **1**: five tests
passed and phone dashboard failed. The remaining dashboard diagnostics were
the two undersized protected Twin controls and seven pieces of widget/Twin
text below 16px; the navigation-text findings no longer appeared. The
round-one desktop dashboard `/api/v1/pinned` fixture failure did not recur.

Axe reported zero violations on all six, with respectively 0, 1, and 0
manual-review nodes for dashboard, drives, and energy on phone; desktop had
1, 4, and 18. The overlapping navigation label and chart labels remain
unresolved manual reviews, not confirmed passes.

After inspecting round 2, the stylesheet received the header and navigation
corrections described above, explicit exclusions for widget-owned internals,
and removal of inherited global panel-token overrides that could otherwise
affect the protected Twins. The saved round-2 images therefore precede those
last changes. No third screenshot round was taken.

Screenshot-free checks after the corrections included six Bauhaus native
composition/step tests and a synthetic 36-combination phone-geometry,
forced-colors and widget-boundary probe; all passed. A separate synthetic
protected-panel probe found unchanged dimensions, radius, shadow and image
source, and a CSS contract check found no unowned selectors, unreset app
tokens, missing forced-colors gates, literal colors, or global panel-token
overrides. An attempted real-app DOM-only verification did not run: its
in-memory fixture bundle failed on CSS imports. Consequently, the final
post-capture corrections and actual Twin geometry remain unverified in a live
app capture.

Standalone DataTable frame contract:

```text
> npx vitest run src\components\ui\DataTable.appDesign.test.tsx --testNamePattern='bauhaus binds only the painted frame' --reporter=dot --maxWorkers=1
Test Files  1 passed (1)
     Tests  1 passed | 34 skipped (35)
```

The orchestrator updated the isolation test to check Bauhaus's scoped
`--app-card-radius` while retaining the ordinary panel radius. The resulting
bridge test passed:

```text
Test Files  1 passed (1)
     Tests  13 passed (13)
```

An isolated snapshot containing the finished Bauhaus stylesheet and that test
passed `npm run build`; the stylesheet hash matched the working tree:

```text
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
BAUHAUS_SNAPSHOT_BUILD=PASS
BAUHAUS_HASH_MATCH=True
```

## Phone metric follow-up

Recent drives context measured 11.9px at scale 0.85 and 14px at scale 1.
The owned ordinary headline context and units now use the phone body token;
protected and specialized surfaces remain excluded. See `DECISIONS.md` for
the screenshot-free regression results and remaining limitations.
