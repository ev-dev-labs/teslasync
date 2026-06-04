---
description: "P0/0011 — Contributor guide: sparse checkout + per-platform dev setup"
---

# P0 · 0011 — Contributor guide (`apps/README.md`)

> **Severity:** Foundational · **Delegation:** FORBIDDEN · **Prompt:** 11 of 12 (P0)

## Artifact Metadata

| Field | Value |
|---|---|
| Output | full `apps/README.md` (replaces the 0001 placeholder) |
| Allowed files | `apps/README.md`, the log file |
| Depends on | 0001–0010 |
| Blocks | onboarding for all platform programs |
| ADR refs | ADR-001, ADR-012 |
| Log | `../logs/p0-0011-contributor-guide.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

A real contributor guide so a developer can set up any one platform without cloning the world.

## Output — `apps/README.md` must contain

1. **Map** of `apps/` (shared/design/parity/windows/android/apple/tools/docs) with one line each.
2. **Sparse / partial checkout** instructions to work on a single platform:
   ```
   git sparse-checkout set apps/shared apps/design apps/parity apps/windows api/openapi
   ```
3. **Per-platform dev setup** (toolchain from ADR-012 / `versions.lock.md`):
   - Windows: VS 2022+, .NET 10 SDK, Windows App SDK 1.6+, WinUI workload.
   - Android: JDK 17+, Android Studio, SDK 26+/latest, Gradle.
   - Apple: macOS + Xcode (current), Swift 6, CocoaPods/SPM as needed.
4. **How to build/lint/test** each platform locally (the ADR-010 triad commands).
5. **Where the contract lives** (`api/openapi/`) + how to regenerate clients.
6. **Pointers** to the methodology, ADRs, parity README, and the two runbooks.

## Implementation steps

1. PREFLIGHT: 0001–0010 logs STATUS=DONE; clean tree.
2. Write the guide.
3. GATE: README contains all 6 sections (grep); links resolve to existing files. Emit `EXIT=`.
4. Commit.

## Acceptance Criteria

- [ ] All 6 sections present; per-platform setup matches `versions.lock.md`.
- [ ] Sparse-checkout command included.
- [ ] All internal links point to files that exist.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Commit

```powershell
git add apps/README.md .github/prompts/monorepo/logs/p0-0011-contributor-guide.log
git commit -m "docs(monorepo): apps contributor + dev-setup guide (P0/0011)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
