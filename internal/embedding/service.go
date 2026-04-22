// Package embedding provides semantic search over vehicle data via pgvector.
//
// Embeddings are dense vector representations of human-readable summaries
// of drives, charging sessions, and alerts. They are produced by an
// EmbeddingProvider (typically a remote LLM such as OpenAI, but a
// deterministic local provider is included for tests and offline use).
//
// At query time, a natural-language query is embedded with the same
// provider and compared via cosine distance against stored vectors using
// the HNSW index created in migration 000004. The top-K results give the
// chatbot a focused window of "relevant" structured data to ground its
// responses in.
package embedding

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// Entity types stored in the `embeddings` table. New types must also be
// handled by the worker's backfill loop.
const (
	EntityDrive        = "drive"
	EntityCharge       = "charge"
	EntityAlert        = "alert"
	EntityDailySummary = "daily_summary"
)

// ErrDisabled is returned by Service methods when EMBEDDING_ENABLED is false.
var ErrDisabled = errors.New("embedding service disabled")

// EmbeddingProvider produces dense vector representations of text.
//
// Implementations MUST return vectors of the dimension declared in their
// configuration (cfg.Dimensions). The pgvector column in `embeddings` is
// fixed at 1536 dimensions to match OpenAI's text-embedding-3-small; using
// a different dimension requires a schema change.
type EmbeddingProvider interface {
	Embed(ctx context.Context, text string) ([]float32, error)
	EmbedBatch(ctx context.Context, texts []string) ([][]float32, error)
	Dimensions() int
}

// SearchResult is a single row returned by Service.Search, ordered by
// descending similarity (1.0 = identical, 0.0 = orthogonal under cosine).
type SearchResult struct {
	EntityType string                 `json:"entity_type"`
	EntityID   int64                  `json:"entity_id"`
	VehicleID  int64                  `json:"vehicle_id"`
	Content    string                 `json:"content"`
	Metadata   map[string]interface{} `json:"metadata"`
	Similarity float64                `json:"similarity"`
}

// Service generates and queries embeddings.
//
// A nil provider (or cfg.Enabled == false) makes all mutating methods
// no-ops that return ErrDisabled, so callers can safely wire the service
// in regardless of whether embeddings are actually configured.
type Service struct {
	db       *database.DB
	provider EmbeddingProvider
	cfg      config.EmbeddingConfig
}

// NewService constructs a Service. If cfg.Enabled is false the returned
// service is non-nil but will short-circuit all operations.
func NewService(db *database.DB, provider EmbeddingProvider, cfg config.EmbeddingConfig) *Service {
	return &Service{db: db, provider: provider, cfg: cfg}
}

// Enabled reports whether the service has a usable provider.
func (s *Service) Enabled() bool {
	return s != nil && s.cfg.Enabled && s.provider != nil
}

// Provider returns the configured EmbeddingProvider (may be nil).
func (s *Service) Provider() EmbeddingProvider { return s.provider }

// vectorLiteral renders a float32 slice as the pgvector text format
// (e.g. "[0.1,0.2,0.3]") so it can be passed to Postgres without an
// extra dependency. Sent to the server as text and cast with `::vector`.
func vectorLiteral(v []float32) string {
	if len(v) == 0 {
		return "[]"
	}
	var sb strings.Builder
	sb.Grow(len(v) * 8)
	sb.WriteByte('[')
	for i, f := range v {
		if i > 0 {
			sb.WriteByte(',')
		}
		sb.WriteString(strconv.FormatFloat(float64(f), 'f', -1, 32))
	}
	sb.WriteByte(']')
	return sb.String()
}

// upsert inserts or updates a single embedding row.
func (s *Service) upsert(ctx context.Context, entityType string, entityID, vehicleID int64, content string, vec []float32, metadata map[string]interface{}) error {
	if metadata == nil {
		metadata = map[string]interface{}{}
	}
	_, err := s.db.Pool.Exec(ctx, `
		INSERT INTO embeddings (entity_type, entity_id, vehicle_id, content, embedding, metadata, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5::vector, $6, NOW(), NOW())
		ON CONFLICT (entity_type, entity_id) DO UPDATE SET
			content    = EXCLUDED.content,
			embedding  = EXCLUDED.embedding,
			metadata   = EXCLUDED.metadata,
			vehicle_id = EXCLUDED.vehicle_id,
			updated_at = NOW()
	`, entityType, entityID, vehicleID, content, vectorLiteral(vec), metadata)
	if err != nil {
		return fmt.Errorf("upsert embedding %s/%d: %w", entityType, entityID, err)
	}
	return nil
}

// ----------------------------- Drive ---------------------------------------

// DriveSummary builds the human-readable text that gets embedded for a drive.
func DriveSummary(d *models.Drive) string {
	startBat := derefInt(d.StartBatteryLvl)
	endBat := derefInt(d.EndBatteryLvl)
	speedMax := derefFloat(d.SpeedMax)
	speedAvg := derefFloat(d.SpeedAvg)
	elevGain := derefFloat(d.ElevationGain)
	elevLoss := derefFloat(d.ElevationLoss)
	startAddr := derefStrPtr(d.StartAddress, "unknown")
	endAddr := derefStrPtr(d.EndAddress, "unknown")

	socUsed := 0.0
	if d.Distance > 0 && startBat > endBat {
		socUsed = float64(startBat-endBat) / d.Distance
	}

	return fmt.Sprintf(
		"Drive on %s: %.1f km in %d minutes, average speed %.0f km/h, "+
			"battery %d%% to %d%% (%.2f%%/km), from %s to %s, "+
			"max speed %.0f km/h, elevation +%.0f m / -%.0f m.",
		d.StartDate.Format("Jan 2 2006 15:04"),
		d.Distance, int(d.DurationMin), speedAvg,
		startBat, endBat, socUsed,
		startAddr, endAddr,
		speedMax, elevGain, elevLoss,
	)
}

// GenerateDriveEmbedding embeds a single drive and persists it.
func (s *Service) GenerateDriveEmbedding(ctx context.Context, d *models.Drive) error {
	if !s.Enabled() {
		return ErrDisabled
	}
	content := DriveSummary(d)
	vec, err := s.provider.Embed(ctx, content)
	if err != nil {
		return fmt.Errorf("embed drive %d: %w", d.ID, err)
	}
	meta := map[string]interface{}{
		"distance":     d.Distance,
		"duration_min": d.DurationMin,
		"start_date":   d.StartDate.Format(time.RFC3339),
	}
	if d.EndDate != nil {
		meta["end_date"] = d.EndDate.Format(time.RFC3339)
	}
	return s.upsert(ctx, EntityDrive, d.ID, d.VehicleID, content, vec, meta)
}

// ----------------------------- Charge --------------------------------------

// ChargeSummary builds the embeddable text for a charging session.
func ChargeSummary(c *models.ChargingSession) string {
	endBat := c.StartBatteryLevel
	if c.EndBatteryLevel != nil {
		endBat = *c.EndBatteryLevel
	}
	power := derefFloat(c.ChargerPower)
	cost := derefFloat(c.Cost)
	location := derefStrPtr(c.LocationName, "unknown location")
	fastType := derefStrPtr(c.FastChargerType, "")

	return fmt.Sprintf(
		"Charge on %s at %s: %.1f kWh added in %.0f minutes, "+
			"battery %d%% to %d%%, peak power %.1f kW, cost $%.2f%s.",
		c.StartDate.Format("Jan 2 2006 15:04"),
		location,
		c.ChargeEnergyAdded, c.DurationMin,
		c.StartBatteryLevel, endBat,
		power, cost,
		formatFastCharger(fastType),
	)
}

func formatFastCharger(t string) string {
	if t == "" {
		return ""
	}
	return ", connector " + t
}

// GenerateChargeEmbedding embeds a single charging session and persists it.
func (s *Service) GenerateChargeEmbedding(ctx context.Context, c *models.ChargingSession) error {
	if !s.Enabled() {
		return ErrDisabled
	}
	content := ChargeSummary(c)
	vec, err := s.provider.Embed(ctx, content)
	if err != nil {
		return fmt.Errorf("embed charge %d: %w", c.ID, err)
	}
	meta := map[string]interface{}{
		"energy_kwh":   c.ChargeEnergyAdded,
		"duration_min": c.DurationMin,
		"start_date":   c.StartDate.Format(time.RFC3339),
	}
	if c.Cost != nil {
		meta["cost"] = *c.Cost
	}
	return s.upsert(ctx, EntityCharge, c.ID, c.VehicleID, content, vec, meta)
}

// ----------------------------- Alert ---------------------------------------

// AlertSummary builds the embeddable text for an alert.
func AlertSummary(a *models.Alert) string {
	sev := a.Severity
	if sev != "" {
		sev = strings.ToUpper(sev[:1]) + sev[1:]
	}
	return fmt.Sprintf(
		"%s alert (%s) on %s: %s — %s",
		sev, a.Type,
		a.CreatedAt.Format("Jan 2 2006 15:04"),
		a.Title, a.Message,
	)
}

// GenerateAlertEmbedding embeds a single alert and persists it. Alerts
// without a vehicle_id are skipped (the embeddings table requires one).
func (s *Service) GenerateAlertEmbedding(ctx context.Context, a *models.Alert) error {
	if !s.Enabled() {
		return ErrDisabled
	}
	if a.VehicleID == nil {
		return nil
	}
	content := AlertSummary(a)
	vec, err := s.provider.Embed(ctx, content)
	if err != nil {
		return fmt.Errorf("embed alert %d: %w", a.ID, err)
	}
	meta := map[string]interface{}{
		"type":     a.Type,
		"severity": a.Severity,
		"created":  a.CreatedAt.Format(time.RFC3339),
	}
	return s.upsert(ctx, EntityAlert, a.ID, *a.VehicleID, content, vec, meta)
}

// ----------------------------- Search --------------------------------------

// SearchOptions filters a Search call.
type SearchOptions struct {
	VehicleID   int64    // 0 = all vehicles
	EntityTypes []string // empty = all types
	Limit       int      // <=0 = 10
}

// Search returns entities most semantically similar to the query string,
// ordered by descending cosine similarity.
func (s *Service) Search(ctx context.Context, query string, opts SearchOptions) ([]SearchResult, error) {
	if !s.Enabled() {
		return nil, ErrDisabled
	}
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, errors.New("query is required")
	}
	if opts.Limit <= 0 {
		opts.Limit = 10
	}
	if opts.Limit > 100 {
		opts.Limit = 100
	}

	vec, err := s.provider.Embed(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("embed query: %w", err)
	}

	args := []interface{}{vectorLiteral(vec), opts.Limit}
	where := []string{}
	if opts.VehicleID > 0 {
		args = append(args, opts.VehicleID)
		where = append(where, fmt.Sprintf("vehicle_id = $%d", len(args)))
	}
	if len(opts.EntityTypes) > 0 {
		args = append(args, opts.EntityTypes)
		where = append(where, fmt.Sprintf("entity_type = ANY($%d)", len(args)))
	}
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = " WHERE " + strings.Join(where, " AND ")
	}
	sql := `
		SELECT entity_type, entity_id, vehicle_id, content, metadata,
		       1 - (embedding <=> $1::vector) AS similarity
		  FROM embeddings` + whereSQL + `
		 ORDER BY embedding <=> $1::vector
		 LIMIT $2`

	rows, err := s.db.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("search embeddings: %w", err)
	}
	defer rows.Close()

	var out []SearchResult
	for rows.Next() {
		var r SearchResult
		if err := rows.Scan(&r.EntityType, &r.EntityID, &r.VehicleID, &r.Content, &r.Metadata, &r.Similarity); err != nil {
			return nil, fmt.Errorf("scan embedding: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ----------------------------- Backfill ------------------------------------

// FindMissingDrives returns drive IDs that have no embedding yet, newest first.
func (s *Service) FindMissingDrives(ctx context.Context, limit int) ([]int64, error) {
	return s.findMissing(ctx,
		`SELECT d.id FROM drives d
		 LEFT JOIN embeddings e ON e.entity_type = 'drive' AND e.entity_id = d.id
		 WHERE e.id IS NULL AND d.end_date IS NOT NULL
		 ORDER BY d.start_date DESC
		 LIMIT $1`, limit)
}

// FindMissingCharges returns charge IDs that have no embedding yet.
func (s *Service) FindMissingCharges(ctx context.Context, limit int) ([]int64, error) {
	return s.findMissing(ctx,
		`SELECT c.id FROM charging_sessions c
		 LEFT JOIN embeddings e ON e.entity_type = 'charge' AND e.entity_id = c.id
		 WHERE e.id IS NULL AND c.end_date IS NOT NULL
		 ORDER BY c.start_date DESC
		 LIMIT $1`, limit)
}

// FindMissingAlerts returns alert IDs that have no embedding yet.
func (s *Service) FindMissingAlerts(ctx context.Context, limit int) ([]int64, error) {
	return s.findMissing(ctx,
		`SELECT a.id FROM alerts a
		 LEFT JOIN embeddings e ON e.entity_type = 'alert' AND e.entity_id = a.id
		 WHERE e.id IS NULL AND a.vehicle_id IS NOT NULL
		 ORDER BY a.created_at DESC
		 LIMIT $1`, limit)
}

func (s *Service) findMissing(ctx context.Context, sql string, limit int) ([]int64, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Pool.Query(ctx, sql, limit)
	if err != nil {
		return nil, fmt.Errorf("query missing entities: %w", err)
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ----------------------------- Helpers -------------------------------------

func derefInt(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

func derefFloat(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

func derefStr(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

func derefStrPtr(p *string, fallback string) string {
	if p == nil || *p == "" {
		return fallback
	}
	return *p
}
