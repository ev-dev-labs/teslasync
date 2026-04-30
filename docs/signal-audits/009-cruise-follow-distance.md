# Signal Audit: Cruise Follow Distance

## Purpose

Cruise follow distance is a driver-assistance preference/safety signal. Keep this record as a guide for preserving unit/value semantics.

## Current expectations

- Preserve numeric/enum values without arbitrary unit conversion unless documented.
- Display unknown/stale data explicitly.
- Make the signal searchable in diagnostics and available to Alert Studio.
- Avoid presenting historical values as current state.

## Verification checklist

1. Verify catalog type and unit metadata.
2. Verify parsing of numeric and enum variants.
3. Verify live-state/history availability.
4. Verify chart/diagnostics labels.
5. Verify alert conditions do not mis-handle zero or null.