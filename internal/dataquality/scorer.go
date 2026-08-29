// Package dataquality computes per-signal freshness, gap, and duplicate
// scores from signal_log + telemetry counters. Surfaced via
// /admin/observability/data-quality so operators can spot a degraded
// signal field before downstream consumers notice.
//
// Two primitives:
//
//   - Scorer queries signal_log via a narrow Querier interface and
//     produces a per-field FieldScore (freshness/gap/duplicate plus a
//     composite 0..100 quality score).
//   - LineageGraph reads routing.yaml at boot and exposes the static
//     pipeline graph (source field → router → writer → table) so the
//     SPA can render a Sankey/DAG that shows which tables a slow field
//     would impact.
//
// The package is read-only and side-effect free. Scorer queries are
// bounded by context timeout so a slow Postgres doesn't stall the
// admin dashboard.
package dataquality

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Querier is the narrow read interface the Scorer needs. Mirrors the
// pgxpool.Pool API surface used by every other read-only repo so the
// app can pass *database.DB.Pool directly.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (Rows, error)
}

// Rows mirrors pgx.Rows with the minimal surface area we need.
type Rows interface {
	Next() bool
	Scan(dest ...any) error
	Close()
	Err() error
}

// FieldScore is the per-signal quality summary returned by Scorer.
// Composite ranges 0..100 where 100 = perfect (zero gaps, no dupes,
// fresh < 60s). 0 = stale, gaps everywhere, every other sample is a
// duplicate of the previous.
type FieldScore struct {
	Field                      string    `json:"field"`
	SampleCount                int64     `json:"sample_count"`
	LastSeenAt                 time.Time `json:"last_seen_at"`
	FreshnessSeconds           float64   `json:"freshness_seconds"`
	MaxGapSeconds              float64   `json:"max_gap_seconds"`
	DuplicateRatio             float64   `json:"duplicate_ratio"` // 0..1 fraction of comparable consecutive samples whose typed value matches
	VersionedSampleCount       int64     `json:"versioned_sample_count"`
	UnversionedSampleCount     int64     `json:"unversioned_sample_count"`
	NormalizationCoveragePct   *float64  `json:"normalization_coverage_pct"`
	NormalizationCoverageState string    `json:"normalization_coverage_state"` // measured | unknown
	CompositeScore             float64   `json:"composite_score"`              // 0..100, higher = healthier
	Severity                   string    `json:"severity"`                     // ok | warn | critical
}

// NormalizationVersionCount is one bucket of the bounded
// `GROUP BY normalization_version` distribution. Version is nil when the
// persisted rows carry no attestation at all (legacy/unknown provenance);
// that is a distinct fact from "version 0" and is never coerced to a number.
type NormalizationVersionCount struct {
	Version     *int16   `json:"version"`
	SampleCount int64    `json:"sample_count"`
	SharePct    *float64 `json:"share_pct"` // nil when the window holds zero samples
}

// NormalizationSummary is the aggregate normalization-version coverage over
// the same bounded window used for the per-field scores. CoveragePct is
// deliberately nullable: an empty window yields nil (unknown), never a
// fabricated 0%.
type NormalizationSummary struct {
	RequiredVersion        int16                       `json:"required_version"`
	TotalSampleCount       int64                       `json:"total_sample_count"`
	VersionedSampleCount   int64                       `json:"versioned_sample_count"`
	UnversionedSampleCount int64                       `json:"unversioned_sample_count"`
	CoveragePct            *float64                    `json:"coverage_pct"`
	CoverageState          string                      `json:"coverage_state"` // measured | unknown
	Versions               []NormalizationVersionCount `json:"versions"`
}

// Snapshot is the full board response.
type Snapshot struct {
	GeneratedAt                  time.Time            `json:"generated_at"`
	WindowStart                  time.Time            `json:"window_start"`
	WindowEnd                    time.Time            `json:"window_end"`
	WindowMins                   int                  `json:"window_mins"`
	RequiredNormalizationVersion int16                `json:"required_normalization_version"`
	Normalization                NormalizationSummary `json:"normalization"`
	FirmwareAssignment           string               `json:"firmware_assignment"`
	FirmwareSegments             []FirmwareSegment    `json:"firmware_segments"`
	Fields                       []FieldScore         `json:"fields"`
}

// FirmwareSegment applies the latest firmware observed at the window end as
// bounded vehicle context. It does not claim that every row in the window was
// emitted on that version.
type FirmwareSegment struct {
	FirmwareVersion            *string      `json:"firmware_version"`
	FirmwareEvidenceState      string       `json:"firmware_evidence_state"` // known | unknown
	VehicleCount               int64        `json:"vehicle_count"`
	TotalSampleCount           int64        `json:"total_sample_count"`
	VersionedSampleCount       int64        `json:"versioned_sample_count"`
	UnversionedSampleCount     int64        `json:"unversioned_sample_count"`
	NormalizationCoveragePct   *float64     `json:"normalization_coverage_pct"`
	NormalizationCoverageState string       `json:"normalization_coverage_state"` // measured | unknown
	Fields                     []FieldScore `json:"fields"`
}

// Scorer is the read-side primitive. Construct via NewScorer.
type Scorer struct {
	pool       Querier
	now        func() time.Time
	queryTime  time.Duration
	windowMins int
}

// NewScorer wires the scorer against a pgx pool. windowMins is the
// look-back window used by all per-field aggregates; default 60 when
// passed <=0.
func NewScorer(pool Querier, windowMins int) *Scorer {
	if windowMins <= 0 {
		windowMins = 60
	}
	return &Scorer{
		pool:       pool,
		now:        time.Now,
		queryTime:  10 * time.Second,
		windowMins: windowMins,
	}
}

// ErrNotConfigured is returned by Snapshot when the scorer was
// constructed without a pool — the admin handler surfaces this as 503
// SUBSYSTEM_NOT_CONFIGURED.
var ErrNotConfigured = errors.New("dataquality: signal_log pool not configured")

const scoreQuery = `
WITH window_base AS MATERIALIZED (
  SELECT vehicle_id, field, ts, value_kind, normalization_version,
         str_value, bool_value, int_value, float_value, time_value
    FROM signal_log
   WHERE ts >= $1::timestamptz
     AND ts <= $2::timestamptz
), window_vehicles AS (
  SELECT DISTINCT vehicle_id FROM window_base
), firmware_context AS (
  -- Canonicalize firmware provenance in SQL so exactly ONE unknown group
  -- exists. A vehicle with no 'Version' signal yields SQL NULL from the
  -- LEFT JOIN LATERAL, while a vehicle that reported an empty or
  -- whitespace-only Version yields ''. Left un-canonicalized these become
  -- two distinct GROUP BY keys, which (a) splits one field into duplicate
  -- FieldScore rows the Go merge then appends twice, and (b) undercounts
  -- vehicle_count because each partial group counts only its own vehicles.
  -- NULLIF(btrim(...), '') folds both to NULL before any aggregation.
  SELECT vehicles.vehicle_id,
         NULLIF(btrim(firmware.str_value), '') AS firmware_version
    FROM window_vehicles vehicles
    LEFT JOIN LATERAL (
      SELECT str_value
        FROM signal_log
       WHERE vehicle_id = vehicles.vehicle_id
         AND field = 'Version'
         AND value_kind = 1
         AND ts <= $2::timestamptz
       ORDER BY ts DESC
       LIMIT 1
    ) firmware ON true
), window_rows AS (
  SELECT base.vehicle_id, base.field, base.ts, base.value_kind, base.normalization_version,
         base.str_value, base.bool_value, base.int_value, base.float_value, base.time_value,
         firmware_context.firmware_version,
         LAG(base.value_kind)  OVER signal_stream AS prev_kind,
         LAG(base.str_value)   OVER signal_stream AS prev_str,
         LAG(base.bool_value)  OVER signal_stream AS prev_bool,
         LAG(base.int_value)   OVER signal_stream AS prev_int,
         LAG(base.float_value) OVER signal_stream AS prev_float,
         LAG(base.time_value)  OVER signal_stream AS prev_time,
         LAG(base.ts)          OVER signal_stream AS prev_ts
    FROM window_base base
    LEFT JOIN firmware_context ON firmware_context.vehicle_id = base.vehicle_id
  WINDOW signal_stream AS (PARTITION BY base.vehicle_id, base.field ORDER BY base.ts)
), segment_counts AS (
  SELECT firmware_version, count(DISTINCT vehicle_id) AS vehicle_count
    FROM window_rows
   GROUP BY firmware_version
), segment_fields AS (
  SELECT firmware_version, field,
         count(*) AS sample_count,
         max(ts) AS last_seen,
         COALESCE(max(EXTRACT(EPOCH FROM (ts - prev_ts))), 0) AS max_gap_seconds,
         sum(CASE
               WHEN prev_ts IS NULL THEN 0
               WHEN value_kind <> prev_kind THEN 0
               WHEN value_kind = 1 AND str_value IS NOT DISTINCT FROM prev_str THEN 1
               WHEN value_kind = 2 AND bool_value IS NOT DISTINCT FROM prev_bool THEN 1
               WHEN value_kind IN (3, 4, 7) AND int_value IS NOT DISTINCT FROM prev_int THEN 1
               WHEN value_kind IN (5, 6) AND float_value IS NOT DISTINCT FROM prev_float THEN 1
               WHEN value_kind = 9 AND time_value IS NOT DISTINCT FROM prev_time THEN 1
               ELSE 0
             END) AS duplicate_count,
         count(*) FILTER (WHERE prev_ts IS NOT NULL) AS comparison_count,
         count(*) FILTER (WHERE normalization_version >= 1) AS versioned_sample_count,
         count(*) FILTER (
           WHERE normalization_version IS NULL OR normalization_version < 1
         ) AS unversioned_sample_count
    FROM window_rows
   GROUP BY firmware_version, field
)
SELECT fields.firmware_version, counts.vehicle_count, fields.field,
       fields.sample_count, fields.last_seen, fields.max_gap_seconds,
       fields.duplicate_count, fields.comparison_count,
       fields.versioned_sample_count,
       fields.unversioned_sample_count
  FROM segment_fields fields
  JOIN segment_counts counts
    ON counts.firmware_version IS NOT DISTINCT FROM fields.firmware_version
 ORDER BY fields.firmware_version NULLS FIRST, fields.field`

// normalizationVersionQuery is the second bounded aggregate. It is a plain
// GROUP BY over the SAME [$1, $2] ts window so TimescaleDB can exclude every
// chunk outside the window, and it deliberately avoids window functions so
// the distribution cannot drift from the raw row counts. NULL is preserved
// as its own bucket — legacy/unknown provenance is a fact, not a zero.
const normalizationVersionQuery = `
SELECT normalization_version, count(*) AS sample_count
  FROM signal_log
 WHERE ts >= $1::timestamptz
   AND ts <= $2::timestamptz
 GROUP BY normalization_version
 ORDER BY normalization_version NULLS FIRST`

// requiredNormalizationVersion is the lowest normalization contract version
// that counts as attested SI provenance (migration 000232).
const requiredNormalizationVersion int16 = 1

const (
	coverageStateMeasured = "measured"
	coverageStateUnknown  = "unknown"
)

// unknownFirmwareKey is the single canonical grouping key for vehicles whose
// firmware provenance could not be established. SQL folds NULL and empty /
// whitespace-only Version strings to NULL before aggregating, so exactly one
// unknown segment can exist per snapshot.
const unknownFirmwareKey = "<unknown>"

// mergeFieldScores folds two scores for the SAME field into one. Counts are
// additive, the largest observed gap wins, and freshness is re-derived from
// the later last-seen timestamp so the composite/severity stay self-consistent
// with the merged inputs rather than being copied from one side.
func mergeFieldScores(a, b FieldScore, windowEnd time.Time) FieldScore {
	lastSeen := a.LastSeenAt
	if b.LastSeenAt.After(lastSeen) {
		lastSeen = b.LastSeenAt
	}
	// Recover each side's absolute duplicate/comparison counts from its ratio
	// so the merged ratio is a true weighted combination, not an average of
	// averages. comparisonCount is unavailable post-scoring, so weight by
	// sample count — the only denominator both sides still carry.
	weighted := a.DuplicateRatio*float64(a.SampleCount) + b.DuplicateRatio*float64(b.SampleCount)
	totalSamples := a.SampleCount + b.SampleCount
	duplicateRatio := 0.0
	if totalSamples > 0 {
		duplicateRatio = weighted / float64(totalSamples)
	}
	merged := FieldScore{
		Field:                      a.Field,
		SampleCount:                totalSamples,
		LastSeenAt:                 lastSeen,
		FreshnessSeconds:           max(0, windowEnd.Sub(lastSeen).Seconds()),
		MaxGapSeconds:              max(a.MaxGapSeconds, b.MaxGapSeconds),
		DuplicateRatio:             duplicateRatio,
		VersionedSampleCount:       a.VersionedSampleCount + b.VersionedSampleCount,
		UnversionedSampleCount:     a.UnversionedSampleCount + b.UnversionedSampleCount,
		NormalizationCoverageState: coverageStateUnknown,
	}
	merged.NormalizationCoveragePct = coveragePercent(merged.VersionedSampleCount, merged.SampleCount)
	if merged.NormalizationCoveragePct != nil {
		merged.NormalizationCoverageState = coverageStateMeasured
	}
	merged.CompositeScore = compositeScore(merged)
	merged.Severity = severity(merged)
	return merged
}

type fieldAccumulator struct {
	sampleCount      int64
	lastSeenAt       time.Time
	maxGapSeconds    float64
	duplicateCount   int64
	comparisonCount  int64
	versionedCount   int64
	unversionedCount int64
}

// Snapshot pulls per-field and firmware-context scores from one materialized,
// bounded signal_log window, then layers the normalization-version
// distribution from a second aggregate over the SAME window. Results are
// sorted worst-first.
//
// The two queries are issued strictly in sequence: collectFieldScores owns
// and closes its cursor before collectNormalization opens the next one, so a
// single pooled connection is never asked to hold two live result sets.
func (s *Scorer) Snapshot(ctx context.Context) (*Snapshot, error) {
	if s == nil || s.pool == nil {
		return nil, ErrNotConfigured
	}
	qctx, cancel := context.WithTimeout(ctx, s.queryTime)
	defer cancel()

	windowEnd := s.now().UTC()
	windowStart := windowEnd.Add(-time.Duration(s.windowMins) * time.Minute)

	out := &Snapshot{
		GeneratedAt:                  windowEnd,
		WindowStart:                  windowStart,
		WindowEnd:                    windowEnd,
		WindowMins:                   s.windowMins,
		RequiredNormalizationVersion: requiredNormalizationVersion,
		FirmwareAssignment:           "latest_version_at_window_end",
		FirmwareSegments:             []FirmwareSegment{},
		Fields:                       []FieldScore{},
		Normalization: NormalizationSummary{
			RequiredVersion: requiredNormalizationVersion,
			CoverageState:   coverageStateUnknown,
			Versions:        []NormalizationVersionCount{},
		},
	}
	if err := s.collectFieldScores(qctx, out, windowStart, windowEnd); err != nil {
		return nil, err
	}
	normalization, err := s.collectNormalization(qctx, windowStart, windowEnd)
	if err != nil {
		return nil, err
	}
	out.Normalization = normalization
	return out, nil
}

// collectFieldScores runs the materialized per-field/per-firmware aggregate
// and populates out.Fields + out.FirmwareSegments. Its cursor is closed on
// return so the caller can safely issue the follow-up query.
func (s *Scorer) collectFieldScores(
	ctx context.Context,
	out *Snapshot,
	windowStart, windowEnd time.Time,
) error {
	rows, err := s.pool.Query(ctx, scoreQuery, windowStart, windowEnd)
	if err != nil {
		return fmt.Errorf("signal_log score query: %w", err)
	}
	defer rows.Close()

	segmentsByKey := make(map[string]*FirmwareSegment)
	// segmentFieldIndex[key][field] -> position in segment.Fields, so a
	// repeated (segment, field) pair merges instead of duplicating.
	segmentFieldIndex := make(map[string]map[string]int)
	keys := make([]string, 0)
	fields := make(map[string]*fieldAccumulator)
	for rows.Next() {
		var (
			firmwareVersion *string
			vehicleCount    int64
			fieldName       string
			sampleCount     int64
			lastSeenAt      time.Time
			maxGapSeconds   float64
			duplicateCount  int64
			comparisonCount int64
			versionedCount  int64
			unversioned     int64
		)
		if err := rows.Scan(
			&firmwareVersion,
			&vehicleCount,
			&fieldName,
			&sampleCount,
			&lastSeenAt,
			&maxGapSeconds,
			&duplicateCount,
			&comparisonCount,
			&versionedCount,
			&unversioned,
		); err != nil {
			return fmt.Errorf("scan: %w", err)
		}
		field := scoredField(
			fieldName,
			sampleCount,
			lastSeenAt,
			maxGapSeconds,
			duplicateCount,
			comparisonCount,
			versionedCount,
			unversioned,
			windowEnd,
		)

		// Defence in depth. The SQL already folds NULL and ''/whitespace into
		// a single NULL group (see firmware_context), so only one unknown key
		// can reach here. Should a future query regress, this merge must
		// still refuse to undercount vehicles or emit duplicate field scores.
		key := unknownFirmwareKey
		if firmwareVersion != nil && strings.TrimSpace(*firmwareVersion) != "" {
			key = strings.TrimSpace(*firmwareVersion)
			canonical := key
			firmwareVersion = &canonical
		} else {
			firmwareVersion = nil
		}
		segment, exists := segmentsByKey[key]
		if !exists {
			state := "unknown"
			if firmwareVersion != nil {
				state = "known"
			}
			segment = &FirmwareSegment{
				FirmwareVersion:            firmwareVersion,
				FirmwareEvidenceState:      state,
				NormalizationCoverageState: coverageStateUnknown,
				Fields:                     []FieldScore{},
			}
			segmentsByKey[key] = segment
			segmentFieldIndex[key] = make(map[string]int)
			keys = append(keys, key)
		}
		// vehicle_count is a per-group aggregate, identical on every row of
		// the group. Taking the max (rather than only the first row's value)
		// keeps the count correct even if two partial groups ever merge here.
		segment.VehicleCount = max(segment.VehicleCount, vehicleCount)
		segment.TotalSampleCount += field.SampleCount
		segment.VersionedSampleCount += field.VersionedSampleCount
		segment.UnversionedSampleCount += field.UnversionedSampleCount
		if at, dup := segmentFieldIndex[key][fieldName]; dup {
			// Same (segment, field) seen twice: fold the counts into the
			// existing score instead of listing the field twice.
			segment.Fields[at] = mergeFieldScores(segment.Fields[at], field, windowEnd)
		} else {
			segmentFieldIndex[key][fieldName] = len(segment.Fields)
			segment.Fields = append(segment.Fields, field)
		}

		accumulator, exists := fields[fieldName]
		if !exists {
			accumulator = &fieldAccumulator{}
			fields[fieldName] = accumulator
		}
		accumulator.sampleCount += sampleCount
		if lastSeenAt.After(accumulator.lastSeenAt) {
			accumulator.lastSeenAt = lastSeenAt
		}
		accumulator.maxGapSeconds = max(accumulator.maxGapSeconds, maxGapSeconds)
		accumulator.duplicateCount += duplicateCount
		accumulator.comparisonCount += comparisonCount
		accumulator.versionedCount += versionedCount
		accumulator.unversionedCount += unversioned
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("rows.Err: %w", err)
	}

	sort.Slice(keys, func(i, j int) bool {
		if keys[i] == unknownFirmwareKey {
			return keys[j] != unknownFirmwareKey
		}
		if keys[j] == unknownFirmwareKey {
			return false
		}
		return keys[i] < keys[j]
	})
	for _, key := range keys {
		segment := segmentsByKey[key]
		segment.NormalizationCoveragePct = coveragePercent(
			segment.VersionedSampleCount,
			segment.TotalSampleCount,
		)
		if segment.NormalizationCoveragePct != nil {
			segment.NormalizationCoverageState = coverageStateMeasured
		}
		sort.Slice(segment.Fields, func(i, j int) bool {
			return segment.Fields[i].CompositeScore < segment.Fields[j].CompositeScore
		})
		out.FirmwareSegments = append(out.FirmwareSegments, *segment)
	}

	for fieldName, accumulator := range fields {
		out.Fields = append(out.Fields, scoredField(
			fieldName,
			accumulator.sampleCount,
			accumulator.lastSeenAt,
			accumulator.maxGapSeconds,
			accumulator.duplicateCount,
			accumulator.comparisonCount,
			accumulator.versionedCount,
			accumulator.unversionedCount,
			windowEnd,
		))
	}
	sort.Slice(out.Fields, func(i, j int) bool {
		return out.Fields[i].CompositeScore < out.Fields[j].CompositeScore
	})
	return nil
}

// collectNormalization runs the bounded GROUP BY normalization_version
// aggregate. CoveragePct stays nil for an empty window: reporting 0% for
// "no rows observed" would fabricate a failing measurement out of absence.
func (s *Scorer) collectNormalization(
	ctx context.Context,
	windowStart, windowEnd time.Time,
) (NormalizationSummary, error) {
	summary := NormalizationSummary{
		RequiredVersion: requiredNormalizationVersion,
		CoverageState:   coverageStateUnknown,
		Versions:        []NormalizationVersionCount{},
	}
	rows, err := s.pool.Query(ctx, normalizationVersionQuery, windowStart, windowEnd)
	if err != nil {
		return NormalizationSummary{}, fmt.Errorf("signal_log normalization version query: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			version     *int16
			sampleCount int64
		)
		if err := rows.Scan(&version, &sampleCount); err != nil {
			return NormalizationSummary{}, fmt.Errorf("scan normalization version: %w", err)
		}
		summary.TotalSampleCount += sampleCount
		if version != nil && *version >= requiredNormalizationVersion {
			summary.VersionedSampleCount += sampleCount
		} else {
			summary.UnversionedSampleCount += sampleCount
		}
		summary.Versions = append(summary.Versions, NormalizationVersionCount{
			Version:     version,
			SampleCount: sampleCount,
		})
	}
	if err := rows.Err(); err != nil {
		return NormalizationSummary{}, fmt.Errorf("normalization rows.Err: %w", err)
	}

	summary.CoveragePct = coveragePercent(summary.VersionedSampleCount, summary.TotalSampleCount)
	if summary.CoveragePct != nil {
		summary.CoverageState = coverageStateMeasured
	}
	for i := range summary.Versions {
		summary.Versions[i].SharePct = coveragePercent(
			summary.Versions[i].SampleCount,
			summary.TotalSampleCount,
		)
	}
	return summary, nil
}

func scoredField(
	field string,
	sampleCount int64,
	lastSeenAt time.Time,
	maxGapSeconds float64,
	duplicateCount, comparisonCount int64,
	versionedCount, unversionedCount int64,
	windowEnd time.Time,
) FieldScore {
	duplicateRatio := 0.0
	if comparisonCount > 0 {
		duplicateRatio = float64(duplicateCount) / float64(comparisonCount)
	}
	score := FieldScore{
		Field:                      field,
		SampleCount:                sampleCount,
		LastSeenAt:                 lastSeenAt,
		FreshnessSeconds:           max(0, windowEnd.Sub(lastSeenAt).Seconds()),
		MaxGapSeconds:              maxGapSeconds,
		DuplicateRatio:             duplicateRatio,
		VersionedSampleCount:       versionedCount,
		UnversionedSampleCount:     unversionedCount,
		NormalizationCoveragePct:   coveragePercent(versionedCount, sampleCount),
		NormalizationCoverageState: coverageStateUnknown,
	}
	if score.NormalizationCoveragePct != nil {
		score.NormalizationCoverageState = coverageStateMeasured
	}
	score.CompositeScore = compositeScore(score)
	score.Severity = severity(score)
	return score
}

func coveragePercent(normalized, total int64) *float64 {
	if total <= 0 {
		return nil
	}
	value := float64(normalized) / float64(total) * 100
	return &value
}

// compositeScore turns the three sub-scores into a single 0..100
// quality score. Each axis contributes a third; the contributions are
// independent so a field can be fresh but full of duplicates.
//
//   - freshness: 100 for <60s, decays linearly to 0 at >=600s
//   - gap:      100 for <30s max gap, linearly to 0 at >=300s
//   - duplicates: 100 for <1%, linearly to 0 at >=50%
func compositeScore(fs FieldScore) float64 {
	freshness := linearScore(fs.FreshnessSeconds, 60, 600)
	gap := linearScore(fs.MaxGapSeconds, 30, 300)
	dupe := linearScore(fs.DuplicateRatio*100, 1, 50)
	score := (freshness + gap + dupe) / 3
	if score < 0 {
		return 0
	}
	if score > 100 {
		return 100
	}
	return score
}

// linearScore returns 100 when x <= ok, 0 when x >= bad, and a linear
// interpolation between.
func linearScore(x, ok, bad float64) float64 {
	if x <= ok {
		return 100
	}
	if x >= bad {
		return 0
	}
	return 100 * (1 - (x-ok)/(bad-ok))
}

func severity(fs FieldScore) string {
	switch {
	case fs.CompositeScore >= 80:
		return "ok"
	case fs.CompositeScore >= 50:
		return "warn"
	default:
		return "critical"
	}
}
