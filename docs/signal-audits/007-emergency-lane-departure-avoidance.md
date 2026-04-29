# Signal Audit: Emergency Lane Departure Avoidance

## Purpose

Emergency Lane Departure Avoidance is safety-critical. Changes to its ingestion or display should preserve raw value fidelity and explicit unknown handling.

## Current expectations

- Do not silently drop new Tesla enum values.
- Do not treat null/stale data as disabled or safe.
- Keep diagnostics, history, and alert-rule selection available.
- Use clear labels in UI and notifications.

## Verification checklist

1. Verify signal metadata and parser behavior.
2. Verify SignalStore/live-state propagation.
3. Verify historical query output.
4. Verify Alert Studio condition behavior.
5. Verify safety dashboard display for stale data.