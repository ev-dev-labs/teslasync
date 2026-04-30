# FAQ

## Does TeslaSync require Fleet Telemetry?

No. Polling works out of the box after OAuth. Fleet Telemetry is recommended for lower-latency live state and lower API usage, but it requires more infrastructure.

## Do I need to expose the API directly?

For the normal web deployment, no separate public API service is needed. Expose the web service, keep `config.browserApiBase` empty, and let web/Nginx proxy `/api/` to the internal API service through `config.apiEndpoint`.

## Can I use Authentik or Authelia?

Yes. Configure your ingress middleware and set `FORWARD_AUTH_HEADER` / `config.forwardAuthHeader` to the header your proxy injects, such as `X-Authentik-Username`.

## What database should I use?

Use PostgreSQL 17 with TimescaleDB support. The bundled Compose stack uses `timescale/timescaledb-ha:pg17`; Helm can use embedded or external database services.

## Is Redis required?

Redis is part of the default stack and is used for fast live-state caching. Persistent data remains in the database.

## Is MongoDB required?

No. MongoDB is optional and intended for raw telemetry signal capture/debugging when enabled in Helm or equivalent deployment configuration.

## Can I install TeslaSync as an app?

Yes. The web UI is a PWA with a manifest, icons, update prompt, app-shell caching, and map/font caching. Live data still requires network access to the backend.

## Where are API routes defined?

Backend routes are in `internal/api/router.go`. Frontend hooks are in `web/src/api/hooks/`.

## Why are my API calls doubled as `/api/v1/api/v1`?

Frontend hooks should call `request('/vehicles')`, not `request('/api/v1/vehicles')`. The request client adds the prefix.

## How should I debug stale live state?

Check Fleet Telemetry/MQTT logs, Redis state, `vehicle_live_state`, SSE connection status, and whether the app has fallen back to polling.