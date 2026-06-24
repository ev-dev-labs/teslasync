---
description: "Universal RN U0007 — packaging and device gates"
---

# U0007 — Packaging, signing scaffolds, and device gates

> **Severity:** Feature/Gate | **Delegation:** FORBIDDEN

## Goal

Add scripts and evidence for RN web build, Android/iOS/Windows/macOS bundles/builds where host tooling exists, package/signing scaffolds, and UI/device smoke gates.

## Rules

- No committed secrets/certificates.
- No claiming unavailable host gates passed.
- No deleting platform projects to pass.
- No deleting `web/`.

## Required work

1. Add web build/package scripts.
2. Add or update Android/iOS/Windows/macOS package scripts.
3. Add device/smoke gate scripts for host-available tooling.
4. Record unavailable tooling honestly.

## Gate

Run typecheck, lint, Jest, Windows Jest, Android/Windows bundles, web build, and host-available package/device gates.

## Commit

Commit message: `feat(apps): add universal packaging gates`

