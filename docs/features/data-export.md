# Data Export

TeslaSync allows you to export your vehicle data in multiple formats for analysis, backup, or integration with other tools. Exports can be performed synchronously (direct download) or asynchronously via a background worker.

## Async Export (Recommended)

Export processing is offloaded to a dedicated **export worker** service that communicates via MQTT. This prevents long-running exports from blocking the API server and provides real-time status tracking.

### How It Works

```
1. User submits export request  →  POST /api/v1/export/jobs
2. API creates job (status: queued)  →  publishes to MQTT topic
3. Export worker picks up job  →  status: processing
4. Worker generates file & stores in DB  →  status: ready (or failed)
5. User downloads the file  →  GET /api/v1/export/jobs/{id}/download
```

### Submit an Export Job

```bash
# Submit a drives export
curl -X POST http://localhost:8080/api/v1/export/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "drives", "format": "csv"}'

# Response:
# {
#   "id": "exp-1234567890",
#   "type": "drives",
#   "format": "csv",
#   "status": "queued",
#   "message": "Export job submitted successfully. Check status at /api/v1/export/jobs/exp-1234567890"
# }
```

### Check Job Status

```bash
# Get status of a specific job
curl http://localhost:8080/api/v1/export/jobs/exp-1234567890

# Response:
# {
#   "id": "exp-1234567890",
#   "type": "drives",
#   "format": "csv",
#   "status": "ready",
#   "file_name": "teslasync-drives.csv",
#   "file_size": 45231,
#   "record_count": 342,
#   "created_at": "2024-01-15T10:00:00Z",
#   "completed_at": "2024-01-15T10:00:05Z"
# }
```

### List All Jobs

```bash
curl http://localhost:8080/api/v1/export/jobs
```

### Download Completed Export

```bash
curl -o drives.csv http://localhost:8080/api/v1/export/jobs/exp-1234567890/download
```

### Job Status Flow

| Status | Description |
|--------|-------------|
| `queued` | Job submitted, waiting for worker to pick it up |
| `processing` | Worker is generating the export file |
| `ready` | Export complete, file available for download |
| `failed` | Export failed (check `error_message` for details) |

### Supported Job Types

| Type | Description | Format |
|------|-------------|--------|
| `drives` | Drive records with distance, duration, speed | CSV or JSON |
| `charging` | Charging sessions with energy, cost, duration | CSV or JSON |
| `backup` | Full database backup (all tables) | JSON only |
| `analytics` | Fleet analytics report (drive/charging/battery trends) | JSON only |

### Request Body

```json
{
  "type": "drives",          // Required: drives, charging, backup, analytics
  "format": "csv",           // Optional: csv (default) or json
  "vehicle_id": 123,         // Optional: filter to specific vehicle
  "start": "2024-01-01",     // Optional: date range start (ISO 8601)
  "end": "2024-01-31"        // Optional: date range end (ISO 8601)
}
```

### Async CSV Import

CSV files can be imported asynchronously via the export worker:

```bash
curl -X POST http://localhost:8080/api/v1/export/jobs/import \
  -F "type=import_drives" \
  -F "file=@drives.csv"
```

Supported import types: `import_drives`, `import_charging`.

### Database Backup via Export Worker

Database backups can also be submitted as async jobs, offloading the heavy I/O from the API server:

```bash
curl -X POST http://localhost:8080/api/v1/export/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "backup"}'
```

## Synchronous Export (Legacy)

The original synchronous export endpoint is still available for direct downloads:

```
GET /api/v1/export/{type}?format={csv|json}&start={date}&end={date}&vehicle_id={id}
```

### Available Export Types

| Type | Description | Key Fields |
|------|-------------|------------|
| `drives` | All drive records | date, distance, duration, battery, speed, efficiency |
| `charging` | Charging sessions | date, energy_added, cost, duration, charger_type |
| `positions` | GPS position history | timestamp, lat, lng, speed, power, battery_level |
| `battery` | Battery health snapshots | date, capacity, degradation, charge_cycles |
| `energy` | Energy consumption data | date, consumption, efficiency, cost |
| `alerts` | Alert history | date, type, severity, message, is_read |
| `mileage` | Daily/monthly mileage | date, distance, odometer |
| `vampire-drain` | Vampire drain events | date, duration, energy_lost, avg_drain_rate |

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | No | `csv` (default) or `json` |
| `start` | date | No | Start date filter (ISO 8601: `2024-01-01`) |
| `end` | date | No | End date filter (ISO 8601: `2024-01-31`) |
| `vehicle_id` | int | No | Filter to a specific vehicle |

### Examples

```bash
# Export all drives as CSV
curl "http://localhost:8080/api/v1/export/drives" > drives.csv

# Export charging sessions for January 2024 as JSON
curl "http://localhost:8080/api/v1/export/charging?format=json&start=2024-01-01&end=2024-01-31"

# Export GPS positions for a specific vehicle
curl "http://localhost:8080/api/v1/export/positions?vehicle_id=123&start=2024-01-01&end=2024-01-07"

# Export battery health data as CSV
curl "http://localhost:8080/api/v1/export/battery?format=csv" > battery_health.csv
```

### CSV Format

CSV exports include a header row with column names:

```csv
id,vehicle_id,start_date,end_date,distance,duration_min,start_battery_level,end_battery_level,speed_max
1,123,2024-01-15T08:00:00Z,2024-01-15T08:45:00Z,28.5,45,95,82,120
2,123,2024-01-15T17:00:00Z,2024-01-15T17:30:00Z,15.2,30,80,72,80
```

### JSON Format

JSON exports return an array of objects:

```json
[
  {
    "id": 1,
    "vehicle_id": 123,
    "start_date": "2024-01-15T08:00:00Z",
    "end_date": "2024-01-15T08:45:00Z",
    "distance": 28.5,
    "duration_min": 45,
    "start_battery_level": 95,
    "end_battery_level": 82,
    "speed_max": 120
  }
]
```

## UI Export

The **Settings** page (`/settings`) includes an export section where you can:

1. Select the data type to export
2. Choose the date range
3. Select the vehicle (or all vehicles)
4. Choose the format (CSV or JSON)
5. Click **Export** to download the file

Some individual pages also include export buttons:

- **Drives** page → Export drives table
- **Charging** page → Export charging sessions
- **Analytics** page → Export analytics report

## Data Analysis Tips

### Importing CSV into Spreadsheet Software

The exported CSV files are compatible with all major spreadsheet applications:

**Google Sheets:**
```
File → Import → Upload → Select CSV file
```

**Microsoft Excel:**
```
Data → Get Data → From File → From CSV
```

**LibreOffice Calc:**
```
File → Open → Select CSV file
```

### Using with Python

```python
import pandas as pd

# Load drives data
drives = pd.read_csv("drives.csv", parse_dates=["start_date", "end_date"])

# Calculate average efficiency
drives["efficiency"] = (drives["start_battery_level"] - drives["end_battery_level"]) / drives["distance"]
print(f"Average efficiency: {drives['efficiency'].mean():.2f} %/km")

# Monthly distance summary
drives["month"] = drives["start_date"].dt.to_period("M")
monthly = drives.groupby("month")["distance"].sum()
print(monthly)
```

### Using with Grafana

Export data as JSON and create custom Grafana dashboards, or query the database directly — Grafana is pre-configured with a PostgreSQL datasource.

## Database Direct Access

For advanced analysis, you can query the PostgreSQL database directly:

```bash
# Connect to the database
docker compose exec postgres psql -U teslasync -d teslasync

# Or from outside Docker
psql -h localhost -U teslasync -d teslasync
```

Useful queries:

```sql
-- Total distance driven per vehicle
SELECT v.display_name, SUM(d.distance) as total_km
FROM drives d JOIN vehicles v ON d.vehicle_id = v.id
GROUP BY v.display_name ORDER BY total_km DESC;

-- Average charging cost per month
SELECT DATE_TRUNC('month', start_date) as month,
       AVG(cost) as avg_cost,
       SUM(charge_energy_added) as total_kwh
FROM charging_sessions
GROUP BY month ORDER BY month;

-- Battery degradation over time
SELECT DATE_TRUNC('week', created_at) as week,
       AVG(rated_range) as avg_range
FROM positions
WHERE vehicle_id = 123 AND battery_level = 100
GROUP BY week ORDER BY week;

-- Most visited locations
SELECT name, visit_count, last_visited
FROM visited_locations
ORDER BY visit_count DESC LIMIT 10;
```

## Backup & Migration

### Full Database Backup

```bash
# Create a full database dump
docker compose exec postgres pg_dump -U teslasync teslasync > backup.sql

# Compressed backup
docker compose exec postgres pg_dump -U teslasync teslasync | gzip > backup.sql.gz
```

### Selective Backup

```bash
# Backup only drives and charging data
docker compose exec postgres pg_dump -U teslasync \
  -t drives -t charging_sessions teslasync > drives_charging.sql
```

### Restore

```bash
# Restore from backup
cat backup.sql | docker compose exec -T postgres psql -U teslasync teslasync
```

## Data Retention

TeslaSync automatically cleans up old data based on retention settings:

| Data Type | Default Retention | Config Variable |
|-----------|------------------|-----------------|
| General data | 365 days | `DATA_RETENTION_DAYS` |
| GPS positions | 90 days | `POSITION_RETENTION_DAYS` |

::: warning
Export your data before lowering retention values. Once the maintenance worker runs, deleted data cannot be recovered.
:::

The maintenance worker runs periodically in the background and logs when records are deleted.
