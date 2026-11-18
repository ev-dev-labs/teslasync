# Navigation orientation audit

The descriptor is from `web/src/components/ui/app-designs/designs.ts`. `Layout`
renders a top bar only for `top`; the other descriptors all have a vertical
primary rail. “Before” is the branch at `7dce757c03`. On `origin/main`
(`0ffaede408`), the six top packs used the old column strip instead; the
reported Driving clipping was in that strip, not the branch's two-pane flyout.

| Pack | Descriptor / primary | Before: secondary and finding | After: desktop secondary |
|---|---|---|---|
| classic | rail / vertical | Atlas side panel; rail overflow measured | Atlas side panel |
| v1 | rail / vertical | Atlas side panel; long rail scrolls | Atlas side panel |
| v2 | sidebar / vertical | Atlas side panel; long rail scrolls | Atlas side panel |
| v3 | rail / vertical | Atlas side panel; long rail scrolls | Atlas side panel |
| v4 | sidebar / vertical | Atlas side panel; long rail scrolls | Atlas side panel |
| v5 | hybrid / vertical | Docked horizontal group strip; mismatch, height capped | Atlas side panel |
| v6 (Expressive Form) | top / horizontal | Two-pane flyout; matched on branch | Two-pane flyout |
| v7 | rail / vertical | Atlas side panel; long rail scrolls | Atlas side panel |
| motorsport | hybrid / vertical | Docked horizontal group strip; mismatch, height capped | Atlas side panel |
| blueprint | sidebar / vertical | Atlas side panel; long rail scrolls | Atlas side panel |
| editorial | top / horizontal | Two-pane flyout; matched on branch | Two-pane flyout |
| ambient | sidebar / vertical | Atlas side panel; long rail scrolls | Atlas side panel |
| terminal | rail / vertical | Atlas side panel; long rail scrolls | Atlas side panel |
| atlas | hybrid / vertical | Docked horizontal group strip; mismatch, height capped | Atlas side panel |
| analog | sidebar / vertical | Atlas side panel; long rail scrolls | Atlas side panel |
| observatory | rail / vertical | Atlas side panel; long rail scrolls | Atlas side panel |
| bauhaus | top / horizontal | Two-pane flyout; matched on branch | Two-pane flyout |
| quiet | rail / vertical | Atlas side panel; long rail scrolls | Atlas side panel |
| warm | sidebar / vertical | Atlas side panel; long rail scrolls | Atlas side panel |
| swiss | top / horizontal | Two-pane flyout; matched on branch | Two-pane flyout |
| material | hybrid / vertical | Docked horizontal group strip; mismatch, height capped | Atlas side panel |
| glass | sidebar / vertical | Atlas side panel; long rail scrolls | Atlas side panel |
| deco | top / horizontal | Two-pane flyout; matched on branch | Two-pane flyout |
| kinetic | hybrid / vertical | Docked horizontal group strip; mismatch, height capped | Atlas side panel |
| brutal | top / horizontal | Two-pane flyout; matched on branch | Two-pane flyout |
| cyber | rail / vertical | Atlas side panel; long rail scrolls | Atlas side panel |
| memphis | hybrid / vertical | Docked horizontal group strip; mismatch, height capped; rail overflow measured | Atlas side panel |

The hybrid mismatch was CSS-driven: the rail stayed vertical, but the docked
Atlas panel was capped at 10.5rem and its groups laid out horizontally.
At 1024px the same packs already used a vertical modal. The browser test in
`web/e2e/horizontal-nav.smoke.spec.ts` requires adjacent, fully contained
Driving panels and a non-scrolling rail at 1440×768 and 1024×768 for every pack.

Baseline screenshots used synthetic data on the unchanged local Docker build.
At 1440×768, Classic's rail had 1,338px of content in 487px; Memphis had
1,338px in 535px. Other baseline rows describe the shared source behavior,
not independent clipping measurements.

The production-build Edge run passed the 27-pack Driving orientation and
containment check at both desktop sizes. The six top-bar packs also passed
light and dark checks at 1440px, 1024px, and 390px, including the phone sheet's
pack-specific frame. The [before/after comparisons][review]
show Classic and Memphis (rails) and Expressive Form and Editorial (top bars).

[review]: https://github.com/ev-dev-labs/teslasync/pull/267#issuecomment-6970371615
