# Drive road-anomaly analysis (experimental)

`GET /api/v1/drives/{driveID}/road-anomalies` reads the existing drive's
historical signal timeline. A positive drive ID is required; query parameters
are not supported. Like `GET /api/v1/drives/{driveID}`, it inherits the
parent `/api/v1` ForwardAuth gate and looks up the drive by ID; the drive's
stored `vehicle_id`, `start_ts`, and `end_ts` scope the signal read. Clients
cannot substitute another vehicle or time window. This deployment has one
global vehicle roster for authenticated operators, **not** per-driver or
per-vehicle permissions; do not mistake drive/vehicle association for an
additional driver authorization check. Drives longer than two hours return
`422 WINDOW_TOO_LARGE`.
The read times out after ten seconds and is capped at 100,000 raw emissions,
20,000 timeline rows, and 100 candidates; exceeding a telemetry cap returns
`insufficient_data`, never a partial detection list.

The `200` response is a **direct JSON object**, not a `data` envelope:

```json
{
  "drive_id": 7,
  "vehicle_id": 9,
  "from": "2026-09-25T11:59:00Z",
  "to": "2026-09-25T12:01:00Z",
  "status": "candidates",
  "reasons": [],
  "limitations": [
    "Possible road anomaly only; no vertical acceleration or road-surface sensor confirms potholes."
  ],
  "analyzed_samples": 3,
  "assessable_windows": 1,
  "candidates": [
    {
      "timestamp": "2026-09-25T12:00:00Z",
      "latitude": 37.1,
      "longitude": -122.1,
      "speed_mps": 15,
      "peak_longitudinal_g": 0.72,
      "delta_longitudinal_g": 0.71,
      "jerk_g_per_s": 3.9,
      "sample_interval_ms": 180,
      "classification": "possible_road_anomaly"
    }
  ]
}
```

`status` is exactly one of `insufficient_data`, `no_candidates`, or
`candidates`. `reasons` contains machine-readable codes when telemetry is
insufficient (e.g. `no_near_time_acceleration_with_fresh_speed_gps_and_lateral_context`,
`timeline_event_limit_exceeded`, `timeline_row_limit_exceeded`, or
`candidate_limit_exceeded`). `limitations` contains human-readable caveats.
`analyzed_samples` counts distinct, genuine longitudinal emissions with
numeric values; it does not count forward-filled emissions of other signals.
`assessable_windows` counts triples with eligible time, speed, GPS, lateral,
and brake context. `candidates` is always an array; it is empty for the
other two statuses.
Candidate coordinates are rounded to four decimal places, acceleration to
two, and speed/jerk to one decimal place; GPS and sensor accuracy are not
implied by those digits.

The detector only compares **actual** longitudinal-acceleration emissions:
baseline, impulse and recovery must occur within 450 ms of one another.
Historical acceleration is stored in m/s² and converted using standard gravity
(9.80665 m/s² per g); the response acceleration and thresholds are in **g**.
The impulse must reach at least 0.45 g
and differ from baseline and recovery by at least 0.35 g. Speed must be at
least 5 m/s, with GPS and lateral-acceleration emissions no older than one
second; latitude and longitude emissions must be within 500 ms of each other.
Observed braking, missing brake-state context, strong lateral acceleration,
and large observed speed changes suppress candidates. Nearby candidates are
coalesced over two seconds. A change-fed released brake remains the prevailing
state until a new emission; absent brake telemetry is not interpreted as released.

**Neither `no_candidates` with an empty candidate array nor a candidate confirms
the road surface.** Fleet Telemetry is a sparse change feed, and there is no
vertical suspension/road-surface sensor. Missing samples or stale context
produce `insufficient_data` rather than fabricated detections or
confidence scores. A candidate is never labeled a confirmed pothole.
