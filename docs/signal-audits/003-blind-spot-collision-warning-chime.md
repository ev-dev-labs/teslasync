# Signal Audit: Blind Spot Collision Warning Chime

## Purpose

This historical audit record tracks how TeslaSync handles the blind-spot collision warning chime signal family. Keep the page as a safety-signal reference when changing Fleet Telemetry ingestion, signal catalog metadata, Alert Studio options, or safety dashboards.

## Current expectations

- The signal should appear in the signal catalog with a clear safety category and human-readable label.
- Live state should flow through telemetry ingestion, SignalStore, persisted state/history, and SSE updates.
- Alert rules should treat safety signals as high-importance signals and avoid silent failures.
- UI pages should show unknown/missing data explicitly rather than implying a safe state.

## Verification checklist

1. Confirm the Tesla signal name and enum/value mapping in `web/src/lib/signalCatalog.ts`.
2. Confirm backend ingestion handles the signal without dropping unknown enum values.
3. Confirm history/live endpoints can expose the signal for diagnostics.
4. Confirm alert rules can reference the signal and notification text is unambiguous.
5. Confirm test data does not claim a collision-warning state unless generated intentionally.
