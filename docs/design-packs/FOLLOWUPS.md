# Design pack follow-ups

The resumed repair request on 2026-11-16 supersedes the earlier deferrals.
Reviewed contrast nodes and shared token-consumer gaps now have measured
repair evidence in FIXLIST.md and DECISIONS.md. The exact desktop restoration
gate and any current CI failures remain active work in FIXLIST.md, not
accepted deferrals.

The incomplete historical full-page screenshot gallery is not a demonstrated
product defect or authorization for a new matrix. Existing screenshots are
historical evidence from mixed builds, not a claim
that every route and viewport passed on the final commit. No redesign, new
test matrix, or bulk screenshot regeneration is authorized.

## Shared preview's live Tesla authorization

The rebuilt `5e23bbb1ca` frontend is healthy on loopback 3120. Index, entry
asset, `/api/v1/system/auth-mode`, `/healthz` and `/readyz` return 200.
The shared backend's aggregate `/api/v1/system/health` and `/system/status`
return 503: the latter explicitly reports `tesla_api.status=no_token`,
`breaker=closed` and Fleet Telemetry disabled. Database, Redis and MQTT
report healthy. These observations were taken on 2026-11-16 after deployment.

The application deliberately reports a missing/expired Tesla token as a health
failure (`internal/app/new.go:1720-1726`); the status handler exposes the same
authorization condition (`internal/api/health.go:244-247`). A frontend branch
cannot supply the vehicle owner's OAuth authorization or enable the separate
shared telemetry deployment. Doing so requires authorized environment setup,
not fabricated credentials, altered health thresholds or redeploying another
user's service. No live Tesla functionality is claimed by the synthetic browser
checks. This is the only proven external prerequisite currently recorded.

Other unresolved items remain in FIXLIST.md, not reclassified as impossible
because an earlier session deferred them.
