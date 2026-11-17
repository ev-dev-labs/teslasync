# Bauhaus shared requests

These are previously documented shared findings, not Bauhaus capture results.

- Resolve the protected Digital Twin phone-accessibility conflict without
  changing its preserved geometry or vehicle imagery. `DECISIONS.md` records
  36 × 36px Open, 10 × 28px refresh, and 14.1px text at 390px, below the
  requested 44px targets and 16px body minimum. The pack cannot safely alter
  those protected subtrees.
- Cover the standalone `/connect`, `/glance`, `/onboarding`, `/s/:token`,
  `/watch`, and `/year-review/:year` routes with identity-safe design scope and
  capture fixtures; they are currently excluded from full-app verification.
- Investigate `/period-compare` settings-query churn before including that route
  in visual review. The documented diagnostic observed 250 successful settings
  requests in about ten seconds without settling.
- Resolve the asynchronously applied verified design preference's possible
  first-paint flash without caching a selection across identities.
- The Bauhaus 390px dashboard capture also reported non-Twin widget-owned
  body content below 16px: the recent-drive context, “All drives” link,
  metric unit, and fleet-posture “Open vehicle” link. Review their shared
  widget owners without changing the native metric compositions. The ordinary
  headline context and unit now have a pack-owned phone treatment and
  focused regression; the links still need independent verification.
- The first Bauhaus desktop dashboard capture failed because the mocked
  `/api/v1/pinned` request remained pending at fixture completion. This did
  not recur in round two, but the intermittent fixture completion deserves
  investigation.
- Axe could not determine contrast for a partly obscured desktop Security
  navigation label and for several chart axis/legend nodes on drives and
  energy. Inspect the shared rail overlap and chart labels independently;
  the available viewport captures do not establish their contrast.
