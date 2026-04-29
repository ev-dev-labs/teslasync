# Signal Audit: Automatic Emergency Braking Off

## Purpose

Automatic Emergency Braking state is safety-sensitive and should be handled with explicit value semantics.

## Current expectations

- The UI should distinguish enabled, disabled/off, unknown, and stale data.
- Alert rules should allow a high-severity notification when the feature is off if the user configures it.
- Backend parsing should preserve raw Tesla values for diagnostics.
- Missing telemetry must not be displayed as safe.

## Verification checklist

1. Verify signal catalog entry and parser mapping.
2. Verify telemetry ingestion and persistence.
3. Verify live/history endpoints.
4. Verify alert rule evaluation for off/unknown/stale states.
5. Verify notification copy includes vehicle and timestamp.