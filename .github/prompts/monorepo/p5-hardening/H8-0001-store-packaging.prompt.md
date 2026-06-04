---
description: "P5/H8 — Store packaging (MSIX/Microsoft Store, Play AAB + listing + Data Safety, App Store macOS + iOS + privacy labels)"
---

# P5 · H8 · 0001 — Store packaging + listings + privacy disclosures

> **Severity:** Release · **Delegation:** FORBIDDEN
> Package signed release artifacts and complete the store-side metadata (listing, screenshots,
> privacy/data-safety) honestly per ADR-016 (disclosures must match actual collection).

## Artifact Metadata

| Field | Value |
|---|---|
| Output | Signed artifacts: MSIX/MSIXBUNDLE, Android AAB (with proguard mapping), iOS IPA, macOS .pkg/.app + notarized; store-listing assets under `apps/{windows,android,apple}/store/**` |
| Allowed files | `apps/**`, `apps/*/store/**`, the log file |
| Depends on | P5/H1..H7 |
| Blocks | P5/H9 (release rollout) |
| ADR refs | ADR-016 |
| Log | `../logs/p5-h8-0001-store-packaging.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Produce reproducibly-signed release artifacts for every platform with complete, truthful store
listings (icons, screenshots in required sizes, descriptions, age ratings, privacy disclosures)
ready for submission. Disclosures match what the app actually collects — not what we wish it did.

## Spec

- **Windows**: MSIX/MSIXBUNDLE for x64 + ARM64; signed with the cert in CI secret; Partner
  Center listing draft with screenshots for Surface + non-Surface; age rating questionnaire; data
  collection declaration matches P1/S11 + H5.
- **Android**: AAB + mapping.txt; Play Console internal track release; Data Safety section
  (data types, sharing, purpose, encryption-in-transit) matches actual app behavior; content
  rating; target API level meets Play policy; screenshots for phone + tablet + Wear (if shipped);
  AAB signed with upload key (Play app signing handles distribution key).
- **iOS**: Archive + IPA; App Store Connect listing with screenshots for required iPhone sizes
  + iPad + Apple Watch (if shipped); privacy nutrition labels per ADR-016 (every collected data
  type accurately declared, including push tokens + crash data with consent linkage); export
  compliance ITSAppUsesNonExemptEncryption answered.
- **macOS**: notarized .pkg/.app via altool/notarytool; Mac App Store listing with screenshots;
  privacy labels mirror iOS.
- **Reproducibility**: a build manifest (`build-info.json`) per artifact: commit, build time,
  builder, dependency lockfile hash. Stored alongside each artifact.

## Implementation steps

1. CI release pipelines that produce signed artifacts on tag push for each platform.
2. Store listing drafts authored under `apps/<platform>/store/`; screenshots from H3-cleaned UI.
3. Privacy + data-safety + nutrition labels filled in from actual P1/S11 + H5 + H7 evidence.
4. Submit-readiness checklist per platform (covered in store/README per app).

## Gate

```powershell
foreach($p in 'windows','android','apple'){
  & "./apps/$p/store/build-release.ps1" 2>&1 | Tee-Object $log -Append; "BUILD_${p}_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
  & "./apps/$p/store/verify-listing.ps1" 2>&1 | Tee-Object $log -Append; "LIST_${p}_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
}
# EXIT=0 only if every BUILD_* and LIST_* is 0 AND every artifact has a build-info.json.
```

## Acceptance Criteria

- [ ] Signed release artifact for every shipping platform; reproducibility manifest attached.
- [ ] Store listings drafted: icons + screenshots (all required sizes) + descriptions + age ratings.
- [ ] Privacy/data-safety disclosures match actual collection (cross-checked vs H5/H7 evidence).
- [ ] Submit-readiness checklist green per platform.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

The actual submission/review process (H9); paid promotion; localized store listings beyond English.

## Commit

```powershell
git add apps .github/prompts/monorepo/logs/p5-h8-0001-store-packaging.log
git commit -m "release(apps): store packaging + listings + privacy disclosures (P5/H8)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
