---
description: "Frontend gold-standard rewrite — Radix/Base UI under Slider"
---

# Rebuild components/ui/Slider.tsx on Radix UI primitives

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
Rewrite `web/src/components/ui/Slider.tsx` to use the Radix UI **Slider** primitive
internally (`@radix-ui/react-*`, add the exact package to
`web/package.json` if missing) instead of the current hand-rolled
implementation. Requirements:
- The **external prop API must not change** — every existing call-site
  across the app must keep working with zero edits.
- Keep the exact current visual design (glassmorphism, Tailwind classes,
  motion) — Radix primitives are unstyled, so port the existing classes
  onto the Radix parts.
- Gain correct focus-trap, keyboard nav (Tab/Shift+Tab/Escape/Arrow keys
  as appropriate for this primitive), and ARIA roles from Radix — verify
  these actually work, don't just assume.
- Preserve/improve mobile touch behavior (tap targets, swipe-to-dismiss
  for sheet-like components where natural).
- Grep the codebase for every import of this component
  (`grep -rl "Slider" web/src --include=*.tsx`) and spot-check at least
  3 real call-sites across different feature domains still render/behave
  correctly after the change (describe what you checked).

## Gate (run exactly; commit only if GATE=PASS)

```bash
cd web
bash scripts/frontend-gate.sh 'src/components/ui/Slider.tsx'
echo "GATE_EXIT=$?"
```

- `GATE=PASS` ⇒ commit, print `EXIT=0` / `STATUS=DONE`.
- `GATE=FAIL` ⇒ fix and re-run (Persona 2 should have caught most of these
  before you even got here). If truly blocked by a missing sibling this unit
  depends on, print `EXIT=1` / `STATUS=BLOCKED` naming the missing module —
  the driver re-runs pending units after siblings land. Never commit on red.

## Commit (only after GATE=PASS)

```bash
git add web/src/components/ui/Slider.tsx
git commit -m "refactor(web): rebuild Slider on Radix UI Slider

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```