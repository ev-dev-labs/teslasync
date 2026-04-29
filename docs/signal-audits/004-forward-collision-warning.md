# Signal Audit: Forward Collision Warning

## Purpose

This page preserves the audit trail for forward collision warning telemetry. It should be reviewed before changing safety-signal ingestion, alert templates, or diagnostics pages.

## Current expectations

- Preserve the raw signal value and the parsed display label.
- Do not coerce unknown values to false/safe.
- Make the signal available in live state, history, diagnostics, and Alert Studio.
- Treat notification copy as safety-sensitive and avoid ambiguous wording.

## Verification checklist

1. Check the signal catalog entry and category.
2. Check backend telemetry parsing and JSONB/live-state persistence.
3. Check `/signals/{vehicle_id}/available`, live, and history behavior.
4. Check alert rule evaluation with true, false, enum, null, and stale values.
5. Check frontend empty states for missing data.