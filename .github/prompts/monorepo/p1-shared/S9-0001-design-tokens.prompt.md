---
description: "P1/S9 — Extract web design tokens → tokens.json + per-platform theme generators"
---

# P1 · S9 · 0001 — Design tokens + theme generators

> **Severity:** Foundation (blocks every platform theme phase) · **Delegation:** FORBIDDEN
> Single source of truth for color/typography/spacing/elevation/motion + brand chart palette,
> extracted from the real web theme, emitted to Fluent / Material 3 / HIG. Per ADR-005.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/design/tokens.json`, `apps/design/generators/**`, `apps/design/generated/{windows,android,apple}/**` |
| Web source | `web/tailwind.config.*`, `web/src/lib/tokens.*`, `web/src/lib/colors.*`, CSS vars (`--text-primary`, …) |
| Allowed files | `apps/design/**`, the log file |
| Depends on | P0/0007 (design-tokens skeleton) |
| Blocks | W1 (Fluent theme), A1 (Material theme), P2-Apple (Tokens.swift) |
| ADR refs | ADR-005 |
| Log | `../logs/p1-s9-0001-tokens.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Extract the web design language into a platform-neutral `tokens.json` (semantic tokens, not raw
hex scattered) and generators that emit a Fluent `ResourceDictionary`, a Material 3 `Theme.kt`
`ColorScheme`/`Typography`, and a SwiftUI `Tokens.swift`. Light + dark + high-contrast. The
brand chart palette (`CHART_COLORS`) is part of the contract.

## Spec

- **Extract** from the real web sources: semantic colors (`--text-primary/secondary/muted`,
  surfaces, brand cyan/emerald/amber/rose/purple/indigo/pink scales, status colors), typography
  scale (sizes/weights/line-heights from `lib/tokens`), spacing, radius, elevation, motion
  durations/easings, and `CHART_COLORS`. Map each to a SEMANTIC token name.
- **tokens.json**: `{ color: {light,dark,highContrast}, typography, spacing, radius, elevation,
  motion, chart }`. No platform specifics.
- **Generators** (`apps/design/generators`, run via script): emit the three platform theme files
  deterministically; a `--check` mode fails on drift.
- **Fidelity**: generated light/dark values must equal the web values (golden compare for a
  sampled set of tokens).

## Implementation steps

1. Author the extractor (read tailwind/lib token sources) → `tokens.json` (review for
   completeness vs the web prohibited-pattern color map: cyan→cyan-300 etc.).
2. Write the three emitters + a `gen-themes.ps1` wrapper + `--check`.
3. Golden compare on sampled tokens (web value vs generated).
4. Run gate.

## Gate

```powershell
& ./apps/design/generators/gen-themes.ps1 2>&1 | Tee-Object $log -Append; "GEN_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/design/generators/gen-themes.ps1 -Check 2>&1 | Tee-Object $log -Append; "DRIFT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
node ./apps/design/generators/verify-fidelity.mjs 2>&1 | Tee-Object $log -Append; "FID_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if GEN/DRIFT/FID all 0
```

## Acceptance Criteria

- [ ] `tokens.json` covers color(light/dark/HC)/type/spacing/radius/elevation/motion/chart, semantic-named.
- [ ] Three platform theme files generate; `--check` drift gate green.
- [ ] Sampled token fidelity matches web values.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Applying themes in apps (W1/A1/Apple-P2); component styling.

## Commit

```powershell
git add apps/design .github/prompts/monorepo/logs/p1-s9-0001-tokens.log
git commit -m "feat(apps/design): neutral design tokens + Fluent/Material/HIG generators (P1/S9)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
