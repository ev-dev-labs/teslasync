# Signal Audit: Passenger Seat Belt

## Purpose

Passenger seat-belt telemetry is related to occupancy and safety. This page preserves handling expectations for signal parsing and alerting.

## Current expectations

- Differentiate buckled, unbuckled, no passenger/unknown, and stale states where Tesla data allows it.
- Avoid assuming occupancy from belt state alone.
- Keep alert templates clear about which seat is referenced.
- Preserve raw values for diagnostics.

## Verification checklist

1. Check catalog metadata and display label.
2. Check parser handling of all known values.
3. Check live-state/history API exposure.
4. Check Alert Studio signal picker and operators.
5. Check UI empty state for missing passenger data.