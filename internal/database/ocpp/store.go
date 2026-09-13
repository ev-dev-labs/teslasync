// Package ocpp persists OCPP-J 1.6 CSMS state recorded by cmd/ocpp-server
// and reads it back for the main API. Store implements the
// internal/ocpp.SessionStore port so the dispatcher needs no changes;
// the List methods serve the operator-facing charge-point views.
package ocpp

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	proto "github.com/ev-dev-labs/teslasync/internal/ocpp"
)

// Store is the Postgres-backed ocpp.SessionStore. All methods are safe
// for concurrent use (pgx pool); callers must still treat transaction
// IDs as dispatcher-global.
type Store struct {
	db *database.DB
}

// NewStore wires the store. Panics on nil db (fail-fast wiring).
func NewStore(db *database.DB) *Store {
	if db == nil {
		panic("database/ocpp: nil db")
	}
	return &Store{db: db}
}

var _ proto.SessionStore = (*Store)(nil)

// StartSession records a new charging transaction, upserting the charge
// point row first so the FK always resolves (a charger may transact
// before its BootNotification is processed).
func (s *Store) StartSession(ctx context.Context, sess proto.Session) error {
	if err := s.upsertChargePoint(ctx, sess.ChargePointID, "", "", "", ""); err != nil {
		return err
	}
	const query = `
		INSERT INTO ocpp_sessions (
			transaction_id, charge_point_id, connector_id, id_tag,
			started_at, start_meter_wh
		) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (transaction_id) DO NOTHING`
	_, err := s.db.Pool.Exec(ctx, query,
		sess.TransactionID, clamp(sess.ChargePointID, 128), sess.ConnectorID, clamp(sess.IDTag, 64),
		sess.StartedAt, sess.StartMeterWh,
	)
	if err != nil {
		return fmt.Errorf("ocpp: start session: %w", err)
	}
	return nil
}

// StopSession closes a transaction. An unknown transaction mirrors the
// memory store: an error naming the ID, so the dispatcher logs it.
func (s *Store) StopSession(ctx context.Context, transactionID int, endedAt time.Time, endMeterWh int, reason string) error {
	const query = `
		UPDATE ocpp_sessions
		SET ended_at = $2, end_meter_wh = $3, stop_reason = $4
		WHERE transaction_id = $1 AND ended_at IS NULL`
	tag, err := s.db.Pool.Exec(ctx, query, transactionID, endedAt, endMeterWh, clamp(reason, 64))
	if err != nil {
		return fmt.Errorf("ocpp: stop session: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("unknown transaction %d", transactionID)
	}
	return nil
}

// RecordMeterValues appends numeric samples to an open transaction. Like
// the memory store, samples for an unknown transaction are logged and
// dropped (a charger bug per the OCPP spec) rather than failing the
// response; non-numeric sample values are skipped the same way.
func (s *Store) RecordMeterValues(ctx context.Context, transactionID int, mv proto.MeterValuesReq) error {
	var sessionID int64
	err := s.db.Pool.QueryRow(ctx,
		`SELECT id FROM ocpp_sessions WHERE transaction_id = $1`, transactionID,
	).Scan(&sessionID)
	if err != nil {
		if err == pgx.ErrNoRows {
			log.Warn().Int("transaction_id", transactionID).Msg("MeterValues for unknown transaction")
			return nil
		}
		return fmt.Errorf("ocpp: resolve session: %w", err)
	}

	const query = `
		INSERT INTO ocpp_meter_values (
			session_id, connector_id, sampled_at, measurand, value, unit
		) VALUES ($1, $2, $3, $4, $5, $6)`
	batch := &pgx.Batch{}
	count := 0
	for _, m := range mv.MeterValue {
		sampledAt := parseOCPPTime(m.Timestamp)
		for _, sv := range m.SampledValue {
			v, err := strconv.ParseFloat(sv.Value, 64)
			if err != nil {
				log.Warn().
					Int("transaction_id", transactionID).
					Str("value", sv.Value).
					Msg("dropping non-numeric meter sample")
				continue
			}
			measurand := sv.Measurand
			if measurand == "" {
				measurand = "Energy.Active.Import.Register"
			}
			batch.Queue(query, sessionID, mv.ConnectorID, sampledAt, clamp(measurand, 64), v, clamp(sv.Unit, 16))
			count++
		}
	}
	if count == 0 {
		return nil
	}
	if err := s.db.Pool.SendBatch(ctx, batch).Close(); err != nil {
		return fmt.Errorf("ocpp: insert meter values: %w", err)
	}
	return nil
}

// RecordStatus upserts the latest connector status for a charge point.
func (s *Store) RecordStatus(ctx context.Context, chargePointID string, st proto.StatusNotificationReq) error {
	if err := s.upsertChargePoint(ctx, chargePointID, "", "", "", ""); err != nil {
		return err
	}
	const query = `
		INSERT INTO ocpp_connector_status (
			charge_point_id, connector_id, status, error_code, info, updated_at
		) VALUES ($1, $2, $3, $4, $5, now())
		ON CONFLICT (charge_point_id, connector_id) DO UPDATE SET
			status = EXCLUDED.status,
			error_code = EXCLUDED.error_code,
			info = EXCLUDED.info,
			updated_at = now()`
	_, err := s.db.Pool.Exec(ctx, query,
		clamp(chargePointID, 128), st.ConnectorID, clamp(st.Status, 32), clamp(st.ErrorCode, 64), clamp(st.Info, 500),
	)
	if err != nil {
		return fmt.Errorf("ocpp: record status: %w", err)
	}
	return s.touchSeen(ctx, chargePointID)
}

// RecordBoot upserts the charge point identity from a BootNotification.
func (s *Store) RecordBoot(ctx context.Context, chargePointID string, b proto.BootNotificationReq) error {
	const query = `
		INSERT INTO ocpp_charge_points (
			charge_point_id, vendor, model, serial_number, firmware_version,
			last_boot_at, last_seen_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, now(), now(), now())
		ON CONFLICT (charge_point_id) DO UPDATE SET
			vendor = EXCLUDED.vendor,
			model = EXCLUDED.model,
			serial_number = EXCLUDED.serial_number,
			firmware_version = EXCLUDED.firmware_version,
			last_boot_at = now(),
			last_seen_at = now(),
			updated_at = now()`
	_, err := s.db.Pool.Exec(ctx, query,
		clamp(chargePointID, 128), clamp(b.ChargePointVendor, 128), clamp(b.ChargePointModel, 128),
		clamp(b.ChargePointSerialNumber, 128), clamp(b.FirmwareVersion, 128),
	)
	if err != nil {
		return fmt.Errorf("ocpp: record boot: %w", err)
	}
	return nil
}

func (s *Store) upsertChargePoint(ctx context.Context, id, vendor, model, serial, firmware string) error {
	const query = `
		INSERT INTO ocpp_charge_points (
			charge_point_id, vendor, model, serial_number, firmware_version,
			last_seen_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, now(), now())
		ON CONFLICT (charge_point_id) DO UPDATE SET
			last_seen_at = now(), updated_at = now()`
	_, err := s.db.Pool.Exec(ctx, query,
		clamp(id, 128), clamp(vendor, 128), clamp(model, 128), clamp(serial, 128), clamp(firmware, 128))
	if err != nil {
		return fmt.Errorf("ocpp: upsert charge point: %w", err)
	}
	return nil
}

func (s *Store) touchSeen(ctx context.Context, id string) error {
	_, err := s.db.Pool.Exec(ctx,
		`UPDATE ocpp_charge_points SET last_seen_at = now(), updated_at = now() WHERE charge_point_id = $1`, clamp(id, 128))
	return err
}

// clamp truncates free-text charger input to the column bound so one
// oversized string fails slow truncation instead of a CHECK violation.
func clamp(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// parseOCPPTime parses an OCPP 1.6 timestamp (RFC 3339). Unparseable or
// empty values fall back to now so one bad sample never fails a batch.
func parseOCPPTime(v string) time.Time {
	if v == "" {
		return time.Now().UTC()
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t.UTC()
	}
	return time.Now().UTC()
}
