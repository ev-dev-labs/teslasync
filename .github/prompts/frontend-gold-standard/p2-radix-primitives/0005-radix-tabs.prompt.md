---
description: "Frontend gold-standard rewrite — Radix/Base UI under Tabs"
---

# Rebuild components/ui/Tabs.tsx on Radix UI primitives

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
Rewrite `web/src/components/ui/Tabs.tsx` to use the Radix UI **Tabs** primitive
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
  (`grep -rl "Tabs" web/src --include=*.tsx`) and spot-check at least
  3 real call-sites across different feature domains still render/behave
  correctly after the change (describe what you checked).

## Gate (run exactly)

```bash
cd web
bash scripts/frontend-gate.sh 'src/components/ui/Tabs.tsx'
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
git add web/src/components/ui/Tabs.tsx
git commit -m "refactor(web): rebuild Tabs on Radix UI Tabs

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```