---
description: "P5/H6 — Security review: secure-storage audit, no-PII-in-logs, cert pinning, CVE scan"
---

# P5 · H6 · 0001 — Security review + dependency scan

> **Severity:** Hardening · **Delegation:** FORBIDDEN
> A focused security pass on every native app: tokens stored only in OS secure stores; logs
> never contain PII; certificate pinning decision recorded; dependency CVEs zero (Critical/High).

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/shared/security/audit-report.md`, fix commits, `apps/shared/security/cert-pinning-decision.md` (ADR-style) |
| Allowed files | `apps/**`, `apps/shared/security/**`, the log file |
| Depends on | P5/H1, P1/S6, P1/S11 |
| Blocks | P5/H99 |
| ADR refs | ADR-008, ADR-016 |
| Log | `../logs/p5-h6-0001-security.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Confirm and prove (with evidence in `audit-report.md`) that: (1) all tokens live in Keychain /
EncryptedSharedPreferences / Credential Locker — never plaintext on disk or in memory dumps;
(2) the redacting logger (P1/S11) catches every PII pattern reachable from production code
paths; (3) cert pinning is either implemented or explicitly rejected with rationale; (4) no
Critical/High CVE in any third-party dependency.

## Spec

- **Token storage audit**: forensic scan of preferences/cache directories on each platform after
  sign-in → confirm only encrypted blobs; memory-dump spot-check; sign-out clears.
- **PII-in-logs**: instrument logger sinks with a forbidden-pattern detector during e2e (H1)
  runs — any hit = test fail. Patterns: VIN format, JWT shape, lat/lon decimals, email regex.
- **Cert pinning**: decide per ADR-008 — pin the Authentik + API origins via platform native APIs
  (NSURLSession evaluator / Network Security Config / HttpClientFactory handler), or document why
  pinning is rejected (e.g., self-hosted variability). Either outcome is acceptable; silence is not.
- **Dependency CVE scan**: `gradle dependencyCheck` + `dotnet list package --vulnerable` +
  `swift package show-dependencies` + Trivy on the apps tree. Critical/High = 0; Medium tracked.
- **Build settings**: release configs strip debug logging, disable inspect/debug entry points,
  enable hardening flags (PIE, ARC, /GS, NX), and sign with hardware-bound keys.

## Implementation steps

1. Token + memory audit per platform; attach evidence to the report.
2. PII detector wired into e2e log sinks; run H1 suite under detector.
3. Cert-pinning decision + implementation or written rejection.
4. CVE scan; bump or replace anything Critical/High; record Medium register.
5. Release-config audit checklist green per platform.

## Gate

```powershell
foreach($p in 'windows','android','apple'){
  & "./apps/$p/security/audit.ps1" 2>&1 | Tee-Object $log -Append; "SEC_${p}_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
}
& trivy fs apps --severity CRITICAL,HIGH --exit-code 1 2>&1 | Tee-Object $log -Append; "CVE_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if every SEC_*=0 AND CVE=0 AND cert-pinning-decision.md committed.
```

## Acceptance Criteria

- [ ] Token-storage forensic evidence attached for each platform (no plaintext).
- [ ] PII detector ran during H1 suite with zero hits.
- [ ] Cert-pinning decision document committed (implementation or rejection).
- [ ] 0 Critical, 0 High CVEs across all apps; Medium register documented.
- [ ] Release configs hardened on every platform.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Backend pentest; account-takeover testing; new auth flows.

## Commit

```powershell
git add apps .github/prompts/monorepo/logs/p5-h6-0001-security.log
git commit -m "security(apps): cross-platform security review + fixes (P5/H6)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
