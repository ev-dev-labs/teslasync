# Database seeds

Canonical home for hand-authored SQL seed files used by local dev,
docker-compose smoke tests, and the demo profile. Production NEVER
runs these — production data flows in via the Tesla Fleet API + Fleet
Telemetry pipeline (see `docs/architecture/`).

| File | Purpose |
|---|---|
| `seed.sql` | Minimal demo dataset — small vehicle, ~1 week of data. Default for `make seed`. |
| `seed_003.sql` | Vehicle id=3 dataset (multi-vehicle smoke). |
| `seed_large.sql` | Larger dataset (~30 days, multiple drives/charges). For perf-shape testing. |
| `seed_comprehensive.sql` | Full 6-year Model Y dataset (2020-01-01 → 2026-03-31). Heavy. |
| `seed_snapshots.sql` | Snapshot-table seeds (positions / climate_snapshots / security_events) for handler smoke tests. |

## Running a seed

```bash
# Local dev (TimescaleDB running via docker-compose):
docker exec -i teslasync-postgres psql -U teslasync -d teslasync < db/seeds/seed.sql

# Comprehensive (large; use COPY-style):
docker cp db/seeds/seed_comprehensive.sql teslasync-postgres:/tmp/seed.sql
docker exec teslasync-postgres psql -U teslasync -d teslasync -f /tmp/seed.sql
```

## Adding a new seed

1. Name `seed_<purpose>.sql`. Use BEGIN/COMMIT envelope.
2. Idempotent: prefer `TRUNCATE` then `INSERT`, or `ON CONFLICT DO NOTHING`.
3. Document under the table above + add a short comment block at the
   top of the file (purpose, vehicle ids touched, expected row counts).
4. Never include PII or real VINs — use `5YJ...DEMO###` style.

## What does NOT belong here

- Migration SQL → `migrations/`
- Auto-generated test fixtures → `tests/fixtures/`
- Production data dumps → never commit; gitignored.
