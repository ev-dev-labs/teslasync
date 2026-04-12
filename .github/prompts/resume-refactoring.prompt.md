---
description: "RESUME refactoring from where the previous session stopped"
---

# Resume Refactoring

## Instructions

A previous session was working on the full refactoring but the session ended.
Your job is to pick up EXACTLY where it left off.

**Branch:** `refactor/full-rewrite`

## Step 1: Read the progress tracker

```bash
cat REFACTORING_PROGRESS.md
```

This file tells you:
- **Active Phase** — which phase was in progress
- **Active Task** — which specific task was being worked on
- **Phase Checklist** — which boxes are checked (done) vs unchecked (remaining)
- **Last Completed Phase** — the last phase that fully passed verification

## Step 2: Check what exists on the branch

```bash
git log --oneline -20
find internal/ -name "*.go" | head -40
find web/src/components/ -name "*.tsx" 2>/dev/null | head -40
```

## Step 3: Resume from the active task

1. Read the prompt file for the active phase: `.github/prompts/phase-{N}-*.prompt.md`
2. Skip tasks already checked ✅ in REFACTORING_PROGRESS.md
3. Continue from the first unchecked task
4. Follow ALL rules from `.github/copilot-instructions.md`
5. Keep updating REFACTORING_PROGRESS.md as you complete tasks
6. Commit after each task
7. When the active phase is done, continue to the next phase
8. Keep going until ALL phases are complete

## Step 4: Don't re-do completed work

- If a file already exists and looks correct, skip it
- If a file exists but is incomplete, finish it
- If a file exists but violates guidelines, fix it
- Run verification for the current phase before moving on

## Rules

- Do NOT ask for approval. Keep going autonomously.
- Do NOT stop between phases.
- Update REFACTORING_PROGRESS.md after every task.
- Commit frequently: one commit per task.
- If stuck, log in BLOCKING_ISSUES.md and continue with next task.
