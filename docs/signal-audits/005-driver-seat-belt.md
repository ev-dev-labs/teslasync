# Signal Audit: Driver Seat Belt

## Purpose

Driver seat-belt telemetry can be used by safety dashboards and alerts. This page documents the current audit expectations for handling it safely.

## Current expectations

- Missing/stale seat-belt data must not be displayed as buckled.
- Enum/boolean parsing must match Tesla signal semantics.
- Alert rules should allow users to distinguish unbuckled, buckled, unknown, and stale states.
- UI copy should be factual and avoid alarmist language unless a rule explicitly configures severity.

## Verification checklist

1. Verify signal catalog metadata.
2. Verify parser output for all known values.
3. Verify live-state and history availability.
4. Verify Alert Studio condition options.
5. Verify notification templates mention vehicle and timestamp.