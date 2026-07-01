---
description: "Frontend gold-standard rewrite — Playwright E2E — TeslaFeatureFlagsPage"
---

# Write Playwright E2E test for src/features/admin/pages/TeslaFeatureFlagsPage.tsx

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
Create `web/e2e/admin/teslafeatureflagspage.spec.ts` covering the `TeslaFeatureFlagsPage` page. Read
`web/src/features/admin/pages/TeslaFeatureFlagsPage.tsx` to understand what it renders and requires. Requirements:
- Run the spec against **both** Playwright projects configured in
  `playwright.config.ts` (`desktop-chrome` and `mobile-safari`) — do not
  restrict `test.describe` to a single project unless the page is
  genuinely desktop-only (rare; justify if so).
- Cover: page loads without console errors, primary content renders
  (assert on a key heading/data element, not just "no crash"), at least
  one interactive element works (click/tap a button, open a filter, etc.
  — pick whatever is most central to this page), and the loading/empty
  states are reachable and assertable (mock the API response via
  `page.route` if needed to force each state).
- Use accessible role-based locators (`getByRole`, `getByLabel`) over CSS
  selectors, matching Testing-Library conventions already used in this
  repo's Vitest suite.
- Do not skip this page because it looks simple — every page gets a real
  test, per program mandate (no partial coverage).

## Gate (run exactly; commit only if GATE=PASS)

```bash
cd web
bash scripts/frontend-gate.sh 'e2e/admin/teslafeatureflagspage.spec.ts'
echo "GATE_EXIT=$?"
```

- `GATE=PASS` ⇒ commit, print `EXIT=0` / `STATUS=DONE`.
- `GATE=FAIL` ⇒ fix and re-run (Persona 2 should have caught most of these
  before you even got here). If truly blocked by a missing sibling this unit
  depends on, print `EXIT=1` / `STATUS=BLOCKED` naming the missing module —
  the driver re-runs pending units after siblings land. Never commit on red.

## Commit (only after GATE=PASS)

```bash
git add web/e2e/admin/teslafeatureflagspage.spec.ts
git commit -m "test(web): add Playwright E2E coverage for TeslaFeatureFlagsPage

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```