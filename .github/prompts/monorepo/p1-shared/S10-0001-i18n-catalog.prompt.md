---
description: "P1/S10 — Neutral i18n catalog from web locales + per-platform resource generators"
---

# P1 · S10 · 0001 — i18n catalog + resource generators

> **Severity:** Foundation (blocks string parity on every page) · **Delegation:** FORBIDDEN
> One neutral message catalog derived from the web locale files, plus generators that emit
> `.resw` (Windows), `strings.xml`/Compose resources (Android), and `.xcstrings` (Apple).
> Per ADR-014.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/shared/i18n/catalog/**`, `apps/shared/i18n/generators/**`, `apps/{windows,android,apple}/.../<generated resources>` |
| Web source | `web/src/i18n/**` / `web/public/locales/**` (all locales + namespaces) |
| Allowed files | `apps/shared/i18n/**`, generated resource dirs, the log file |
| Depends on | P0 done |
| Blocks | every page prompt's string-parity gate; H4 (l10n completeness) |
| ADR refs | ADR-014 |
| Log | `../logs/p1-s10-0001-i18n.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Convert the web i18n resources (every locale, every namespace, every key including
interpolation + plurals) into a neutral catalog, then generate platform resource bundles so a
native page can resolve the exact same keys the web page used. A completeness check fails if any
locale is missing a key present in the base locale.

## Spec

- **Ingest**: read all web locale JSON (namespaces preserved), capture ICU/i18next interpolation
  (`{{var}}`) and plural forms; normalize to a neutral catalog keyed by `namespace.key`.
- **Generators**: emit `.resw` (Windows), Android `strings.xml` per locale (escape + plurals via
  `<plurals>`), Apple `.xcstrings` (with plural variations). Interpolation tokens mapped to each
  platform's format (`{0}` / `%1$s` / `%@` or `.xcstrings` args) — document the mapping.
- **Completeness `--check`**: base-locale key set ⊆ every other locale; missing/extra → fail.
- **Parity hook**: page prompts reference catalog keys; this phase guarantees they exist on all
  platforms.

## Implementation steps

1. Catalog ingestor (web locales → `catalog/<locale>.json`) preserving namespaces + plurals.
2. Three resource emitters + `gen-i18n.ps1` + interpolation-token mapping doc.
3. Completeness checker; run on the full locale set.
4. Run gate.

## Gate

```powershell
& ./apps/shared/i18n/generators/gen-i18n.ps1 2>&1 | Tee-Object $log -Append; "GEN_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/shared/i18n/generators/gen-i18n.ps1 -Check 2>&1 | Tee-Object $log -Append; "COMPLETE_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if GEN/COMPLETE both 0
```

## Acceptance Criteria

- [ ] Neutral catalog covers every web locale + namespace + key (count logged vs web).
- [ ] `.resw` + `strings.xml` + `.xcstrings` generate with correct plurals + interpolation mapping.
- [ ] Completeness check green (no locale missing base keys).
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Translating new strings; per-page string wiring (page prompts); RTL layout (H4).

## Commit

```powershell
git add apps/shared/i18n apps/windows apps/android apps/apple .github/prompts/monorepo/logs/p1-s10-0001-i18n.log
git commit -m "feat(apps/shared): neutral i18n catalog + platform resource generators (P1/S10)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
