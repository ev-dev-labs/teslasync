# Troubleshooting

## Web UI loads but API calls fail

Check the browser network tab. If requests go to `/api/v1/api/v1/...`, a frontend hook included the prefix incorrectly. Hooks should call paths like `/vehicles` because `request()` adds `/api/v1`.

For Kubernetes same-origin routing, keep:

```yaml
config:
  apiEndpoint: "http://teslasync-api.namespace.svc.cluster.local:8080"
  browserApiBase: ""
```

## Auth redirects loop

- Confirm the public app URL matches `TESLA_REDIRECT_URI` and Authentik/ForwardAuth provider settings.
- Confirm `config.forwardAuthHeader` matches the header injected by your proxy.
- Check that public token routes and `/.well-known` routes are intentionally exempted where required.

## PWA shows stale content

- Build with the current PWA config.
- Clear old localhost service workers if you previously ran dev PWA mode.
- Confirm `/sw.js` is served with no-cache headers.
- Keep `VITE_PWA_DEV` unset unless intentionally testing service workers in development.

## Live data is stale

Check in this order:

1. Fleet Telemetry server logs or polling worker logs.
2. MQTT broker connectivity.
3. Redis/live state updates.
4. `vehicle_live_state` updates.
5. SSE connection in browser devtools.
6. Frontend hook fallback polling.

## Tesla public key verification fails

`/.well-known/appspecific/com.tesla.3p.public-key.pem` must be reachable over public HTTPS without app auth. In Traefik, create a higher-priority `PathPrefix('/.well-known')` route to the web service with only security headers.

## Helm install renders but app cannot reach API

- `config.apiEndpoint` is for Nginx and may be an internal service DNS name.
- `config.browserApiBase` is for the browser and should usually be empty.
- The API and web services should be `ClusterIP` unless you intentionally expose them.
- If you removed the direct `/api -> api` ingress route, verify web/Nginx has the `/api/` proxy location.

## Database migration issues

```bash
docker compose logs teslasync-api | grep -i migration
kubectl logs deployment/teslasync-api | grep -i migration
```

Verify extension availability:

```sql
SELECT extname FROM pg_extension WHERE extname IN ('timescaledb', 'vector', 'pg_stat_statements');
```

## Frontend build errors

```bash
cd web
npm install
npx tsc --noEmit
npm run build
```

Most errors come from API type mismatches, missing null checks, or importing directly from chart/map libraries instead of shared barrels.

## Docs build errors

```bash
cd docs
npm install
npm run docs:build
```

If Mermaid diagrams fail, check code fences and quote labels containing special characters.