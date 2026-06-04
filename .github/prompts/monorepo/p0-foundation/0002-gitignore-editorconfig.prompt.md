---
description: "P0/0002 — Root .gitignore + .editorconfig entries for KMP/.NET/Swift toolchains"
---

# P0 · 0002 — `.gitignore` + `.editorconfig` for three toolchains

> **Severity:** Foundational · **Delegation:** FORBIDDEN · **Prompt:** 2 of 12 (P0)

## Artifact Metadata

| Field | Value |
|---|---|
| Output | appended `.gitignore` blocks + `apps/.editorconfig` |
| Allowed files | `.gitignore`, `apps/.editorconfig`, the log file |
| Depends on | 0001 |
| Blocks | 0004 (CI), all platform programs |
| ADR refs | ADR-001, ADR-012 |
| Log | `../logs/p0-0002-gitignore-editorconfig.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Logging

`=== PREFLIGHT ===` (verify 0001 log STATUS=DONE; clean tree) · `=== CHANGES ===` ·
`=== GATE ===` · `=== COMMIT ===`.

## Single Goal

Ignore build artifacts for Gradle/KMP, .NET/WinUI, and Xcode/Swift; set shared editor rules.

## Output — `.gitignore` appended blocks (exact)

```gitignore
# --- apps: KMP / Gradle / Android ---
apps/**/.gradle/
apps/**/build/
apps/**/local.properties
apps/**/*.iml
apps/android/.cxx/
apps/**/.kotlin/

# --- apps: .NET / WinUI (Windows) ---
apps/windows/**/bin/
apps/windows/**/obj/
apps/windows/**/*.user
apps/windows/**/AppPackages/
apps/windows/**/BundleArtifacts/
apps/windows/**/Generated Files/

# --- apps: Xcode / Swift (Apple) ---
apps/apple/**/.build/
apps/apple/**/DerivedData/
apps/apple/**/*.xcuserstate
apps/apple/**/xcuserdata/
apps/apple/**/.swiftpm/

# --- apps: generated OpenAPI clients (regenerated, not committed raw) keep specs only ---
apps/**/generated/
```

## Output — `apps/.editorconfig` (exact)

```ini
root = false

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space

[*.{kt,kts}]
indent_size = 4
[*.{cs,xaml}]
indent_size = 4
[*.{swift}]
indent_size = 4
[*.{json,yml,yaml}]
indent_size = 2
```

## Implementation steps

1. PREFLIGHT: 0001 DONE + clean tree.
2. Append the `.gitignore` blocks (do not remove existing entries); create `apps/.editorconfig`.
3. GATE: `git check-ignore -q apps/windows/bin/x.dll; "IGNORE_EXIT=$LASTEXITCODE"` (0 = ignored). Assert editorconfig exists. Emit `EXIT=`.
4. Commit.

## Acceptance Criteria

- [ ] All three toolchain blocks present; no existing ignore lines deleted.
- [ ] `apps/.editorconfig` exists with the four language sections.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Commit

```powershell
git add .gitignore apps/.editorconfig .github/prompts/monorepo/logs/p0-0002-gitignore-editorconfig.log
git commit -m "chore(monorepo): ignore rules + editorconfig for KMP/.NET/Swift (P0/0002)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
