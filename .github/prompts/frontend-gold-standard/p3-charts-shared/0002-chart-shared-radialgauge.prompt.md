---
description: "Frontend gold-standard rewrite — Migrate RadialGauge off recharts"
---

# Rewrite components/charts/RadialGauge.tsx off recharts onto visx

### Personas (both required — this is not optional)

**Persona 1 — Senior Frontend Engineer (implementer).** Do the migration work
described below completely. No partial coverage, no "simplified" version, no
deferring part of this unit to "a follow-up".

**Persona 2 — Staff UI/UX Reviewer (gold-standard bar).** Before committing,
switch hats and critique the Persona-1 output as a skeptical senior reviewer
whose job is literally to block anything that is not gold-standard. Check
explicitly against ALL FOUR program requirements:
  1. **Mobile-friendly** — touch targets ≥44px, responsive at 375px width, no
     hover-only affordances, gestures work (swipe/pinch where relevant).
  2. **Best UI on the internet** — matches the polish bar of Linear/Vercel/Stripe:
     correct focus states, smooth motion, no layout shift, no jank.
  3. **Long-term support** — no experimental/unmaintained deps, no version pins
     that fight peer deps, no APIs marked deprecated in current docs.
  4. **True gold standard, no partial** — every branch/state/variant of the
     original is preserved (loading/error/empty), nothing silently dropped.
If Persona 2 finds a gap, go back to Persona 1 and fix it BEFORE running the
gate. Do not commit anything Persona 2 would not personally approve.

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
Reimplement `web/src/components/charts/RadialGauge.tsx` (gauge/dial visualization (battery %, efficiency score, etc.)) using **visx (SVG/D3-based) — this component is lower-frequency/bespoke and benefits from visx's full styling control**, replacing its
current recharts-based internals. Requirements:
- **External prop API must not change** — every page consuming this
  component (verified in the later `p4-charts-pages` program) keeps
  working with zero edits to call-sites.
- Match current visual design: same color tokens (`CHART_COLORS`,
  `NEON_COLORS` from `chartUtils`), same gradients, same responsive
  behavior, same tooltip content/format, same legend toggle behavior.
- **Mobile**: touch-based tooltip activation (tap, not just hover), and
  the chart must reflow correctly at 375px width — verify, don't assume.
- If this is the shared `chartUtils`/`ChartContainer`/`ChartGradient`
  base that other chart components depend on, do this FIRST and make sure
  its exported shape (colors, formatters, margin constants) is unchanged
  so dependent components in this same program keep compiling.
- Do NOT remove the component from `components/charts/index.ts` — only
  change its internal implementation.

## Gate (run exactly; commit only if GATE=PASS)

```bash
cd web
bash scripts/frontend-gate.sh 'src/components/charts/RadialGauge.tsx' 'src/components/charts/index.ts'
echo "GATE_EXIT=$?"
```

- `GATE=PASS` ⇒ commit, print `EXIT=0` / `STATUS=DONE`.
- `GATE=FAIL` ⇒ fix and re-run (Persona 2 should have caught most of these
  before you even got here). If truly blocked by a missing sibling this unit
  depends on, print `EXIT=1` / `STATUS=BLOCKED` naming the missing module —
  the driver re-runs pending units after siblings land. Never commit on red.

## Commit (only after GATE=PASS)

```bash
git add web/src/components/charts/RadialGauge.tsx web/src/components/charts/index.ts
git commit -m "refactor(web): migrate RadialGauge off recharts to visx

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```