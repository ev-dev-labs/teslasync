---
description: "P0/0007 — Design-token skeleton + per-platform generator stubs (ADR-005)"
---

# P0 · 0007 — Design-token skeleton

> **Severity:** Foundational · **Delegation:** FORBIDDEN · **Prompt:** 7 of 12 (P0)

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/design/tokens.schema.json`, `apps/design/README.md`, generator placeholders |
| Allowed files | `apps/design/**`, the log file |
| Depends on | 0001 |
| Blocks | P1 design-token extraction; every UI prompt (consumes tokens) |
| ADR refs | ADR-005 (design system) |
| Log | `../logs/p0-0007-design-tokens.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Define the neutral token schema + the directory contract for generating Fluent/Material/HIG
theme files. (Actual token VALUES are extracted from `web/src` in P1 — this prompt defines
the SHAPE only.)

## Output — `apps/design/tokens.schema.json` (token categories)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "TeslaSync design tokens (neutral)",
  "type": "object",
  "properties": {
    "color":      { "description": "semantic color roles: bg, surface, surfaceGlass, textPrimary, textSecondary, textMuted, accent, border, and status: success/warning/danger/info" },
    "chart":      { "description": "ordered categorical palette + per-series semantic colors (matches web CHART_COLORS)" },
    "typography": { "description": "type ramp: display/title/section/panel/body/bodySm/caption/label + weights" },
    "spacing":    { "description": "spacing scale (4pt base)" },
    "radius":     { "description": "corner radii: sm/md/lg/pill" },
    "elevation":  { "description": "elevation/material levels incl. glass/mica/acrylic mapping" },
    "motion":     { "description": "durations + easing curves" }
  },
  "required": ["color","chart","typography","spacing","radius","elevation","motion"]
}
```

## Output — `apps/design/README.md`

Document the mapping table from ADR-005 (token → Fluent brush / M3 ColorScheme / SwiftUI Color)
and the generation targets:
```
apps/design/tokens.json                  # filled in P1 from web tokens
apps/design/generated/windows/Tokens.xaml
apps/design/generated/android/Theme.kt
apps/design/generated/apple/Tokens.swift
```
Generators themselves are authored in P1; here, create the `generated/<platform>/.gitkeep` dirs.

## Implementation steps

1. PREFLIGHT: 0001 DONE + clean tree.
2. Write schema + README + `generated/{windows,android,apple}/.gitkeep`.
3. GATE: `Get-Content apps/design/tokens.schema.json | ConvertFrom-Json` succeeds; assert
   README documents all 7 token categories + 3 generation targets. Emit `EXIT=`.
4. Commit.

## Acceptance Criteria

- [ ] Schema valid JSON with all 7 categories `required`.
- [ ] README has the ADR-005 mapping table + 3 generation targets.
- [ ] `generated/{windows,android,apple}` dirs exist.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope (reject)

- No token VALUES yet (P1 extracts them from `web/src`).
- No generator implementation (P1).

## Commit

```powershell
git add apps/design .github/prompts/monorepo/logs/p0-0007-design-tokens.log
git commit -m "feat(monorepo): design-token schema + generation contract (P0/0007)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
