package ocpp

import (
	"context"
	"fmt"
	"time"
)

// ChargePoint is one known charger with its latest connector statuses.
type ChargePoint struct {
	ID              string            `json:"id"`
	Vendor          string            `json:"vendor"`
	Model           string            `json:"model"`
	SerialNumber    string            `json:"serial_number"`
	FirmwareVersion string            `json:"firmware_version"`
	LastBootAt      *time.Time        `json:"last_boot_at"`
	LastSeenAt      time.Time         `json:"last_seen_at"`
	Connectors      []ConnectorStatus `json:"connectors"`
	ActiveSessions  int               `json:"active_sessions"`
}

// ConnectorStatus is the latest status of one connector.
type ConnectorStatus struct {
	ConnectorID int       `json:"connector_id"`
	Status      string    `json:"status"`
	ErrorCode   string    `json:"error_code"`
	Info        string    `json:"info"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// SessionView is one charging transaction for operator views.
type SessionView struct {
	TransactionID     int        `json:"transaction_id"`
	ChargePointID     string     `json:"charge_point_id"`
	ConnectorID       int        `json:"connector_id"`
	StartedAt         time.Time  `json:"started_at"`
	StartMeterWh      int        `json:"start_meter_wh"`
	EndedAt           *time.Time `json:"ended_at"`
	EndMeterWh        *int       `json:"end_meter_wh"`
	StopReason        string     `json:"stop_reason"`
	EnergyDeliveredWh *int       `json:"energy_delivered_wh"`
}

// ListChargePoints returns every known charger, most recently seen
// first, each with its connector statuses and open-session count.
func (s *Store) ListChargePoints(ctx context.Context) ([]ChargePoint, error) {
	const query = `
		SELECT charge_point_id, vendor, model, serial_number, firmware_version,
		       last_boot_at, last_seen_at,
		       (SELECT count(*) FROM ocpp_sessions os
		         WHERE os.charge_point_id = ocp.charge_point_id AND os.ended_at IS NULL)
		FROM ocpp_charge_points ocp
		ORDER BY last_seen_at DESC`
	rows, err := s.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("ocpp: list charge points: %w", err)
	}
	defer rows.Close()

	var out []ChargePoint
	for rows.Next() {
		var cp ChargePoint
		if err := rows.Scan(&cp.ID, &cp.Vendor, &cp.Model, &cp.SerialNumber,
			&cp.FirmwareVersion, &cp.LastBootAt, &cp.LastSeenAt, &cp.ActiveSessions); err != nil {
			return nil, fmt.Errorf("ocpp: scan charge point: %w", err)
		}
		out = append(out, cp)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ocpp: list charge points: %w", err)
	}
	if len(out) == 0 {
		return []ChargePoint{}, nil
	}

	const statusQuery = `
		SELECT charge_point_id, connector_id, status, error_code, info, updated_at
		FROM ocpp_connector_status
		ORDER BY charge_point_id, connector_id`
	statusRows, err := s.db.Pool.Query(ctx, statusQuery)
	if err != nil {
		return nil, fmt.Errorf("ocpp: list connector status: %w", err)
	}
	defer statusRows.Close()

	byCP := make(map[string][]ConnectorStatus, len(out))
	for statusRows.Next() {
		var cpID string
		var cs ConnectorStatus
		if err := statusRows.Scan(&cpID, &cs.ConnectorID, &cs.Status, &cs.ErrorCode, &cs.Info, &cs.UpdatedAt); err != nil {
			return nil, fmt.Errorf("ocpp: scan connector status: %w", err)
		}
		byCP[cpID] = append(byCP[cpID], cs)
	}
	if err := statusRows.Err(); err != nil {
		return nil, fmt.Errorf("ocpp: list connector status: %w", err)
	}
	for i := range out {
		out[i].Connectors = byCP[out[i].ID]
		if out[i].Connectors == nil {
			out[i].Connectors = []ConnectorStatus{}
		}
	}
	return out, nil
}

// ListSessions returns recent transactions, newest first. An empty
// chargePointID lists across all chargers. Limit is clamped to 1..200.
func (s *Store) ListSessions(ctx context.Context, chargePointID string, limit int) ([]SessionView, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	const query = `
		SELECT transaction_id, charge_point_id, connector_id, started_at,
		       start_meter_wh, ended_at, end_meter_wh, stop_reason,
		       CASE WHEN end_meter_wh IS NOT NULL AND end_meter_wh >= start_meter_wh
		            THEN end_meter_wh - start_meter_wh END
		FROM ocpp_sessions
		WHERE ($1 = '' OR charge_point_id = $1)
		ORDER BY started_at DESC
		LIMIT $2`
	rows, err := s.db.Pool.Query(ctx, query, chargePointID, limit)
	if err != nil {
		return nil, fmt.Errorf("ocpp: list sessions: %w", err)
	}
	defer rows.Close()

	out := []SessionView{}
	for rows.Next() {
		var v SessionView
		if err := rows.Scan(&v.TransactionID, &v.ChargePointID, &v.ConnectorID,
			&v.StartedAt, &v.StartMeterWh, &v.EndedAt, &v.EndMeterWh,
			&v.StopReason, &v.EnergyDeliveredWh); err != nil {
			return nil, fmt.Errorf("ocpp: scan session: %w", err)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ocpp: list sessions: %w", err)
	}
	return out, nil
}
