# Signal Audit: Lane Departure Avoidance

## Purpose

Lane Departure Avoidance is a driver-assistance safety signal. Keep this audit record aligned with telemetry parsing, diagnostics, and alert behavior.

## Current expectations

- Preserve enum labels exactly enough for diagnostics.
- Show disabled/off/unknown states distinctly.
- Avoid converting missing data to an enabled or disabled state.
- Keep signal names searchable in diagnostics and Alert Studio.

## Verification checklist

1. Validate catalog name, category, type, and description.
2. Validate telemetry ingestion with representative enum values.
3. Validate persisted history and live API exposure.
4. Validate UI rendering for unknown/stale values.
5. Validate alert rule text and notification severity mapping.