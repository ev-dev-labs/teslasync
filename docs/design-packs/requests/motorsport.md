# Motorsport shared accessibility requests

The Edge 390 × 844 dashboard capture with Motorsport and font scale 1 reports
these defects outside the pack's ownership:

- The preserved Digital Twin's **Open** link is 36 × 36px and its
  **Refresh data** button is 10 × 28px. Its “Digital twin”, placeholder, and
  vehicle-name text is 14px. Find a compatible token-only way to achieve
  44 × 44px targets and 16px phone body text while preserving the protected
  twin's geometry, content, behavior, and vehicle imagery. If those
  requirements conflict, escalate the tradeoff rather than weakening checks.
  The boundary removes app-design ownership, so a pack selector cannot fix it.
- Shared bottom-tab labels render at 16px, but their button wrappers still
  compute to 11px from `sidenav.css`; the body-text diagnostic flags each
  wrapper. Align the shared wrapper's font size with the existing responsive
  label token without changing the validated two-row geometry or safe area.
  Motorsport applies that alignment locally; the other packs still need the
  shared correction.
- Shared mobile sizing omits some unprotected widget headline context,
  metric-unit text, and footer links. The dashboard scan found the Recent
  Drives timestamp at 14px and “All drives”, “Open vehicle”, and `km` at
  12px. Motorsport supplies scoped fallbacks. The final capture still found
  `km` at 12px; a later screenshot-free real-route diagnostic measured 16px
  after a specificity refinement. Consider a shared, owner-aware fix that
  leaves protected/native gauges untouched.

The first round also produced incomplete Axe contrast checks on the phone
Drives page and all three desktop pages, involving overlapping navigation
labels, a drive-row label, and chart-axis text. These require manual contrast
assessment rather than being counted as passes.
