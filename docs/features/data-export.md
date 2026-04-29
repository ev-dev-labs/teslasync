# Data Export

Data export lets you extract TeslaSync data for analysis, reporting, support, and archival workflows.

## Export areas

| Area | Examples |
|---|---|
| Drives | Sessions, positions, telemetry, scores |
| Charging | Sessions, telemetry, Tesla billing history |
| Vehicles | Fleet inventory and current state snapshots |
| Signals | Signal history, diffs, and gaps |
| Alerts | Alert history and notification logs |
| Admin | API logs and operational records where supported |

## Worker model

Large exports are handled asynchronously by the export worker. The UI should show job state, progress, errors, and download links instead of blocking the browser request.

## Formats

The frontend and backend include helpers for CSV/JSON-style exports. Use shared export utilities so dates, numbers, and null values are represented consistently.

## Security

Exports can contain locations, VINs, tokens, and private telemetry. Protect export routes with authentication and avoid emailing raw exports unless the destination is trusted.