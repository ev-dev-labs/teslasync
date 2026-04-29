# Backup and Restore

Backup and restore features are operational safety tools for self-hosted deployments. They complement, not replace, regular database and volume backups.

## What to back up

| Data | Why |
|---|---|
| PostgreSQL/TimescaleDB | Vehicles, tokens, settings, sessions, telemetry, alerts, exports |
| Redis | Optional runtime cache; persistent source remains database |
| Mosquitto data | MQTT persistence if enabled |
| Grafana data | Dashboards and Grafana state |
| MongoDB | Optional raw signal capture if enabled |
| Secrets | Tesla credentials, encryption keys, notification credentials, TLS material |

## App backup page

The admin backup page is for app-level export/restore workflows and visibility. Infrastructure-level backups should still be configured for databases and persistent volumes.

## Recommended practice

- Automate database dumps or volume snapshots.
- Test restore into a staging namespace/host.
- Keep credentials out of exported docs/logs.
- Verify migrations after restore.
- Capture Helm values and Compose `.env` alongside database backups.

## Restore validation

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
# Check migrations and table availability in psql
```