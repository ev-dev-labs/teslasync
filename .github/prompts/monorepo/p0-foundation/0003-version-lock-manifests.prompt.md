---
description: "P0/0003 — Version-lock manifests for all toolchains (ADR-012)"
---

# P0 · 0003 — Version-lock manifests

> **Severity:** Foundational · **Delegation:** FORBIDDEN · **Prompt:** 3 of 12 (P0)

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/versions.lock.md` + empty pinned version files per platform |
| Allowed files | `apps/versions.lock.md`, `apps/android/gradle/libs.versions.toml`, `apps/windows/Directory.Packages.props`, `apps/apple/versions.lock.md`, the log file |
| Depends on | 0001 |
| Blocks | 0004, all platform programs |
| ADR refs | ADR-012 (version lock) |
| Log | `../logs/p0-0003-version-lock.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Record the ADR-012 baselines as the canonical version source for the whole effort.

## Output — `apps/versions.lock.md` (exact table, fill exact patch versions during execution)

```markdown
# Version Lock (ADR-012) — verify each at execution time against vendor channels

| Area | Tool | Locked baseline |
|---|---|---|
| Shared | Kotlin | 2.2.x (pin exact, e.g. 2.2.20) |
| Shared | Gradle | 8.x |
| Shared | Ktor | 3.x |
| Shared | kotlinx.serialization / datetime | latest stable |
| Shared | SQLDelight | latest stable |
| Android | Compose BOM | latest stable |
| Android | Material 3 | latest stable (Expressive) |
| Android | AGP | latest stable; minSdk 26; targetSdk latest |
| Android | Vico (charts) | latest stable |
| Windows | Windows App SDK | 1.6+ |
| Windows | .NET | 10 (LTS) |
| Windows | CommunityToolkit.Mvvm / WinUI | latest stable |
| Apple | Xcode / SwiftUI | current |
| Apple | Swift | 6 (strict concurrency) |
| Apple | Swift Charts / MapKit | SDK-bundled |
| Contract | OpenAPI | 3.1 |
| Contract | Generators | openapi-generator (kotlin), NSwag/Kiota (c#), swift-openapi-generator |

> Renovate keeps patch versions current; major bumps require a superseding ADR.
```

`libs.versions.toml`, `Directory.Packages.props`: create with a header comment + the
baseline versions as placeholders to be finalized by the first build prompt of each program.

## Implementation steps

1. PREFLIGHT: 0001 DONE + clean tree.
2. **Verify each baseline still current** at execution time (web fetch / vendor pages);
   record the exact patch version you pin in the log SURVEY. If a baseline is EOL/superseded,
   STOP and BLOCK with a note (a superseding ADR is required — rule per ADR-012).
3. Write the files.
4. GATE: assert all four files exist; emit `EXIT=`.
5. Commit.

## Acceptance Criteria

- [ ] `versions.lock.md` present with every row filled with an exact pinned version.
- [ ] Per-platform version files exist.
- [ ] SURVEY log shows the vendor-source verification for each pin.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Commit

```powershell
git add apps/versions.lock.md apps/android/gradle/libs.versions.toml apps/windows/Directory.Packages.props apps/apple/versions.lock.md .github/prompts/monorepo/logs/p0-0003-version-lock.log
git commit -m "chore(monorepo): version-lock manifests per ADR-012 (P0/0003)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
