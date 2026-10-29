# Work queue — branch `fix/post-202-polish` (this branch's draft PR)

Master status file per `docs/agent-playbook.md` section 1. Status values:
`not started | in progress | done | blocked (reason)`.

## Bug 1: Drive detail shows same address for Start and Destination (non-round-trip)

- Status: in progress
- Example: production `/drives/555` — map route Canyon Park, Bothell → Redmond, but both Start and Destination show "19720 Bothell Everett Highway, Bothell". Positions correct; destination address wrong.
- Root cause: TBD — investigate drive end/address pipeline (record here once found).
- Next step: investigate Go drive end/address pipeline, reverse-geocoding/address cache, drive API response, and frontend drive detail fields.
- Fix: start/end addresses from own coordinates; failed/pending end lookup shows unavailable/pending (and coordinates if existing pattern), never start address.
- Tests: Go (different coords → different addresses; failed/pending end ≠ start; round trip same; cache key) + frontend (independent start/end rendering incl. unavailable).
- Data repair: idempotent command/job, dry-run, >0.5 km threshold, rate-limited, never round trips, logged. Do not run against production. Document dry-run-first runbook here once written.
- API contract change: none expected / TBD (record if any).

## Verification

- Status: not started
- Next step: go build/test, tsc, lint, affected frontend tests; commit, push, check `gh pr checks` on this branch's draft PR.
