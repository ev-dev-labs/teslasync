package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/jackc/pgx/v5"
)

func (r *Repository) PriorInterruptedChargingPower(ctx context.Context, plan domain.Plan, stoppedAt, now time.Time) (float64, error) {
	active, err := EarlyStopUnchanged(ctx, r.db.Pool, plan.VehicleID, stoppedAt, now)
	if err != nil || !active {
		return 0, err
	}
	var watts float64
	err = r.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(power.float_value,power.int_value::double precision)
		FROM smart_charging_plans p
		CROSS JOIN LATERAL (
			SELECT ts, value_kind, str_value, int_value, source_emitted_at, received_at FROM signal_log
			WHERE vehicle_id=p.vehicle_id AND field='DetailedChargeState'
			  AND ts>=$2::timestamptz-INTERVAL '2 minutes' AND ts<=$3
			ORDER BY ts DESC LIMIT 1
		) stopped
		CROSS JOIN LATERAL (
			SELECT ts, value_kind, str_value, int_value, source_emitted_at, received_at FROM signal_log
			WHERE vehicle_id=p.vehicle_id AND field='DetailedChargeState'
			  AND ts>=$2::timestamptz-INTERVAL '2 hours' AND ts<$2
			ORDER BY ts DESC LIMIT 1
		) charging
		CROSS JOIN LATERAL (
			SELECT ts, float_value, int_value, source_emitted_at, received_at FROM signal_log
			WHERE vehicle_id=p.vehicle_id AND field='ACChargingPower'
			  AND ts>=charging.ts-INTERVAL '10 seconds' AND ts<$2
			ORDER BY ts DESC LIMIT 1
		) power
		WHERE p.id=$1 AND p.version=$4 AND p.subject=$5 AND p.vehicle_id=$6
		  AND p.early_stop_watch AND p.enabled AND p.updated_at<=stopped.ts
		  AND stopped.ts=$2 AND ((stopped.value_kind=$9 AND stopped.str_value IN ('NoPower','DetailedChargeStateNoPower'))
		    OR (stopped.value_kind=$10 AND stopped.int_value=$7))
		  AND ((charging.value_kind=$9 AND charging.str_value IN ('Charging','DetailedChargeStateCharging'))
		    OR (charging.value_kind=$10 AND charging.int_value=$8))
		  AND stopped.source_emitted_at=stopped.ts AND charging.source_emitted_at=charging.ts AND power.source_emitted_at=power.ts
		  AND stopped.received_at BETWEEN stopped.ts-INTERVAL '1 minute' AND LEAST($3,stopped.ts+INTERVAL '1 minute')
		  AND charging.received_at BETWEEN charging.ts-INTERVAL '1 minute' AND LEAST($3,charging.ts+INTERVAL '1 minute')
		  AND power.received_at BETWEEN power.ts-INTERVAL '1 minute' AND LEAST($3,power.ts+INTERVAL '1 minute')
		  AND COALESCE(power.float_value,power.int_value::double precision)>0
		  AND NOT EXISTS (
			SELECT 1 FROM command_logs WHERE vehicle_id=p.vehicle_id AND command='charge_stop'
			  AND created_at>=charging.ts AND created_at<=$3
		  )`, plan.ID, stoppedAt, now, plan.Version, plan.Subject, plan.VehicleID,
		protomodel.DetailedChargeStateValue_DetailedChargeStateNoPower,
		protomodel.DetailedChargeStateValue_DetailedChargeStateCharging,
		protomodel.ValueKindString, protomodel.ValueKindEnum).Scan(&watts)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read attested charging interruption: %w", err)
	}
	return watts, nil
}

type earlyStopQuery interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// EarlyStopUnchanged is also checked after delivery locks have been acquired,
// so an older observation cannot authorize a token after a committed resume.
func EarlyStopUnchanged(ctx context.Context, query earlyStopQuery, vehicleID int64, stop, now time.Time) (bool, error) {
	var active bool
	err := query.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM (
				SELECT ts, value_kind, str_value, int_value, source_emitted_at, received_at
				FROM signal_log WHERE vehicle_id=$1 AND field='DetailedChargeState'
				  AND ts BETWEEN $2 AND $3 ORDER BY ts DESC LIMIT 1
			) last WHERE ts=$2 AND source_emitted_at=$2
			  AND received_at BETWEEN $2::timestamptz-INTERVAL '1 minute' AND LEAST($3,$2::timestamptz+INTERVAL '1 minute')
			  AND ((value_kind=$4 AND str_value IN ('NoPower','DetailedChargeStateNoPower')) OR (value_kind=$5 AND int_value=$6))
		)
		AND NOT EXISTS (
			SELECT 1 FROM signal_log WHERE vehicle_id=$1 AND ts BETWEEN $2 AND $3::timestamptz+INTERVAL '2 minutes'
			AND ((field='DetailedChargeState' AND ts>$2)
			  OR (field IN ('ACChargingPower','DCChargingPower') AND COALESCE(float_value,int_value::double precision)>0)
			  OR (field='Gear' AND NOT COALESCE((value_kind=$4 AND str_value IN ('P','ShiftStateP'))
			      OR (value_kind=$5 AND int_value=$8),false))
			  OR (field='ChargePortLatch' AND NOT COALESCE((value_kind=$4 AND str_value IN ('Engaged','ChargePortLatchEngaged'))
			      OR (value_kind=$5 AND int_value=$7),false))
			  OR (field='ChargeEnableRequest' AND NOT bool_value)
			  OR (field='ScheduledChargingPending' AND bool_value))
		)
		AND NOT EXISTS (
			SELECT 1 FROM (VALUES ('Gear'),('ChargePortLatch')) AS f(field)
			CROSS JOIN LATERAL (
				SELECT value_kind,str_value,int_value FROM signal_log WHERE vehicle_id=$1 AND field=f.field
				  AND ts>=$2::timestamptz-INTERVAL '2 hours' AND ts<=$2 ORDER BY ts DESC LIMIT 1
			) effective
			WHERE NOT COALESCE(CASE f.field WHEN 'Gear' THEN
				(effective.value_kind=$4 AND effective.str_value IN ('P','ShiftStateP'))
				  OR (effective.value_kind=$5 AND effective.int_value=$8)
			ELSE
				(effective.value_kind=$4 AND effective.str_value IN ('Engaged','ChargePortLatchEngaged'))
				  OR (effective.value_kind=$5 AND effective.int_value=$7)
			END,false)
		)
		AND NOT EXISTS (
			SELECT 1 FROM (VALUES ('ScheduledChargingPending',true),('ChargeEnableRequest',false)) AS f(field,veto)
			CROSS JOIN LATERAL (
				SELECT bool_value FROM signal_log WHERE vehicle_id=$1 AND field=f.field
				  AND ts >= $2::timestamptz-INTERVAL '24 hours' AND ts<=$2 ORDER BY ts DESC LIMIT 1
			) effective WHERE effective.bool_value=f.veto
		)
		AND NOT EXISTS (
			SELECT 1 FROM command_logs WHERE vehicle_id=$1 AND command='charge_stop'
			  AND created_at BETWEEN $2::timestamptz-INTERVAL '2 minutes' AND $3::timestamptz+INTERVAL '2 minutes'
		)`,
		vehicleID, stop, now, protomodel.ValueKindString, protomodel.ValueKindEnum,
		protomodel.DetailedChargeStateValue_DetailedChargeStateNoPower,
		protomodel.ChargePortLatchValue_ChargePortLatchEngaged,
		protomodel.ShiftState_ShiftStateP).Scan(&active)
	if err != nil {
		return false, fmt.Errorf("check interruption against committed telemetry and intent: %w", err)
	}
	return active, nil
}
