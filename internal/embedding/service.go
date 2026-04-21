package embedding

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// Entity types stored in the `embeddings` table.
const (
	EntityDrive          = "drive"
	EntityCharge         = "charge"
	EntityAlert          = "alert"
	EntityDailySummary   = "daily_summary"
	EntitySoftwareUpdate = "software_update"
)

// SearchResult is a single row returned by Service.Search, ordered by
// decreasing semantic similarity to the query.
type SearchResult struct {
	EntityType string                 `json:"entity_type"`
	EntityID   int64                  `json:"entity_id"`
	VehicleID  int64                  `json:"vehicle_id"`
	Content    string                 `json:"content"`
	Metadata   map[string]interface{} `json:"metadata"`
	Similarity float64                `json:"similarity"` // 0..1, higher is better (1 - cosine distance)
	CreatedAt  time.Time              `json:"created_at"`
}

// Service owns embedding generation and semantic search.
type Service struct {
	db       *database.DB
	provider Provider
}

// NewService constructs a Service. Both db and provider are required.
func NewService(db *database.DB, provider Provider) *Service {
	return &Service{db: db, provider: provider}
}

// Provider exposes the underlying embedding provider (used by callers
// that want to embed ad-hoc query strings before calling Search).
func (s *Service) Provider() Provider { return s.provider }

// ---- Content builders ----------------------------------------------------
//
// These helpers produce the human-readable summary text that gets
// embedded. Keeping them as pure functions makes them easy to unit-test
// without touching the database or the LLM provider.

// BuildDriveContent returns the summary text for a drive.
func BuildDriveContent(d *models.Drive) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Drive on %s: %.1f km",
		d.StartDate.Format("Jan 2, 2006 3:04 PM"), d.Distance)
	if d.DurationMin > 0 {
		fmt.Fprintf(&b, " in %.0f minutes", d.DurationMin)
	}
	if d.SpeedAvg != nil {
		fmt.Fprintf(&b, ", average speed %.0f km/h", *d.SpeedAvg)
	}
	if d.SpeedMax != nil {
		fmt.Fprintf(&b, ", max speed %.0f km/h", *d.SpeedMax)
	}
	if d.StartBatteryLvl != nil && d.EndBatteryLvl != nil {
		fmt.Fprintf(&b, ", battery from %d%% to %d%%", *d.StartBatteryLvl, *d.EndBatteryLvl)
	}
	if d.StartAddress != nil && d.EndAddress != nil {
		fmt.Fprintf(&b, ", from %s to %s", *d.StartAddress, *d.EndAddress)
	}
	if d.OutsideTempAvg != nil {
		fmt.Fprintf(&b, ", outside %.0f°C", *d.OutsideTempAvg)
	}
	if d.ElevationGain != nil && d.ElevationLoss != nil {
		fmt.Fprintf(&b, ", elevation +%.0f/-%.0f m", *d.ElevationGain, *d.ElevationLoss)
	}
	return b.String()
}

// BuildChargeContent returns the summary text for a charging session.
func BuildChargeContent(c *models.ChargingSession) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Charging session on %s: %.1f kWh added",
		c.StartDate.Format("Jan 2, 2006 3:04 PM"), c.ChargeEnergyAdded)
	if c.DurationMin > 0 {
		fmt.Fprintf(&b, " over %.0f minutes", c.DurationMin)
	}
	if c.EndBatteryLevel != nil {
		fmt.Fprintf(&b, ", battery from %d%% to %d%%", c.StartBatteryLevel, *c.EndBatteryLevel)
	} else {
		fmt.Fprintf(&b, ", starting at %d%%", c.StartBatteryLevel)
	}
	if c.ChargerPower != nil {
		fmt.Fprintf(&b, ", peak power %.1f kW", *c.ChargerPower)
	}
	if c.FastChargerBrand != nil {
		fmt.Fprintf(&b, ", charger: %s", *c.FastChargerBrand)
	}
	if c.LocationName != nil {
		fmt.Fprintf(&b, ", location: %s", *c.LocationName)
	}
	if c.Cost != nil && *c.Cost > 0 {
		fmt.Fprintf(&b, ", cost $%.2f", *c.Cost)
	}
	return b.String()
}

// BuildAlertContent returns the summary text for an alert.
func BuildAlertContent(a *models.Alert) string {
	return fmt.Sprintf("Alert on %s: [%s/%s] %s — %s",
		a.CreatedAt.Format("Jan 2, 2006 3:04 PM"),
		a.Severity, a.Type, a.Title, a.Message)
}

// ---- Generation ---------------------------------------------------------

// GenerateDriveEmbedding builds the content, calls the provider, and
// upserts into the embeddings table.
func (s *Service) GenerateDriveEmbedding(ctx context.Context, drive *models.Drive) error {
	content := BuildDriveContent(drive)
	metadata := map[string]interface{}{
		"distance":    drive.Distance,
		"duration":    drive.DurationMin,
		"date":        drive.StartDate.Format("2006-01-02"),
		"start_date":  drive.StartDate.Format(time.RFC3339),
	}
	if drive.SpeedAvg != nil {
		metadata["speed_avg"] = *drive.SpeedAvg
	}
	if drive.SpeedMax != nil {
		metadata["speed_max"] = *drive.SpeedMax
	}
	return s.upsert(ctx, EntityDrive, drive.ID, drive.VehicleID, content, metadata)
}

// GenerateChargeEmbedding builds the content, calls the provider, and
// upserts into the embeddings table.
func (s *Service) GenerateChargeEmbedding(ctx context.Context, charge *models.ChargingSession) error {
	content := BuildChargeContent(charge)
	metadata := map[string]interface{}{
		"energy":   charge.ChargeEnergyAdded,
		"duration": charge.DurationMin,
		"date":     charge.StartDate.Format("2006-01-02"),
	}
	if charge.ChargerPower != nil {
		metadata["power"] = *charge.ChargerPower
	}
	if charge.Cost != nil {
		metadata["cost"] = *charge.Cost
	}
	return s.upsert(ctx, EntityCharge, charge.ID, charge.VehicleID, content, metadata)
}

// GenerateAlertEmbedding builds the content, calls the provider, and
// upserts into the embeddings table.
func (s *Service) GenerateAlertEmbedding(ctx context.Context, alert *models.Alert) error {
	if alert.VehicleID == nil {
		return fmt.Errorf("alert %d has no vehicle_id; cannot embed", alert.ID)
	}
	content := BuildAlertContent(alert)
	metadata := map[string]interface{}{
		"type":     alert.Type,
		"severity": alert.Severity,
		"date":     alert.CreatedAt.Format("2006-01-02"),
	}
	return s.upsert(ctx, EntityAlert, alert.ID, *alert.VehicleID, content, metadata)
}

// upsert is the shared insert-or-update path for all entity types.
func (s *Service) upsert(ctx context.Context, entityType string, entityID, vehicleID int64, content string, metadata map[string]interface{}) error {
	vec, err := s.provider.Embed(ctx, content)
	if err != nil {
		return fmt.Errorf("embed %s %d: %w", entityType, entityID, err)
	}
	if len(vec) != s.provider.Dimensions() {
		return fmt.Errorf("embed %s %d: provider returned %d dimensions, expected %d",
			entityType, entityID, len(vec), s.provider.Dimensions())
	}

	metaJSON, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal metadata: %w", err)
	}

	vecLit := vectorLiteral(vec)
	_, err = s.db.Pool.Exec(ctx, `
		INSERT INTO embeddings (entity_type, entity_id, vehicle_id, content, embedding, metadata, model, updated_at)
		VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb, $7, NOW())
		ON CONFLICT (entity_type, entity_id)
		DO UPDATE SET
			content    = EXCLUDED.content,
			embedding  = EXCLUDED.embedding,
			metadata   = EXCLUDED.metadata,
			model      = EXCLUDED.model,
			updated_at = NOW()
	`, entityType, entityID, vehicleID, content, vecLit, string(metaJSON), s.provider.Model())
	if err != nil {
		return fmt.Errorf("upsert embedding %s %d: %w", entityType, entityID, err)
	}
	return nil
}

// ---- Search --------------------------------------------------------------

// SearchOptions refines a semantic search query.
type SearchOptions struct {
	// VehicleID restricts results to a single vehicle. 0 = no filter.
	VehicleID int64
	// EntityTypes restricts to specific entity types. nil/empty = all.
	EntityTypes []string
	// Limit bounds the returned row count. <=0 defaults to 5.
	Limit int
}

// Search embeds the query string and returns the most similar rows.
func (s *Service) Search(ctx context.Context, query string, opts SearchOptions) ([]SearchResult, error) {
	queryVec, err := s.provider.Embed(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("embed query: %w", err)
	}
	return s.SearchByVector(ctx, queryVec, opts)
}

// SearchByVector is like Search but skips the embed step. Useful when
// the caller has already computed (or cached) the query vector.
func (s *Service) SearchByVector(ctx context.Context, queryVec []float32, opts SearchOptions) ([]SearchResult, error) {
	if len(queryVec) != s.provider.Dimensions() {
		return nil, fmt.Errorf("search: query vector dim %d != provider dim %d", len(queryVec), s.provider.Dimensions())
	}
	limit := opts.Limit
	if limit <= 0 {
		limit = 5
	}

	// Build WHERE clause dynamically. We keep $1 reserved for the vector.
	args := []interface{}{vectorLiteral(queryVec)}
	var where []string
	// Skip rows whose embedding hasn't been computed yet.
	where = append(where, "embedding IS NOT NULL")
	if opts.VehicleID != 0 {
		args = append(args, opts.VehicleID)
		where = append(where, fmt.Sprintf("vehicle_id = $%d", len(args)))
	}
	if len(opts.EntityTypes) > 0 {
		args = append(args, opts.EntityTypes)
		where = append(where, fmt.Sprintf("entity_type = ANY($%d)", len(args)))
	}
	args = append(args, limit)

	q := fmt.Sprintf(`
		SELECT entity_type, entity_id, vehicle_id, content, metadata, created_at,
		       1 - (embedding <=> $1::vector) AS similarity
		FROM embeddings
		WHERE %s
		ORDER BY embedding <=> $1::vector
		LIMIT $%d
	`, strings.Join(where, " AND "), len(args))

	rows, err := s.db.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("search query: %w", err)
	}
	defer rows.Close()

	var out []SearchResult
	for rows.Next() {
		var r SearchResult
		var rawMeta []byte
		if err := rows.Scan(&r.EntityType, &r.EntityID, &r.VehicleID, &r.Content, &rawMeta, &r.CreatedAt, &r.Similarity); err != nil {
			return nil, fmt.Errorf("search scan: %w", err)
		}
		if len(rawMeta) > 0 {
			_ = json.Unmarshal(rawMeta, &r.Metadata)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("search rows: %w", err)
	}
	return out, nil
}

// ---- Backfill helpers ---------------------------------------------------

// BackfillOnce scans for un-embedded drives/charges/alerts and embeds up
// to `batchSize` of each type. It returns the number of rows processed
// (successes) so callers can emit a metric/log and decide whether to
// loop again immediately.
//
// Failures on individual rows are logged but do not abort the sweep —
// a single bad row (e.g. provider rate-limited) shouldn't block all
// the others.
func (s *Service) BackfillOnce(ctx context.Context, batchSize int) (int, error) {
	if batchSize <= 0 {
		batchSize = 50
	}
	total := 0

	n, err := s.backfillDrives(ctx, batchSize)
	if err != nil {
		log.Warn().Err(err).Msg("embedding backfill: drives")
	}
	total += n

	n, err = s.backfillCharges(ctx, batchSize)
	if err != nil {
		log.Warn().Err(err).Msg("embedding backfill: charges")
	}
	total += n

	n, err = s.backfillAlerts(ctx, batchSize)
	if err != nil {
		log.Warn().Err(err).Msg("embedding backfill: alerts")
	}
	total += n

	return total, nil
}

func (s *Service) backfillDrives(ctx context.Context, limit int) (int, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT d.id
		FROM drives d
		LEFT JOIN embeddings e ON e.entity_type = 'drive' AND e.entity_id = d.id
		WHERE e.id IS NULL AND d.end_date IS NOT NULL
		ORDER BY d.start_date DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, fmt.Errorf("query drives: %w", err)
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		ids = append(ids, id)
	}

	count := 0
	for _, id := range ids {
		d, err := loadDrive(ctx, s.db, id)
		if err != nil {
			log.Warn().Err(err).Int64("drive_id", id).Msg("embedding backfill: load drive")
			continue
		}
		if err := s.GenerateDriveEmbedding(ctx, d); err != nil {
			log.Warn().Err(err).Int64("drive_id", id).Msg("embedding backfill: generate drive embedding")
			continue
		}
		count++
	}
	return count, nil
}

func (s *Service) backfillCharges(ctx context.Context, limit int) (int, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT c.id
		FROM charging_sessions c
		LEFT JOIN embeddings e ON e.entity_type = 'charge' AND e.entity_id = c.id
		WHERE e.id IS NULL AND c.end_date IS NOT NULL
		ORDER BY c.start_date DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, fmt.Errorf("query charges: %w", err)
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		ids = append(ids, id)
	}

	count := 0
	for _, id := range ids {
		c, err := loadCharge(ctx, s.db, id)
		if err != nil {
			log.Warn().Err(err).Int64("charge_id", id).Msg("embedding backfill: load charge")
			continue
		}
		if err := s.GenerateChargeEmbedding(ctx, c); err != nil {
			log.Warn().Err(err).Int64("charge_id", id).Msg("embedding backfill: generate charge embedding")
			continue
		}
		count++
	}
	return count, nil
}

func (s *Service) backfillAlerts(ctx context.Context, limit int) (int, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT a.id
		FROM alerts a
		LEFT JOIN embeddings e ON e.entity_type = 'alert' AND e.entity_id = a.id
		WHERE e.id IS NULL AND a.vehicle_id IS NOT NULL
		ORDER BY a.created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, fmt.Errorf("query alerts: %w", err)
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		ids = append(ids, id)
	}

	count := 0
	for _, id := range ids {
		a, err := loadAlert(ctx, s.db, id)
		if err != nil {
			log.Warn().Err(err).Int64("alert_id", id).Msg("embedding backfill: load alert")
			continue
		}
		if err := s.GenerateAlertEmbedding(ctx, a); err != nil {
			log.Warn().Err(err).Int64("alert_id", id).Msg("embedding backfill: generate alert embedding")
			continue
		}
		count++
	}
	return count, nil
}

// ---- Entity loaders -----------------------------------------------------

func loadDrive(ctx context.Context, db *database.DB, id int64) (*models.Drive, error) {
	row := db.Pool.QueryRow(ctx, `
		SELECT id, vehicle_id, start_date, end_date, distance, duration_min,
		       speed_avg, speed_max, start_battery_level, end_battery_level,
		       outside_temp_avg, elevation_gain, elevation_loss,
		       start_address, end_address
		FROM drives WHERE id = $1
	`, id)
	var d models.Drive
	err := row.Scan(&d.ID, &d.VehicleID, &d.StartDate, &d.EndDate, &d.Distance, &d.DurationMin,
		&d.SpeedAvg, &d.SpeedMax, &d.StartBatteryLvl, &d.EndBatteryLvl,
		&d.OutsideTempAvg, &d.ElevationGain, &d.ElevationLoss,
		&d.StartAddress, &d.EndAddress)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("drive %d not found", id)
		}
		return nil, err
	}
	return &d, nil
}

func loadCharge(ctx context.Context, db *database.DB, id int64) (*models.ChargingSession, error) {
	row := db.Pool.QueryRow(ctx, `
		SELECT id, vehicle_id, start_date, end_date,
		       charge_energy_added, start_battery_level, end_battery_level,
		       charger_power, fast_charger_brand, cost, duration_min, location_name
		FROM charging_sessions WHERE id = $1
	`, id)
	var c models.ChargingSession
	err := row.Scan(&c.ID, &c.VehicleID, &c.StartDate, &c.EndDate,
		&c.ChargeEnergyAdded, &c.StartBatteryLevel, &c.EndBatteryLevel,
		&c.ChargerPower, &c.FastChargerBrand, &c.Cost, &c.DurationMin, &c.LocationName)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("charge %d not found", id)
		}
		return nil, err
	}
	return &c, nil
}

func loadAlert(ctx context.Context, db *database.DB, id int64) (*models.Alert, error) {
	row := db.Pool.QueryRow(ctx, `
		SELECT id, vehicle_id, type, severity, title, message, is_read, created_at
		FROM alerts WHERE id = $1
	`, id)
	var a models.Alert
	err := row.Scan(&a.ID, &a.VehicleID, &a.Type, &a.Severity, &a.Title, &a.Message, &a.IsRead, &a.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("alert %d not found", id)
		}
		return nil, err
	}
	return &a, nil
}

// ---- Vector serialization ----------------------------------------------

// vectorLiteral formats a float32 slice as pgvector's text representation
// (e.g. "[0.1,0.2,0.3]"). We intentionally do not pull in the
// pgvector-go driver — it only adds one feature (a custom pgtype) that
// is easy to replicate here with zero allocations beyond the string.
func vectorLiteral(vec []float32) string {
	var b strings.Builder
	b.Grow(len(vec) * 10)
	b.WriteByte('[')
	for i, v := range vec {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(float64(v), 'f', -1, 32))
	}
	b.WriteByte(']')
	return b.String()
}
