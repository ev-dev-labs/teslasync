# Ledgers — durable loop state (the ONLY source of truth)

Each phase writes one JSON ledger here; the loop re-derives all progress from these files so it
survives context compaction. Do not hand-edit while a loop is running.

- `e0-foundation-ledger.json`
- `e1-integration-ledger.json`
- `e2-desktop-parity-ledger.json`
- `e5-hardening-ledger.json`

Drop a file named `STOP-electron-loop` (any contents) in this directory to halt all loops at the
next iteration boundary.
