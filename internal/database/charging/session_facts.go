package charging

import (
	"context"
	"fmt"

	chargingdomain "github.com/ev-dev-labs/teslasync/internal/domain/charging"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
)

// LoadSessionFacts batches metadata and bounded change-feed aggregates. It
// neither reconstructs point-in-time state nor writes historical repairs.
func (r *ChargingRepo) LoadSessionFacts(ctx context.Context, sessions []*chargingmodel.ChargingSession) (map[int64]chargingdomain.SessionFacts, error) {
	facts := make(map[int64]chargingdomain.SessionFacts, len(sessions))
	if len(sessions) == 0 {
		return facts, nil
	}
	ids := make([]int64, 0, len(sessions))
	for _, session := range sessions {
		ids = append(ids, session.ID)
	}
	rows, err := r.db.Pool.Query(ctx, `
SELECT c.id, COALESCE(g.category = 'home', false),
       COALESCE((SELECT value_num / 1000 FROM settings WHERE key = 'base_cost_per_kwh'), 0)::float8,
       b.total_due, b.currency_code, b.usage_wh, COALESCE(b.site_location_name, ''), COALESCE(b.id, 0)
FROM charging_sessions c
JOIN vehicles v ON v.id = c.vehicle_id
LEFT JOIN geofences g ON g.id = c.geofence_id
LEFT JOIN LATERAL (
    SELECT id, total_due, currency_code, usage_wh, site_location_name, COUNT(*) OVER () AS matches
    FROM tesla_charging_history
    WHERE vin = v.vin AND c.ended_at IS NOT NULL
      AND charge_start_datetime BETWEEN c.started_at - INTERVAL '10 minutes' AND c.started_at + INTERVAL '10 minutes'
      AND charge_start_datetime <= c.ended_at
      AND charge_stop_datetime >= c.started_at
) b ON b.matches = 1
WHERE c.id = ANY($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("load charging metadata: %w", err)
	}
	for rows.Next() {
		var id int64
		var fact chargingdomain.SessionFacts
		if err := rows.Scan(&id, &fact.IsHome, &fact.DefaultRatePerWh, &fact.InvoiceCost,
			&fact.InvoiceCurrency, &fact.InvoiceEnergyWh, &fact.InvoiceSite, &fact.InvoiceID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan charging metadata: %w", err)
		}
		facts[id] = fact
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, fmt.Errorf("read charging metadata: %w", err)
	}
	rows, err = r.db.Pool.Query(ctx, `
SELECT c.id,
       COALESCE(ARRAY_AGG(DISTINCT s.str_value) FILTER (WHERE s.field = 'FastChargerType' AND s.str_value IS NOT NULL), '{}'),
       COALESCE(BOOL_OR(s.bool_value) FILTER (WHERE s.field = 'FastChargerPresent'), false),
       COALESCE(MAX(COALESCE(s.float_value, s.int_value::float8)) FILTER (WHERE s.field = 'ACChargingPower'), 0),
       COALESCE(MAX(COALESCE(s.float_value, s.int_value::float8)) FILTER (WHERE s.field = 'DCChargingPower'), 0),
       COALESCE(MAX(COALESCE(s.float_value, s.int_value::float8)) FILTER (WHERE s.field = 'ChargerPhases'), 0)::int,
       COALESCE(MAX(COALESCE(s.float_value, s.int_value::float8)) FILTER (WHERE s.field = 'ChargerVoltage'), 0)
FROM charging_sessions c
JOIN signal_log s ON s.vehicle_id = c.vehicle_id AND s.ts >= c.started_at
    AND s.ts <= COALESCE(c.ended_at, CURRENT_TIMESTAMP)
    AND s.field IN ('FastChargerType', 'FastChargerPresent', 'ACChargingPower', 'DCChargingPower', 'ChargerPhases', 'ChargerVoltage')
WHERE c.id = ANY($1)
GROUP BY c.id`, ids)
	if err != nil {
		return nil, fmt.Errorf("load charging evidence: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var evidence chargingdomain.ChargerEvidence
		if err := rows.Scan(&id, &evidence.FastChargerTypes, &evidence.FastPresent,
			&evidence.ACPowerW, &evidence.DCPowerW, &evidence.Phases, &evidence.VoltageV); err != nil {
			return nil, fmt.Errorf("scan charging evidence: %w", err)
		}
		fact := facts[id]
		fact.Charger = evidence
		facts[id] = fact
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read charging evidence: %w", err)
	}
	for _, session := range sessions {
		fact := facts[session.ID]
		if session.StartPlace != nil {
			fact.Charger.Place = *session.StartPlace
		}
		facts[session.ID] = fact
	}
	return facts, nil
}
