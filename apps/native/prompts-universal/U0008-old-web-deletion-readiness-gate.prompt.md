---
description: "Universal RN U0008 — old web deletion readiness gate"
---

# U0008 — Old web deletion readiness gate

> **Severity:** Gate | **Delegation:** FORBIDDEN

## Goal

Prove whether the React Native Web target is ready to replace `web/`. Do not delete `web/` in this prompt. Produce a truthful readiness result and commit only supporting evidence/code if gates pass.

## Rules

- Do not delete `web/`.
- No count-only proof.
- No hidden pending routes/widgets.
- No fake screenshots/tests.

## Required work

1. Compare every route and major widget from old `web/` to RN web/native manifest.
2. Run all host-available gates.
3. If parity is not complete, keep `web/` and mark readiness blocked with exact remaining list.
4. If parity is complete, mark deletion-ready but still do not delete old web until the user explicitly approves.

## Gate

Run all universal RN gates and output exact route/widget/platform readiness counts.

## Commit

Commit message: `test(apps): record universal web replacement readiness`
