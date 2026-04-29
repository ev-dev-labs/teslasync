# Signal Audit: Speed Limit Warning

## Purpose

Speed Limit Warning telemetry can influence safety alerts and driver-assistance diagnostics. This page keeps the audit expectations explicit.

## Current expectations

- Preserve raw warning state and parsed labels.
- Distinguish off, enabled, triggered, unknown, and stale values where possible.
- Use unit-aware display for speeds and thresholds.
- Keep the signal available in diagnostics, history, and Alert Studio.

## Verification checklist

1. Verify catalog metadata and units.
2. Verify parser behavior for every known Tesla value.
3. Verify live/history endpoint exposure.
4. Verify unit conversion in charts or UI summaries.
5. Verify alert copy is clear and not misleading.