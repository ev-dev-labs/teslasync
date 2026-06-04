---
description: "P5/H3 — Accessibility audit per platform (VoiceOver, TalkBack, Narrator) + fixes"
---

# P5 · H3 · 0001 — Accessibility audit + fixes

> **Severity:** Hardening · **Delegation:** FORBIDDEN
> Manual screen-reader passes plus automated checks on every platform. ADR-015 is binding.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/shared/a11y/audit-report.md`, per-platform fix commits, automated check configs |
| Allowed files | `apps/**`, `apps/shared/a11y/**`, the log file |
| Depends on | P5/H0 |
| Blocks | P5/H99 |
| ADR refs | ADR-015 |
| Log | `../logs/p5-h3-0001-a11y.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Every page in every app is fully usable by a screen-reader user; passes automated a11y scans;
respects Dynamic Type / font scaling / Reduce Motion / high contrast; meets contrast (4.5:1 body,
3:1 large) and touch-target (≥44pt / 48dp) requirements.

## Spec

- **Manual passes** (one per platform, recorded in `audit-report.md` with screenshots/recordings):
  Dashboard, Vehicle Detail, Battery Health, Drive Detail, Charging Session, Settings.
- **Automated scans**:
  - Android: Accessibility Scanner + Espresso `AccessibilityChecks`.
  - iOS/macOS: XCUITest `XCUIAccessibilityAudit` API.
  - Windows: Accessibility Insights for Windows automated + ARC scan.
- **Charts**: each chart has a `.accessibilityChartDescriptor` (Apple), content-description with
  series summary (Android Vico), and an `AutomationProperties.HelpText` (WinUI) — plus a
  table/list alternative for dense data.
- **Motion**: honor Reduce Motion (no parallax/spring on the StaggerItem entrance).
- **Localization**: pseudo-loc inflation (1.5×) MUST not break layouts in any audit screen.

## Implementation steps

1. Manual pass per platform on the 6 priority screens; log issues in `audit-report.md`.
2. Wire automated scans into CI per platform; fail on Critical/High findings.
3. Fix every Critical/High; downgrade Mediums tracked in the report with owner.
4. Re-run manual + automated; attach final clean recordings to the log.

## Gate

```powershell
foreach($p in 'windows','android','apple'){
  & "./apps/$p/a11y/run.ps1" 2>&1 | Tee-Object $log -Append; "A11Y_${p}_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
}
# EXIT=0 only if every platform's a11y scan reports 0 Critical + 0 High.
```

## Acceptance Criteria

- [ ] Manual screen-reader pass attached for each platform (recording + notes).
- [ ] Automated scans: 0 Critical, 0 High across all platforms.
- [ ] Charts have accessible alternatives; Reduce Motion honored; pseudo-loc clean.
- [ ] Contrast + target sizes verified.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Backend a11y; new screens; legal accessibility compliance attestations (separate workstream).

## Commit

```powershell
git add apps .github/prompts/monorepo/logs/p5-h3-0001-a11y.log
git commit -m "a11y(apps): cross-platform accessibility audit + fixes (P5/H3)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
