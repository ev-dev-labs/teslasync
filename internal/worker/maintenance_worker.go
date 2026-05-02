package worker

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
)

// StartMaintenanceWorker runs periodic database cleanup on a 24-hour schedule.
// It deletes old positions and vehicle states based on configured retention
// periods, then runs VACUUM ANALYZE to reclaim space.
func StartMaintenanceWorker(ctx context.Context, db *database.DB, cfg *config.Config) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	log.Info().
		Int("data_retention_days", cfg.Retention.DataRetentionDays).
		Int("position_retention_days", cfg.Retention.PositionRetentionDays).
		Msg("maintenance worker started")

	// Run initial cleanup shortly after startup (5 minute delay to let the system settle)
	select {
	case <-ctx.Done():
		return
	case <-time.After(5 * time.Minute):
		runMaintenance(ctx, db, cfg)
	}

	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("maintenance worker stopping")
			return
		case <-ticker.C:
			runMaintenance(ctx, db, cfg)
		}
	}
}

func runMaintenance(ctx context.Context, db *database.DB, cfg *config.Config) {
	log.Info().Msg("starting scheduled maintenance")
	start := time.Now()

	// Use a separate context with a generous timeout for maintenance operations
	maintCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()

	// Clean up old positions that may remain in the default partition
	var posDeleted int64
	if cfg.Retention.PositionRetentionDays > 0 {
		var err error
		posDeleted, err = db.CleanupOldPositions(maintCtx, cfg.Retention.PositionRetentionDays)
		if err != nil {
			log.Error().Err(err).Msg("position cleanup failed")
		}
	}

	// Clean up old vehicle states
	var statesDeleted int64
	if cfg.Retention.DataRetentionDays > 0 {
		var err error
		statesDeleted, err = db.CleanupOldStates(maintCtx, cfg.Retention.DataRetentionDays)
		if err != nil {
			log.Error().Err(err).Msg("vehicle state cleanup failed")
		}
	}

	// Clean up old API call logs (keep 30 days)
	apiLogsDeleted, err := cleanupOldLogs(maintCtx, db, "api_call_logs", "ts", 30)
	if err != nil {
		log.Error().Err(err).Msg("API call log cleanup failed")
	}

	// Clean up old notification logs (keep 90 days)
	notifLogsDeleted, err := cleanupOldLogs(maintCtx, db, "notification_logs", "created_at", 90)
	if err != nil {
		log.Error().Err(err).Msg("notification log cleanup failed")
	}

	// Clean up old audit_logs entries beyond the configured retention window.
	// Set AUDIT_RETENTION_DAYS=0 to disable.
	var auditLogsDeleted int64
	if cfg.Retention.AuditRetentionDays > 0 {
		auditLogsDeleted, err = cleanupOldLogs(maintCtx, db, "audit_logs", "ts", cfg.Retention.AuditRetentionDays)
		if err != nil {
			log.Error().Err(err).Msg("audit log cleanup failed")
		}
	}

	// Privacy: redact ip + user_agent on audit_logs older than the IP-retention
	// window so we keep the actor identity (which the user can already see)
	// without holding onto network metadata indefinitely. Set
	// AUDIT_IP_RETENTION_DAYS=0 to keep the columns intact.
	var auditIPsRedacted int64
	if cfg.Retention.AuditIPRetentionDays > 0 {
		auditIPsRedacted, err = redactOldAuditIPs(maintCtx, db, cfg.Retention.AuditIPRetentionDays)
		if err != nil {
			log.Error().Err(err).Msg("audit IP redaction failed")
		}
	}

	// Run VACUUM ANALYZE to reclaim space and update statistics. Audit-log
	// deletes also benefit from a vacuum pass since the table can accumulate
	// dead tuples over a long retention window.
	if posDeleted > 0 || statesDeleted > 0 || auditLogsDeleted > 0 {
		if err := db.VacuumAnalyze(maintCtx); err != nil {
			log.Error().Err(err).Msg("VACUUM ANALYZE failed")
		}
	}

	// Refresh cagg_fleet_stats materialized view (regular MV, not TimescaleDB CAGG)
	if err := refreshFleetStats(maintCtx, db); err != nil {
		log.Error().Err(err).Msg("cagg_fleet_stats refresh failed")
	}

	log.Info().
		Int64("positions_deleted", posDeleted).
		Int64("states_deleted", statesDeleted).
		Int64("api_logs_deleted", apiLogsDeleted).
		Int64("notif_logs_deleted", notifLogsDeleted).
		Int64("audit_logs_deleted", auditLogsDeleted).
		Int64("audit_ips_redacted", auditIPsRedacted).
		Dur("duration", time.Since(start)).
		Msg("scheduled maintenance complete")
}

// refreshFleetStats refreshes the cagg_fleet_stats materialized view.
// This is a regular MV (not a TimescaleDB continuous aggregate) because the
// source table `drives` is mutable and cannot be converted to a hypertable.
func refreshFleetStats(ctx context.Context, db *database.DB) error {
	log.Info().Msg("refreshing cagg_fleet_stats materialized view")
	_, err := db.Pool.Exec(ctx, "REFRESH MATERIALIZED VIEW CONCURRENTLY cagg_fleet_stats")
	if err != nil && strings.Contains(err.Error(), "not populated") {
		_, err = db.Pool.Exec(ctx, "REFRESH MATERIALIZED VIEW cagg_fleet_stats")
	}
	if err != nil {
		return fmt.Errorf("refresh cagg_fleet_stats: %w", err)
	}
	log.Info().Msg("cagg_fleet_stats refresh complete")
	return nil
}

func cleanupOldLogs(ctx context.Context, db *database.DB, table, tsCol string, retentionDays int) (int64, error) {
	query := fmt.Sprintf("DELETE FROM %s WHERE %s < NOW() - ($1 || ' days')::INTERVAL", table, tsCol)
	tag, err := db.Pool.Exec(ctx, query, fmt.Sprintf("%d", retentionDays))
	if err != nil {
		return 0, err
	}
	deleted := tag.RowsAffected()
	if deleted > 0 {
		log.Info().Int64("deleted", deleted).Str("table", table).Msg("cleaned up old logs")
	}
	return deleted, nil
}

// redactOldAuditIPs nulls out audit_logs.ip and audit_logs.user_agent for rows
// older than retentionDays. The actor + action + entity remain so users can
// still see what they did, but the network metadata is forgotten. This keeps
// the per-user activity feed working without retaining PII indefinitely.
func redactOldAuditIPs(ctx context.Context, db *database.DB, retentionDays int) (int64, error) {
	const query = `
		UPDATE audit_logs
		   SET ip = NULL, user_agent = NULL
		 WHERE ts < NOW() - ($1 || ' days')::INTERVAL
		   AND (ip IS NOT NULL OR user_agent IS NOT NULL)`
	tag, err := db.Pool.Exec(ctx, query, fmt.Sprintf("%d", retentionDays))
	if err != nil {
		return 0, err
	}
	redacted := tag.RowsAffected()
	if redacted > 0 {
		log.Info().Int64("redacted", redacted).Int("retention_days", retentionDays).Msg("redacted audit log IP/UA")
	}
	return redacted, nil
}
