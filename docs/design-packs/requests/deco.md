# Deco Grand shared follow-ups

The first three items were previously documented shared findings; Round 1
confirmed the protected-twin measurements in the Deco dashboard.

1. **Protected Digital Twins:** `DECISIONS.md` records 390px measurements of
   36×36px Open, 10×28px refresh, and 14.1px text. Please resolve the conflict
   with 44px targets and 16px body text without changing protected widget
   geometry, data, interactions, or vehicle imagery.
2. **Standalone coverage:** `/connect`, `/glance`, `/onboarding`, `/s/:token`,
   `/watch`, and `/year-review/:year` still lack verified authenticated
   design-bridge and capture coverage. Please verify pack ownership on these
   routes without leaking saved preferences across identities.
3. **Shared readiness:** `/period-compare` previously did not settle because
   of repeated settings requests. Please investigate before claiming route
   coverage. Verified preferences may also flash before the lazy bridge
   applies; please resolve identity-safe first paint.
4. **Cross-pack loading contract:** the existing
   `feedback-native-followup.test.tsx` pending-ring test failed because at
   least Blueprint lacked a `[data-app-part~="loading"]` pack rule during the
   in-progress parallel work. Several other sheets also lacked one in that
   snapshot. Please coordinate with their owners and rerun the all-pack test
   after their changes settle; block loaders must not style inline spinners.
   Deco's own loading selector excludes inline spinners.
5. **Desktop capture readiness:** Round 1 Energy and Round 2 Drives failed the
   mock API check with a still-pending same-origin `GET /api/v1/pinned` after
   the five-second wait. Energy passed in Round 2. Please investigate
   request/fixture settling without weakening the check; the stylesheet cannot
   resolve API readiness.
