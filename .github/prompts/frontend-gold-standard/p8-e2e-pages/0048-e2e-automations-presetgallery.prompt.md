---
description: "Frontend gold-standard rewrite — Playwright E2E — PresetGallery"
---

# Write Playwright E2E test for src/features/automations/pages/PresetGallery.tsx

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
Create `web/e2e/automations/presetgallery.spec.ts` covering the `PresetGallery` page. Read
`web/src/features/automations/pages/PresetGallery.tsx` to understand what it renders and requires. Requirements:
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

## Gate (run exactly)

```bash
cd web
bash scripts/frontend-gate.sh 'e2e/automations/presetgallery.spec.ts'
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
git add web/e2e/automations/presetgallery.spec.ts
git commit -m "test(web): add Playwright E2E coverage for PresetGallery

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```