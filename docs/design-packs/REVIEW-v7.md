# Pixel Cockpit (`v7`) review

**Status: passed-with-notes for the bounded review, not visual acceptance.**
Both permitted capture invocations
were spent. The first could not connect; the second produced six images but
failed the phone checks and inadvertently used the default Chrome channel
without enabling the requested contrast audit. No third round was taken.

## Captures

- Round 1: the requested dashboard/drives/energy matrix failed at preflight
  with `fetch failed` (exit 1); no images were produced. The shared server
  was subsequently recovered by the coordinator.
- Round 2: `node scripts\capture-design-packs.mjs --pack v7 --pages dashboard,drives,energy --viewports phone-390,desktop --base-url http://127.0.0.1:54872`
  exited 1: all three phone cases failed; all three desktop cases passed
  their enabled checks. I omitted the three required environment assignments
  in this fresh shell: the runner therefore used Chrome rather than Edge,
  default font scale 1 without the `-scale-1` filename suffix, and **did not
  run the contrast audit**. This is not a valid complete requested review.

Inspected all six available images: `shots/v7/phone-390/dashboard.png`,
`drives.png`, `energy.png`; and `shots/v7/desktop/dashboard.png`,
`drives.png`, `energy.png`. These images precede the fixes below.

## Findings and changes

1. **Phone navigation clipping:** at 390px the Charging and More labels
   extended 4px below their buttons. Excluded the bottom bar from the pack's
   generic navigation gap/padding so the shared safe-area geometry owns it.
2. **Phone control typography:** the audit reported the navigation buttons'
   computed font as 11px, even though their label spans were 16px. Set the
   parent controls to the shared, preference-scaled body-size token.
3. **Phone heading hierarchy:** “Drive history” wrapped beside its actions
   despite needing more horizontal space. Added a font-scale-aware minimum
   title width so actions wrap before squeezing the heading.
4. **Desktop Energy alignment:** the operational brief appeared indented by
   an empty workbench column because its surface has no direct section header.
   Kept that brief block-level and removed its redundant outer separator.
5. **Pixel signature:** the stepped heading marks were easy to miss in the
   desktop view. Enlarged the token-colored steps without changing text,
   chart paint, saved fonts, or widget artwork.

These are post-capture CSS changes. A screenshot-free isolated browser fixture
confirmed 16px nav-button fonts and no clipped tab labels at 360, 390, and
430px, and block layout for the desktop brief. It is not a full application
recapture and does not prove the final visual result.

## Remaining issues and checks

- Dashboard phone diagnostics also found a 36×36 “Open” link, a 10×28
  refresh control, and 12–14px text in the protected Digital Twin/widget
  area. Shared owner action is requested in `requests/v7.md`; the protected
  subtree was not restyled.
- No contrast result is available. Light mode, forced colors, full-app 360
  and 430px, larger saved fonts, keyboard focus, and open Helix/interaction
  states were not visually verified.
- After the structural fixes, `npx vitest run
  src\components\ui\app-designs\designs.test.ts
  src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx
  -t 'v7'` passed: 5 passed, 136 skipped. `npx tsc --noEmit` exited 0.
  `git diff --check` exited 0. Scoped `audit_code` reported no violations.
  The final three-pixel decoration adjustment was made after these tests;
  it does not change selectors or component structure.
- No build or API-hook change was made, per the bounded assignment.

## Coordinator build

The coordinator ran `npm run build` in an isolated checkout of the committed
shared foundation with the completed Classic, v1, v2, v5, v6 and v7
stylesheets. It exited 0:

```text
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
```

The build does not replace the missing contrast audit or verify the final
post-capture changes visually.
