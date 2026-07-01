---
description: "Frontend gold-standard rewrite — Storybook story — TransitionArrow"
---

# Write Storybook stories for components/data-display/TransitionArrow

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
Create `web/src/components/data-display/TransitionArrow.stories.tsx` (CSF3 format) covering `TransitionArrow` from
`web/src/components/data-display/TransitionArrow.tsx`. Requirements:
- A story for **every visually distinct state**: default, loading, error,
  empty, disabled (if applicable), and at least one story at mobile
  viewport width (375px) using Storybook viewport params.
- Use realistic mock data/args, not empty placeholders.
- Add `autodocs` tag so props are documented automatically.
- If the component requires app context (TanStack Query, i18n, Router),
  wrap it in the appropriate decorator (check `.storybook/preview.tsx`
  for existing global decorators before adding new ones).

## Gate (run exactly; commit only if GATE=PASS)

```bash
cd web
bash scripts/frontend-gate.sh 'src/components/data-display/TransitionArrow.stories.tsx'
echo "GATE_EXIT=$?"
```

- `GATE=PASS` ⇒ commit, print `EXIT=0` / `STATUS=DONE`.
- `GATE=FAIL` ⇒ fix and re-run (Persona 2 should have caught most of these
  before you even got here). If truly blocked by a missing sibling this unit
  depends on, print `EXIT=1` / `STATUS=BLOCKED` naming the missing module —
  the driver re-runs pending units after siblings land. Never commit on red.

## Commit (only after GATE=PASS)

```bash
git add web/src/components/data-display/TransitionArrow.stories.tsx
git commit -m "test(web): add Storybook stories for TransitionArrow

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```