---
description: "Frontend gold-standard rewrite — Migrate MapLayerSwitcher off react-leaflet"
---

# Rewrite components/maps/MapLayerSwitcher.tsx off react-leaflet onto MapLibre GL

### Your role: Implementer (a SEPARATE independent process reviews your work)

Do the migration work described below completely. No partial coverage, no
"simplified" version, no deferring part of this unit to "a follow-up". You
will NOT be the one approving this work — after the gate passes, a fresh,
independent `copilot` process with no memory of your reasoning reviews the
diff and can reject it. Write it as if a skeptical staff reviewer who has
never seen your intentions is about to judge it against:
  1. **Mobile-friendly** — touch targets ≥44px, responsive at 375px width, no
     hover-only affordances, gestures work (swipe/pinch where relevant).
  2. **Best UI on the internet** — matches the polish bar of Linear/Vercel/Stripe:
     correct focus states, smooth motion, no layout shift, no jank.
  3. **Long-term support** — no experimental/unmaintained deps, no version pins
     that fight peer deps, no APIs marked deprecated in current docs.
  4. **True gold standard, no partial** — every branch/state/variant of the
     original is preserved (loading/error/empty), nothing silently dropped.
Self-review against this list before running the gate, but do not treat
your own approval as sufficient — the independent reviewer has veto power.

### Non-negotiable ground rules
- **No partial work.** Every file/component in this unit's scope must be fully
  migrated — not "the common case" or "the main path". If something is hard,
  do the hard part; do not silently narrow scope.
- Preserve the **existing external prop API** of shared components so the 268+
  call-sites across 20 feature domains do not need to change.
- Preserve **every** `t('key','default')` i18n call verbatim. Zero hardcoded
  user-facing strings.
- Preserve **loading / error / empty** states exactly as they exist today.
- **Null safety**: `value ?? 0`, `label ?? '—'`, `items ?? []` — never call
  `.map`/`.filter`/`.length` on possibly-undefined data.
- **No `any`** (mark unavoidable casts `// ok-any` + reason). No
  `dangerouslySetInnerHTML`. No TODO/FIXME/placeholder/stub/"Coming soon" as
  final output.
- Touch ONLY the files this unit names. Read anything else in `web/src/**`
  freely for context.

## Task
Reimplement `web/src/components/maps/MapLayerSwitcher.tsx` (UI control to switch map styles/layers) using **MapLibre GL JS** (via
`react-map-gl` with the maplibre adapter, or `maplibre-gl` directly),
replacing react-leaflet/leaflet. Requirements:
- Also port whichever of these plugin behaviors this component relies on:
  marker clustering (leaflet.markercluster → MapLibre GL
  `cluster`/`cluster-count` layers), heatmap (leaflet.heat → MapLibre
  `heatmap` layer type), draw tools (leaflet-draw → `@mapbox/mapbox-gl-draw`
  built against the MapLibre GL instance).
- **External prop API must not change** — consuming pages (verified in
  `p6-maps-pages`) keep working with zero edits.
- **Mobile**: native pinch-zoom/pan/rotate gestures must work — this is a
  primary reason for choosing WebGL vector tiles, verify it actually works
  in a touch-emulated browser context, don't assume.
- Match current visual design (marker icons, colors, popups/tooltips).

## Gate (run exactly)

```bash
cd web
bash scripts/frontend-gate.sh 'src/components/maps/MapLayerSwitcher.tsx' 'src/components/maps/index.ts'
echo "GATE_EXIT=$?"
```

- `GATE=FAIL` ⇒ fix and re-run. If truly blocked by a missing sibling this
  unit depends on, print `EXIT=1` / `STATUS=BLOCKED` naming the missing
  module — the driver re-runs pending units after siblings land.
- `GATE=PASS` ⇒ proceed to the Independent Review below. Do NOT commit yet.

## Independent Review (REQUIRED — do not skip, do not self-approve)

Spawn a FRESH, separate `copilot` process to review your diff. It must have
ZERO memory of your implementation reasoning — this is a genuinely
independent check, not you re-reading your own work:

```bash
cd web
git diff --stat > /tmp/review-stat-$$.txt
git diff > /tmp/review-diff-$$.txt
{
  echo "You are an independent staff reviewer with NO context on why this";
  echo "change was made beyond what follows. Read the diff below. Reject if";
  echo "ANY of these hold: (1) not mobile-friendly (missing touch targets,";
  echo "hover-only affordances), (2) below Linear/Vercel/Stripe-grade polish";
  echo "(missing focus states, layout shift, jank), (3) uses an";
  echo "experimental/deprecated dependency or pattern, (4) drops ANY branch,";
  echo "state, i18n key, or null-safety guard the diff removes without an";
  echo "equivalent replacement, (5) the external prop API of any shared";
  echo "component changed. Respond with EXACTLY one line: either";
  echo "REVIEW=APPROVE or REVIEW=REJECT: <specific reasons>. Nothing else.";
  echo "";
  cat /tmp/review-stat-$$.txt;
  echo "";
  cat /tmp/review-diff-$$.txt;
} | copilot --yolo --autopilot -s > /tmp/review-result-$$.txt 2>&1
tail -5 /tmp/review-result-$$.txt
grep -o "REVIEW=APPROVE\|REVIEW=REJECT" /tmp/review-result-$$.txt | tail -1
```

- `REVIEW=REJECT` ⇒ read the stated reasons, fix them, re-run BOTH the gate
  and this independent review again. Never commit rejected work.
- `REVIEW=APPROVE` ⇒ proceed to Commit below.

## Commit (only after GATE=PASS AND REVIEW=APPROVE)

```bash
git add web/src/components/maps/MapLayerSwitcher.tsx web/src/components/maps/index.ts
git commit -m "refactor(web): migrate MapLayerSwitcher off react-leaflet to MapLibre GL

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```