# Phase 11 — Production Cutover (Gitops Handoff)

> **Goal:** Hand off to the gitops repo where the actual production cutover playbook lives. The teslasync repo's role ends with merge-ready + soak-verified.
>
> **Pre-req:** Phase 10 verdict = GO.

## Prompts in this phase

| # | File | Purpose |
|--:|------|---------|
| 01 | `01-handoff-to-gitops.prompt.md` | Pointer to the cutover playbook in `D:\repos\-k3s-gitops\.github\prompts\teslasync-ts-cutover\` |

## Why a separate repo

The cutover involves: pre-cutover backup, helm upgrade with replacement Helm release, DNS / ingress flip, monitoring window, post-cutover smoke, and rollback gate. Those steps live in the gitops repo because they touch cluster resources outside this repo's scope.
