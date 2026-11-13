# Shared follow-up requested by Neo Brutal review

- At 390 px the protected Digital Twin's **Open** link measured 36 × 36 px,
  and visible twin text included 14 px labels. Preserve its imagery and widget
  design while addressing the shared 44 px touch and 16 px text requirements;
  pack CSS intentionally cannot reach this preserved subtree.
- The dashboard capture's **Refresh data** control measured 10 × 28 px. Its
  `FreshnessDot.tsx` edge-aligned `!w-2.5` sizing is explicitly excluded by
  the shared `mobile.css` touch-target rule. Please reconcile its target with
  the 44 px contract without obscuring adjacent actions.
- The dashboard capture also reported other widget text below 16 px (including
  “Today …”, “All drives”, “km”, and “Open vehicle”). Review the shared widget
  presentations rather than changing their internals from a pack.
- All three desktop captures initially stopped before their contrast audits
  because `GET /api/v1/pinned` remained `pending` in the mock-routing
  completion check. Drives and energy passed on the second round, but the
  dashboard still failed on that request. Please investigate the shared
  capture fixture/routing lifecycle; the dashboard desktop contrast audit
  was not reached.
- The second Axe pass marked one phone drives node, four desktop drives nodes
  and 21 desktop energy chart/legend nodes as indeterminate. Their contrast
  still requires manual review; the viewport screenshots do not cover them.

Evidence: `docs\design-packs\shots\brutal\round-1.log`,
`docs\design-packs\shots\brutal\round-2.log`, and their corresponding images.
