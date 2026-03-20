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
5. Check if TimescaleDB extension is installed: `docker compose exec postgres psql -U teslasync -c "SELECT default_version FROM pg_available_extensions WHERE name = 'timescaledb';"`

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
4. TimescaleDB chunk interval may need tuning for your data volume

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

1. Check the [GitHub Issues](https://github.com/teslasync-labs/TeslaSync/issues) for known bugs
2. Search the backend logs: `docker compose logs teslasync | grep -i error`
3. Open a new issue with:
   - TeslaSync version / commit hash
   - Docker Compose output (`docker compose ps`)
   - Relevant log output
   - Steps to reproduce
