# Warm Modern: shared follow-up requests

1. The 390px dashboard capture reports protected Digital Twin controls below
   the 44px target: **Open 36×36px** and **Refresh 10×28px**. The same
   capture also reports 14px text for “Digital twin”, “—”, and “Aurora”;
   confirm each text node's owner. Please address protected-widget findings
   in the widget's owning layer, preserving its vehicle imagery, composition,
   actions, and keyboard behavior. Pack-owned selectors cannot change the
   `data-app-design-preserve` subtree.
2. The first desktop dashboard and energy captures timed out in
   `assertMockApiComplete` with `GET /api/v1/pinned` still pending. Please
   investigate the shared fixture/request lifecycle without bypassing the
   assertion or changing product behavior solely for capture. This may be
   intermittent; the first-round log is
   `docs\design-packs\shots\warm\round-1.log`.
