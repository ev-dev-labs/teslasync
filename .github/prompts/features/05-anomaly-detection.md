# Feature: Anomaly Detection for Vehicle Health

## Context

TeslaSync already has:
- **`signal_history`** table: every telemetry signal stored with `value_num`, `signal`, `vehicle_id`, `created_at` (7-day retention)
- **`vehicle_live_state`** table: 229 signal columns, always-current values
- **`battery_snapshots`**: daily health metrics
- **`charging_telemetry`**: 55 columns of real-time charging data (pack voltage, cell voltages, module temps, BMS state)
- **`motor_snapshots`**: torque, stator temp, heatsink temp, inverter temp per motor
- **`tire_pressure_snapshots`**: per-tire pressure + TPMS warnings
- **`mv_signal_stats`** materialized view: per (vehicle, signal, hour) min/max/avg/count
- **CEP Rule Engine**: already evaluates conditions on every telemetry batch

## What to Build

An **anomaly detection system** that automatically identifies unusual signal values and generates health alerts.

### Backend — New endpoint: `GET /api/v1/analytics/anomalies?vehicle_id=X&days=7`

**Handler:** Create `internal/api/anomaly_handler.go`

1. **Statistical baseline per signal:**
   - Use `mv_signal_stats` to compute rolling 7-day mean and standard deviation per signal
   - Or compute from signal_history: `AVG(value_num)`, `STDDEV(value_num)` grouped by signal

2. **Anomaly detection methods:**

   a. **Z-score outliers**: Any signal value > 3σ from its rolling mean
   ```sql
   WITH stats AS (
     SELECT signal, AVG(value_num) AS mean, STDDEV(value_num) AS stddev
     FROM signal_history
     WHERE vehicle_id = $1 AND created_at > NOW() - INTERVAL '7 days'
     GROUP BY signal HAVING STDDEV(value_num) > 0
   )
   SELECT sh.signal, sh.value_num, sh.created_at,
          ABS(sh.value_num - s.mean) / s.stddev AS z_score
   FROM signal_history sh JOIN stats s ON sh.signal = s.signal
   WHERE sh.vehicle_id = $1 AND ABS(sh.value_num - s.mean) / s.stddev > 3
   ORDER BY sh.created_at DESC LIMIT 100
   ```

   b. **Range violations**: Predefined safe ranges for critical signals:
   ```go
   var safeRanges = map[string][2]float64{
     "BatteryLevel":       {0, 100},
     "PackVoltage":        {300, 420},
     "ModuleTempMax":      {-20, 55},
     "ModuleTempMin":      {-20, 55},
     "TpmsPressureFl":     {2.0, 3.5},  // bar
     "TpmsPressureFr":     {2.0, 3.5},
     "TpmsPressureRl":     {2.0, 3.5},
     "TpmsPressureRr":     {2.0, 3.5},
     "InsideTemp":         {-30, 60},
     "OutsideTemp":        {-40, 60},
     "DiStatorTempF":      {-20, 150},
     "DiStatorTempR":      {-20, 150},
     "IsolationResistance": {500, 99999},  // low isolation = dangerous
   }
   ```

   c. **Trend anomalies**: Sudden changes in rolling averages:
   - Compare last 24h average vs previous 7d average
   - Flag if deviation > 2σ of the 7d distribution
   - Key signals: BatteryLevel (at rest), TirePressure (slow leak detection), PackVoltage

3. **Severity classification:**
   - **Critical**: safety-related (isolation resistance low, extreme temps, tire pressure drop >0.5 bar)
   - **Warning**: performance degradation (capacity drop, motor temp trending up)
   - **Info**: unusual but not dangerous (charging slower than usual, efficiency drop)

4. **Response shape:**
```json
{
  "anomalies": [
    {
      "signal": "TpmsPressureRl",
      "type": "trend",
      "severity": "warning",
      "value": 2.15,
      "baseline": 2.85,
      "z_score": 3.2,
      "detected_at": "2026-04-15T14:30:00Z",
      "message": "Rear-left tire pressure dropped 25% over 3 days — possible slow leak"
    },
    ...
  ],
  "health_summary": {
    "battery": "normal",
    "tires": "warning",
    "motors": "normal",
    "hvac": "normal",
    "charging": "normal"
  },
  "signals_monitored": 45,
  "anomalies_last_7d": 3,
  "anomalies_last_24h": 1
}
```

### Frontend — New page: `AnomalyDashboardPage.tsx`

Create `web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx`:

1. **Health summary cards** — battery/tires/motors/hvac/charging with green/amber/red status
2. **Anomaly timeline** — chronological list of detected anomalies with severity badges
3. **Signal spotlight** — click an anomaly to see the signal's recent chart with the anomaly point highlighted (use existing signal_history API)
4. **Anomaly heatmap** — which signals trigger most anomalies (bar chart)

Add to router (`App.tsx`) and side nav under **Diagnostics**.

### Key Files
- Create: `internal/api/anomaly_handler.go`
- Wire in: `internal/api/router.go`
- Create: `web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx`
- Add route: `web/src/App.tsx`
- Add nav item: sidebar config
- Query: `signal_history`, `mv_signal_stats`, `tire_pressure_snapshots`, `motor_snapshots`

### Technical Notes
- Z-score requires > 30 data points per signal for statistical validity — skip signals with fewer
- Safe ranges are conservative defaults — could be made configurable later
- Run anomaly detection on-demand (API call), not as background job (avoids complexity)
- Consider caching results for 5 minutes (Redis) to avoid expensive queries on refresh
- The CEP rule engine could also fire alerts for detected anomalies — wire into existing alert system later
