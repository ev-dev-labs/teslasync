---
description: "P5/H4 — Localization completeness, pseudo-loc, RTL spot-check"
---

# P5 · H4 · 0001 — Localization completeness + RTL

> **Severity:** Hardening · **Delegation:** FORBIDDEN
> Per ADR-014: every i18n key resolves on every platform in every shipping locale; pseudo-loc
> shows zero layout breakage; RTL spot-check on Arabic/Hebrew if shipped.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/shared/i18n/completeness-report.md`, fixed resource files, pseudo-loc + RTL recordings |
| Allowed files | `apps/**`, `apps/shared/i18n/**`, the log file |
| Depends on | P1/S10, P5/H3 |
| Blocks | P5/H99 |
| ADR refs | ADR-014, ADR-015 |
| Log | `../logs/p5-h4-0001-l10n.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Re-run the S10 completeness check, then walk every shipping app under pseudo-loc and (if any
RTL locale is shipped) at least one RTL locale, fixing missing strings, truncated layouts,
hardcoded literals, and mis-mirrored layouts.

## Spec

- **Completeness**: every catalog key present in EVERY shipping locale; missing keys block.
- **Pseudo-loc**: 1.5× inflation + accent marks; manual sweep on Dashboard, Vehicle Detail,
  Battery Health, Drive Detail, Charging Session, Settings; layouts must not clip/wrap-break.
- **RTL** (only if Arabic/Hebrew ship): leading/trailing edges mirror correctly; icons that
  imply direction either mirror or are explicitly opted out; charts unchanged.
- **No hardcoded literals**: per-platform scan asserts zero literal strings in UI code outside
  the catalog (regex scan + lint rule). Common offenders: snackbar messages, error dialogs.
- **Plurals + interpolation**: each pluralizable string verified for `0/1/few/many/other` per
  the locale CLDR rules.

## Implementation steps

1. Run S10 `--check`; fix any missing keys.
2. Build pseudo-loc resources; run apps; capture screenshots; fix layouts.
3. (If RTL shipped) build RTL resources; run apps; fix mirroring.
4. Per-platform hardcoded-string scan; fix any literal found.
5. Plural/interpolation spot-check.

## Gate

```powershell
& ./apps/shared/i18n/generators/gen-i18n.ps1 -Check 2>&1 | Tee-Object $log -Append; "COMPLETE_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
foreach($p in 'windows','android','apple'){ & "./apps/$p/i18n/scan-literals.ps1" 2>&1 | Tee-Object $log -Append; "LIT_${p}_EXIT=$LASTEXITCODE" | Tee-Object $log -Append }
# EXIT=0 only if COMPLETE=0 AND every LIT_*=0 AND pseudo-loc screenshots committed.
```

## Acceptance Criteria

- [ ] Completeness check green; zero missing keys in any shipping locale.
- [ ] Pseudo-loc screenshots attached for the 6 priority screens per platform; no layout breakage.
- [ ] Zero hardcoded literals on any shipping platform.
- [ ] Plurals + interpolation validated against CLDR.
- [ ] (If shipped) RTL spot-check clean.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

New translations (translation vendor workflow); locale negotiation/auto-detection redesign.

## Commit

```powershell
git add apps .github/prompts/monorepo/logs/p5-h4-0001-l10n.log
git commit -m "i18n(apps): completeness + pseudo-loc + RTL hardening (P5/H4)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
