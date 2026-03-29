# Troubleshooting

Common issues and their solutions when running TeslaSync.

## Connection Issues

### Backend Not Reachable

**Symptom:** Frontend shows "Unable to reach the server" or connection timeout errors.

**Solutions:**
1. Verify the backend is running: `docker compose ps`
2. Check backend logs: `docker compose logs teslasync`
3. Ensure port 8080 is not blocked by a firewall
4. Verify the `TESLASYNC_PORT` environment variable matches the frontend proxy config

### Tesla API Authentication Failure

**Symptom:** "Failed to authenticate" error when connecting Tesla account.

**Solutions:**
1. Verify `TESLA_CLIENT_ID` and `TESLA_CLIENT_SECRET` in `.env`
2. Ensure `TESLA_REDIRECT_URI` matches the registered callback URL in the Tesla Developer portal
3. Check if your Tesla API tokens have expired — try the "Refresh" button in Settings
4. Tesla's API may be temporarily down — check [Tesla API status](https://developer.tesla.com)

### Database Connection Failure

**Symptom:** Backend starts but logs show "failed to connect to database".

**Solutions:**
1. Ensure PostgreSQL is running: `docker compose ps postgres`
2. Check PostgreSQL logs: `docker compose logs postgres`
3. Verify credentials: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` in `.env`
4. For external databases, verify `POSTGRES_HOST` and `POSTGRES_PORT`
5. Check PostgreSQL is accepting connections: `docker compose exec postgres psql -U teslasync -c "SELECT version();"`

## Performance Issues

### High Memory Usage

**Symptom:** Backend memory grows over time.

**Solutions:**
1. Reduce `POSITION_RETENTION_DAYS` (default 90) to keep fewer GPS points
2. Lower `POLL_INTERVAL` to reduce data collection frequency
3. Check for connection pool leaks in logs
4. Docker resource limits are set in `docker-compose.yml` — increase if needed

### Slow Dashboard Loading

**Symptom:** Pages take several seconds to load.

**Solutions:**
1. Enable Redis caching — ensure Redis is running: `docker compose ps redis`
2. Reduce the default date range for analytics queries
3. Add database indexes for frequently queried columns (check migration files)
4. Consider adding indexes for frequently queried columns (check migration files)

### Port Conflicts (Windows)

**Symptom:** Docker containers fail to start with "port already in use" errors.

**Solutions:**
1. Check for Hyper-V port exclusions: `netsh interface ipv4 show excludedportrange protocol=tcp`
2. Change conflicting ports in `docker-compose.yml`
3. Stop other services using the same ports

## Data Issues

### Missing Vehicle Data

**Symptom:** Vehicle appears in the list but shows no data.

**Solutions:**
1. Check if the vehicle is asleep — use the "Wake" button on the Commands page
2. Verify the polling worker is running: check backend logs for "polling vehicle" messages
3. The first poll after connecting takes ~30 seconds to populate data
4. Some data (drives, charges) requires the vehicle to actually drive or charge before appearing

### Vampire Drain Not Detected

**Symptom:** No vampire drain events appear.

**Solutions:**
1. Vampire drain detection requires the vehicle to be parked for at least 1 hour
2. Ensure the poller is running during overnight parking periods
3. Check `WORKER_SLEEP_POLL_MULT` — a high value means less frequent sleeping-vehicle polls

### Incorrect Charging Costs

**Symptom:** Charging costs show $0 or incorrect values.

**Solutions:**
1. Set the base cost per kWh in Settings
2. For location-based pricing, create a geofence around your charger and set `cost_per_kwh`
3. Supercharger costs are estimated — actual costs may vary

## Notification Issues

### Notifications Not Sending

**Symptom:** Alert rules trigger but no notifications arrive.

**Solutions:**
1. Verify the notification channel is enabled (toggle on the Notifications page)
2. Test the channel using the "Test" button
3. Check notification logs on the Notifications page for error details
4. For webhooks: verify the URL is reachable from the Docker network
5. For Discord/Slack: ensure the webhook URL is still valid (they can expire)

### Duplicate Notifications

**Symptom:** Receiving the same notification multiple times.

**Solutions:**
1. Check if multiple alert rules overlap (e.g., two rules for low battery at different thresholds)
2. Verify `POLL_INTERVAL` — very frequent polling can trigger alerts repeatedly
3. Alert rules have a built-in cooldown period — if you see rapid duplicates, report it as a bug

## Docker Issues

### Container Keeps Restarting

**Symptom:** `docker compose ps` shows a container restarting.

**Solutions:**
1. Check container logs: `docker compose logs <service-name>`
2. Verify environment variables are set correctly in `.env`
3. For PostgreSQL: ensure the data volume is not corrupted — try `docker compose down -v` and re-create (⚠️ deletes data)
4. Check resource limits in `docker-compose.yml` — containers may be OOM-killed

### Docker Build Fails

**Symptom:** `docker compose build` fails.

**Solutions:**
1. Ensure Docker Desktop has sufficient resources (4+ GB RAM)
2. Clear Docker build cache: `docker builder prune`
3. Check if Go module downloads are failing (network/proxy issues)
4. For frontend builds: ensure `node_modules` is in `.dockerignore`

## Grafana Issues

### Dashboards Show "No Data"

**Symptom:** Grafana panels show "No data" even though the app has data.

**Solutions:**
1. Verify the PostgreSQL datasource is configured: Grafana → Connections → Data Sources
2. Check datasource credentials match `POSTGRES_USER` / `POSTGRES_PASSWORD`
3. Adjust the time range in Grafana (top-right corner) — default may be too narrow
4. The datasource should connect to `postgres:5432` (Docker internal hostname), not `localhost`

## Getting Help

If your issue isn't covered here:

1. Check the [GitHub Issues](https://github.com/ev-dev-labs/TeslaSync/issues) for known bugs
2. Search the backend logs: `docker compose logs teslasync | grep -i error`
3. Open a new issue with:
   - TeslaSync version / commit hash
   - Docker Compose output (`docker compose ps`)
   - Relevant log output
   - Steps to reproduce

## Kubernetes / Helm Deployment Issues

### Fleet Telemetry Pod — ImagePullBackOff

**Symptom:** `teslasync-fleet-telemetry` pod stuck in `ImagePullBackOff` or `ErrImagePull`.

```
Failed to pull image "ghcr.io/teslamotors/fleet-telemetry:latest": 403 Forbidden
```

**Cause:** The fleet-telemetry image is on Docker Hub, not GHCR.

**Fix:** Ensure your values.yaml uses the Docker Hub image:
```yaml
fleetTelemetry:
  image: tesla/fleet-telemetry:latest   # Docker Hub, NOT ghcr.io
```

### Fleet Telemetry Pod — FailedMount (TLS Secret Not Found)

**Symptom:** `teslasync-fleet-telemetry` stuck in `ContainerCreating` with:
```
MountVolume.SetUp failed for volume "tls": secret "production-cyphers-app-tls" not found
```

**Cause:** The TLS secret exists in a different namespace.

**Fix:** Copy the secret to the TeslaSync namespace:
```bash
# Find where the secret lives
kubectl get secrets --all-namespaces | grep your-tls-secret-name

# Copy to teslasync namespace
kubectl get secret your-tls-secret-name -n SOURCE_NAMESPACE -o yaml | \
  sed 's/namespace: .*/namespace: teslasync/' | \
  kubectl apply -n teslasync -f -
```

### Command Proxy — CrashLoopBackOff ("Could not get working directory")

**Symptom:** `teslasync-command-proxy` in `CrashLoopBackOff` with log:
```
{"_l":"ERR", "_m":"Could not get working directory"}
```

**Cause:** Tesla's vehicle-command image requires a writable filesystem. The global `securityContext.readOnlyRootFilesystem: true` prevents this.

**Fix:** This is fixed in the Helm chart (v0.6.0+). If you see this on an older version, upgrade the chart or override:
```bash
helm upgrade teslasync ./helm/teslasync -n teslasync -f values.yaml
```

### Command Proxy — Missing TLS Certificate Files

**Symptom:** Command proxy starts but fails to serve HTTPS, or vehicles reject commands.

**Cause:** The `tesla-command-proxy` secret needs three files: `private-key.pem`, `tls-cert.pem`, and `tls-key.pem`.

**Fix:** Create the secret with all three files:
```bash
# Get TLS cert/key from your existing wildcard cert secret
kubectl get secret your-tls-secret -n teslasync -o jsonpath='{.data.tls\.crt}' | base64 -d > /tmp/tls-cert.pem
kubectl get secret your-tls-secret -n teslasync -o jsonpath='{.data.tls\.key}' | base64 -d > /tmp/tls-key.pem

# Create the command proxy secret with all 3 files
kubectl create secret generic tesla-command-proxy \
  --from-file=private-key.pem=/path/to/your/private-key.pem \
  --from-file=tls-cert.pem=/tmp/tls-cert.pem \
  --from-file=tls-key.pem=/tmp/tls-key.pem \
  -n teslasync

# Restart the proxy
kubectl rollout restart deployment teslasync-command-proxy -n teslasync

# Clean up temp files
rm /tmp/tls-cert.pem /tmp/tls-key.pem
```

The `private-key.pem` is the same ECDSA P-256 key you generated in TeslaSync DevTools (or via `openssl ecparam -name prime256v1 -genkey`). The TLS cert/key can be your wildcard certificate.

### Traefik IngressRouteTCP — Fleet Telemetry Not Reachable

**Symptom:** Vehicles cannot connect to `telemetry.yourdomain.com`, or `curl` to the telemetry host times out.

**Cause:** Traefik needs to handle TLS passthrough for fleet telemetry (vehicles use mTLS with client certificates).

**Fix:**
1. Ensure DNS for `telemetry.yourdomain.com` points to the same IP as your main app
2. Verify the IngressRouteTCP is created:
   ```bash
   kubectl get ingressroutetcp -n teslasync
   ```
3. Check Traefik logs for routing issues:
   ```bash
   kubectl logs -n traefik -l app.kubernetes.io/name=traefik | grep telemetry
   ```
4. If using the same `websecure` entrypoint (port 443) for both the main app and fleet telemetry, Traefik differentiates by `HostSNI`. Verify both routes exist:
   ```bash
   kubectl get ingressroute,ingressroutetcp -n teslasync
   ```
   You should see:
   - `IngressRoute` for `teslasync.yourdomain.com` (HTTP, TLS terminated)
   - `IngressRouteTCP` for `telemetry.yourdomain.com` (TCP, TLS passthrough)

### Pods Running But No Telemetry Data

**Symptom:** Fleet telemetry pod is running, but no data appears in TeslaSync.

**Debug steps:**
```bash
# 1. Check fleet telemetry logs
kubectl logs -n teslasync -l app.kubernetes.io/component=fleet-telemetry

# 2. Check if MQTT messages are flowing
kubectl exec -n teslasync deploy/teslasync-api -- env | grep MQTT

# 3. Check TeslaSync API telemetry status
curl https://yourdomain.com/api/v1/telemetry

# 4. Verify vehicle subscription
curl https://yourdomain.com/api/v1/dev-tools/fleet-telemetry-config

# 5. Check Tesla's fleet telemetry errors endpoint
curl -H "Authorization: Bearer $TOKEN" \
  https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/partner/fleet_telemetry_errors
```

### General: Check Pod Status and Logs

```bash
# All pods
kubectl get pods -n teslasync

# Specific component logs
kubectl logs -n teslasync -l app.kubernetes.io/component=api
kubectl logs -n teslasync -l app.kubernetes.io/component=fleet-telemetry
kubectl logs -n teslasync -l app.kubernetes.io/component=command-proxy
kubectl logs -n teslasync -l app.kubernetes.io/component=web

# Describe failing pod for events
kubectl describe pod -n teslasync POD_NAME | tail -30

# Check secrets exist
kubectl get secrets -n teslasync
```
