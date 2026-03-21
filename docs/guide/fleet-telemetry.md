# Fleet Telemetry

Tesla Fleet Telemetry is an alternative to the standard polling approach. Instead of TeslaSync periodically requesting data from the Tesla Fleet API, vehicles **push** data directly to a telemetry server via a persistent streaming connection.

## Why Fleet Telemetry?

| Feature | Polling (default) | Fleet Telemetry |
|---|---|---|
| Data resolution | 30 s (driving) | **~1 s** |
| API cost (per vehicle/month) | ~$15–25 | **~$0.50** |
| Latency | Poll interval dependent | **Near real-time** |
| Wake-up required | Yes | No (streams when online) |
| Setup complexity | Low | Medium |

### Cost Comparison

With standard polling TeslaSync makes thousands of Fleet API requests per month per vehicle. Tesla charges ~$0.00222 per request, so a single vehicle can cost **$15–25/month** depending on driving habits.

Fleet Telemetry replaces most of those requests with a single persistent connection. You still need a handful of API calls for commands and initial setup, but data ingestion is essentially **free** — reducing costs by up to **97%**.

## Architecture

```
┌──────────┐        wss        ┌────────────────────┐
│  Vehicle  │ ──────────────▶  │  Fleet Telemetry   │
│  (Tesla)  │   streaming      │  Server            │
└──────────┘                   └────────┬───────────┘
                                        │  protobuf / JSON
                                        ▼
                               ┌────────────────────┐
                               │    TeslaSync        │
                               │    (consumer)       │
                               └────────────────────┘
```

The Fleet Telemetry server is a separate process that Tesla's vehicles connect to. TeslaSync subscribes to the telemetry stream to ingest data.

## Setup Guide

### Prerequisites

- A **Tesla Developer account** with Fleet Telemetry access
- A domain with a valid **TLS certificate** (vehicles connect via `wss://`)
- A server reachable from the internet (or via Tesla's proxy)

### Step 1 — Deploy the Telemetry Server

Clone and deploy the official telemetry server:

```bash
git clone https://github.com/teslamotors/fleet-telemetry.git
cd fleet-telemetry
# Follow the README for build & deployment instructions
```

The server listens for incoming WebSocket connections from vehicles and forwards records to a configurable datastore.

### Step 2 — Configure Your Tesla Developer Account

1. Log in to [developer.tesla.com](https://developer.tesla.com)
2. Navigate to your application settings
3. Add your telemetry server's public URL as the **Fleet Telemetry endpoint**
4. Ensure the endpoint uses `wss://` and has a valid TLS certificate

### Step 3 — Pair Vehicles

Each vehicle must be paired with your telemetry server. Use the Tesla Fleet API:

```bash
curl -X POST "https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles/{id}/fleet_telemetry_config" \
  -H "Authorization: Bearer $TESLA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vins": ["YOUR_VIN"],
    "config": {
      "hostname": "telemetry.example.com",
      "port": 443,
      "ca": "... your CA cert ...",
      "fields": {
        "VehicleSpeed": { "interval_seconds": 1 },
        "Location": { "interval_seconds": 1 },
        "BatteryLevel": { "interval_seconds": 10 },
        "ChargeState": { "interval_seconds": 10 }
      }
    }
  }'
```

### Step 4 — Configure TeslaSync

In the TeslaSync **Settings** page, enable **Fleet Telemetry (Beta)** and enter your telemetry server URL (e.g., `wss://telemetry.example.com`).

TeslaSync will subscribe to the telemetry stream and automatically ingest data when vehicles are online.

### Step 5 — Verify

Once a vehicle is online and paired, data should begin streaming within seconds. Check the TeslaSync dashboard for real-time updates with 1-second resolution.

## Telemetry Fields

Fleet Telemetry supports a wide range of vehicle data fields:

| Field | Description | Typical Interval |
|---|---|---|
| `VehicleSpeed` | Current speed | 1 s |
| `Location` | GPS coordinates | 1 s |
| `BatteryLevel` | State of charge (%) | 10 s |
| `ChargeState` | Charging status | 10 s |
| `Odometer` | Total distance | 60 s |
| `InsideTemp` | Cabin temperature | 30 s |
| `OutsideTemp` | Ambient temperature | 30 s |
| `TirePressure` | All four tires | 60 s |

## Troubleshooting

### Vehicle not connecting
- Ensure your TLS certificate is valid and the domain resolves correctly
- Check that the vehicle has been paired via the Fleet API
- Vehicles only stream when **online** — a sleeping vehicle will not connect

### Data not appearing in TeslaSync
- Verify the telemetry server URL in Settings matches your deployment
- Check the telemetry server logs for incoming connections
- Ensure TeslaSync can reach the telemetry server (network/firewall rules)

### High latency
- Fleet Telemetry should deliver sub-second latency
- If latency is high, check network conditions between the telemetry server and TeslaSync
