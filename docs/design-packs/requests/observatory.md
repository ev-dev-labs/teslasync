# Observatory shared follow-up

## Protected Digital Twin phone accessibility

The 390px, scale-1 synthetic dashboard contains protected Digital Twin
widgets. A screenshot-free scan of the real review fixtures found an **Open**
link at 36 × 36px and an enabled **Refresh data** control at 10 × 28px.
It also found “Digital twin”, “—”, and “Aurora” text at 14px. These are below
the review's 44px touch-target and 16px body-text requirements.

The preserve boundary is installed in
`web\src\features\dashboard\components\DashboardGrid.tsx`; the widget
implementations are `DigitalTwinWidget.tsx` and `DigitalTwinMiniWidget.tsx`.
The edge-aligned refresh control is implemented in
`web\src\components\data-display\FreshnessDot.tsx`. Their owners should
resolve the phone interaction and text sizing without changing vehicle imagery,
data, or behavior, and rerun the real dashboard touch/text diagnostics.
Observatory cannot safely override this protected subtree.

## Forced-colors energy table on phones

In the real synthetic `/energy` fixture at 390px, scale 1, with forced
colors active, the “Charger type breakdown — data table” fallback has a
312px viewport and 412px scroll width. Its six columns produce a horizontal
scroll region even though the document itself does not overflow. Please
provide a shared responsive presentation that keeps its caption, headings,
values, and table semantics intact; the pack must not rewrite the generic
data-grid contract.

Orchestrator follow-up: chart fallback tables now use the existing stacked
mobile table pattern with localized cell labels. A real Observatory
`/energy` fixture passed the six-column table checks at 360, 390 and 430px
in forced colors; see `DECISIONS.md`. Other routes remain unverified.

## Capture-harness follow-up

The first phone-dashboard capture stopped at
`design-packs-capture.spec.ts:827` with “Main content could not be scrolled
for capture”. A later screenshot-free scan and the second capture traversed
the dashboard, so the cause is unconfirmed rather than a demonstrated CSS fix.

The second desktop-drives capture stopped before contrast analysis:
`assertMockApiComplete` timed out after 5 seconds with one same-origin
`GET /api/v1/pinned` request still recorded as `pending`. The first
desktop-drives capture passed. A later screenshot-free 1280px drives fixture
probe reproduced the same pending request; another 1440px probe completed
without it. Please investigate request accounting and intermittent
scroll/settling behavior in the shared fixture and capture runner; do not
weaken the no-escape assertion or assume an actual external request.
