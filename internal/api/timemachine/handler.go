package timemachine

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// tmDataTimeout bounds each cold-path read so a stalled connection cannot
// pin the request goroutine longer than the boundary rule allows. The
// pool's server-side statement_timeout is the backstop; this is the
// client-side deadline. A var (not const) so tests can shorten it.
var tmDataTimeout = 15 * time.Second

// maxFields caps the number of distinct fields returned by a single
// point-in-time reconstruction. signal_log routinely carries a few hundred
// distinct fields per vehicle; the cap keeps a single response bounded and
// prevents a mis-seeded / adversarial table from fanning the DISTINCT ON
// scan into an unbounded payload. A var (not const) so tests can shrink it.
var maxFields = 512

// protomodel.ValueKind values as stored in signal_log.value_kind. Exactly
// one typed column is non-null per row, dictated by this kind (see the
// column-mapping table in 000186_signal_log.up.sql). ValueKindCompound (8)
// is never logged (flattened by the codec) and ValueKindUnknown (0) /
// ValueKindInvalid (10) are dropped before the writer, so they collapse to
// the "unknown" label + a nil value here.
const (
	valueKindString = 1
	valueKindBool   = 2
	valueKindInt32  = 3
	valueKindInt64  = 4
	valueKindFloat  = 5
	valueKindDouble = 6
	valueKindEnum   = 7
	valueKindTime   = 9
)

// stateQuery reconstructs the last-known value of every distinct field for
// a vehicle at-or-before the requested instant. The inner DISTINCT ON walks
// each field's leading edge on the (vehicle_id, field, ts DESC) index and
// stops at the first row with ts <= $2; the outer wrapper orders the result
// alphabetically and caps it at $3 fields. Kept as a package-level constant
// so a test can pin the critical clauses without a live database.
const stateQuery = `
SELECT field, value_kind, str_value, bool_value, int_value, float_value, time_value, ts
FROM (
  SELECT DISTINCT ON (field)
         field, value_kind, str_value, bool_value, int_value, float_value, time_value, ts
  FROM signal_log
  WHERE vehicle_id = $1 AND ts <= $2
  ORDER BY field, ts DESC
) latest
ORDER BY field
LIMIT $3`

// rangeQuery bounds the scrubber: the oldest and newest observation for a
// vehicle plus how many distinct fields exist. MIN/MAX/COUNT over an empty
// set return (NULL, NULL, 0) in a single row — never zero rows — so callers
// scan into nullable pointers and a plain int.
const rangeQuery = `
SELECT MIN(ts) AS earliest, MAX(ts) AS latest, COUNT(DISTINCT field) AS field_count
FROM signal_log
WHERE vehicle_id = $1`

// Sentinel errors returned by parseAtParam. The handler surfaces their
// message verbatim in a 400 envelope; tests match with errors.Is.
var (
	// errAtMalformed is returned when `at` is present but not RFC 3339.
	errAtMalformed = errors.New("at: must be an RFC 3339 timestamp")
	// errAtFuture is returned when `at` lies after the now-anchor — a
	// Time Machine only reconstructs the past.
	errAtFuture = errors.New("at: must not be in the future")
)

// tmQuerier is the minimal pgx surface the handler needs. Declared locally
// so tests can drive every branch with a scripted row/row source without a
// live database or a vendored pgxmock (mirrors routeeff.routeQuerier).
// *pgxpool.Pool satisfies it.
type tmQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// TimeMachineHandler serves point-in-time vehicle-state reconstruction.
type TimeMachineHandler struct {
	db tmQuerier
}

// NewTimeMachineHandler wires the handler to the pgx pool. Panics on a nil
// pool — a nil pool is a wiring bug, not a runtime condition, so it
// surfaces at construction rather than as a nil-deref on the first request
// (mirrors routeeff.NewRouteEfficiencyHandler).
func NewTimeMachineHandler(db *database.DB) *TimeMachineHandler {
	if db == nil || db.Pool == nil {
		panic("timemachine.NewTimeMachineHandler: db pool must not be nil")
	}
	return &TimeMachineHandler{db: db.Pool}
}

// fieldState is one reconstructed field at the requested instant. Value is
// the single typed column dictated by ValueKind (SI-canonical for floats);
// the frontend converts to display units at the render boundary.
type fieldState struct {
	Field      string  `json:"field"`
	Value      any     `json:"value"`
	ValueKind  string  `json:"value_kind"`
	Ts         string  `json:"ts"`
	AgeSeconds float64 `json:"age_seconds"`
}

// stateResponse is the point-in-time reconstruction envelope.
type stateResponse struct {
	At     string       `json:"at"`
	Fields []fieldState `json:"fields"`
	Count  int          `json:"count"`
}

// rangeResponse bounds the scrubber. Earliest/Latest are nil when the
// vehicle has no signal_log history yet (fresh install / never ingested).
type rangeResponse struct {
	Earliest   *string `json:"earliest"`
	Latest     *string `json:"latest"`
	FieldCount int     `json:"field_count"`
}

// scannedSignal is the raw signal_log row shape. Exactly one typed column
// is non-nil per row, dictated by ValueKind (see 000186_signal_log).
type scannedSignal struct {
	Field     string
	ValueKind int16
	Str       *string
	Bool      *bool
	Int       *int64
	Float     *float64
	Time      *time.Time
	Ts        time.Time
}

// parseAtParam resolves the `at` query parameter into the instant at which
// state is reconstructed. Empty ⇒ the now-anchor (live state). A non-empty
// value must be RFC 3339 and must not lie in the future. The result is
// normalized to UTC. Pure + now-injected so handler tests can pin the
// future check without monkey-patching the clock.
func parseAtParam(raw string, now time.Time) (time.Time, error) {
	if raw == "" {
		return now.UTC(), nil
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}, errAtMalformed
	}
	t = t.UTC()
	if t.After(now) {
		return time.Time{}, errAtFuture
	}
	return t, nil
}

// valueKindLabel maps a protomodel.ValueKind to a stable, frontend-facing
// label. Int32/Int64 collapse to "int" (both land in int_value) and
// Float/Double collapse to "float" (both land in float_value); Enum keeps
// its own label so the UI can render it distinctly from a plain integer.
func valueKindLabel(kind int16) string {
	switch kind {
	case valueKindString:
		return "string"
	case valueKindBool:
		return "bool"
	case valueKindInt32, valueKindInt64:
		return "int"
	case valueKindEnum:
		return "enum"
	case valueKindFloat, valueKindDouble:
		return "float"
	case valueKindTime:
		return "time"
	default:
		return "unknown"
	}
}

// typedValue resolves the single typed column dictated by ValueKind into a
// JSON-ready value, plus the stable string label for the kind. A NULL in
// the dictated column yields (nil, label) so the field still renders with a
// null value rather than being silently dropped. Time values are rendered
// as RFC 3339 UTC strings so the wire shape is a string, not a nested
// timestamp object.
func typedValue(s scannedSignal) (any, string) {
	label := valueKindLabel(s.ValueKind)
	switch s.ValueKind {
	case valueKindString:
		if s.Str == nil {
			return nil, label
		}
		return *s.Str, label
	case valueKindBool:
		if s.Bool == nil {
			return nil, label
		}
		return *s.Bool, label
	case valueKindInt32, valueKindInt64, valueKindEnum:
		if s.Int == nil {
			return nil, label
		}
		return *s.Int, label
	case valueKindFloat, valueKindDouble:
		if s.Float == nil {
			return nil, label
		}
		return *s.Float, label
	case valueKindTime:
		if s.Time == nil {
			return nil, label
		}
		return s.Time.UTC().Format(time.RFC3339), label
	default:
		return nil, label
	}
}

// signalAge is how long before the reconstruction instant `at` the field
// last changed, in whole+fractional seconds. Never negative: stateQuery
// only returns rows with ts <= at, but a defensive clamp keeps a
// clock-skewed row from surfacing a negative age on the wire.
func signalAge(at, ts time.Time) float64 {
	age := at.Sub(ts).Seconds()
	if age < 0 {
		return 0
	}
	return age
}

// formatTimePtr renders a nullable timestamp as a nullable RFC 3339 UTC
// string so the JSON envelope carries `null` (not a zero-time string) when
// the vehicle has no history.
func formatTimePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

// State reconstructs the complete signal state of a vehicle at the instant
// given by `at` (RFC 3339; defaults to now). GET
// /api/v1/vehicles/{vehicleID}/time-machine?at=<RFC3339>.
func (h *TimeMachineHandler) State(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	at, err := parseAtParam(r.URL.Query().Get("at"), time.Now())
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), tmDataTimeout)
	defer cancel()

	rows, err := h.db.Query(ctx, stateQuery, vehicleID, at, maxFields)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("time machine: failed to query state")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to reconstruct vehicle state")
		return
	}
	defer rows.Close()

	fields := make([]fieldState, 0, 64)
	for rows.Next() {
		var s scannedSignal
		if err := rows.Scan(&s.Field, &s.ValueKind, &s.Str, &s.Bool, &s.Int, &s.Float, &s.Time, &s.Ts); err != nil {
			log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("time machine: scan state row")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to scan vehicle state")
			return
		}
		value, label := typedValue(s)
		fields = append(fields, fieldState{
			Field:      s.Field,
			Value:      value,
			ValueKind:  label,
			Ts:         s.Ts.UTC().Format(time.RFC3339),
			AgeSeconds: signalAge(at, s.Ts),
		})
	}
	if err := rows.Err(); err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("time machine: state rows iteration")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read vehicle state")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, stateResponse{
		At:     at.Format(time.RFC3339),
		Fields: fields,
		Count:  len(fields),
	})
}

// Range bounds the scrubber for a vehicle: the earliest and latest
// observation plus the distinct field count. GET
// /api/v1/vehicles/{vehicleID}/time-machine/range.
func (h *TimeMachineHandler) Range(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), tmDataTimeout)
	defer cancel()

	var earliest, latest *time.Time
	var fieldCount int
	if err := h.db.QueryRow(ctx, rangeQuery, vehicleID).Scan(&earliest, &latest, &fieldCount); err != nil {
		// The aggregate always returns exactly one row, so ErrNoRows is
		// defensive; treat it as "no history" rather than a 500.
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteJSON(w, http.StatusOK, rangeResponse{FieldCount: 0})
			return
		}
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("time machine: failed to query range")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query time machine range")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, rangeResponse{
		Earliest:   formatTimePtr(earliest),
		Latest:     formatTimePtr(latest),
		FieldCount: fieldCount,
	})
}
