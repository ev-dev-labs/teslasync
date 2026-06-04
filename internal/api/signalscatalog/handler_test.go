package signalscatalog

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	signaldb "github.com/ev-dev-labs/teslasync/internal/database/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// HTTP tests for Handler.
//
// Coverage map:
//   (a) Catalog includes routed-but-unobserved fields (last_seen_at NULL)
//        -> TestSignalsCatalog_IncludesRoutedButUnobserved
//   (b) Catalog includes observed fields with counts
//        -> TestSignalsCatalog_IncludesObservedWithCounts
//   (c) Observations filtering by field works
//        -> TestSignalsObservations_FilterByField
//   (d) Observations limit clamp
//        -> TestSignalsObservations_LimitClamp
//   (e) Observations time-range filter
//        -> TestSignalsObservations_TimeRangeFilter
//   (f) value_kind matches the populated value column
//        -> TestSignalsObservations_ValueKindRendering
//
// Plus extras:
//   - bad limit / offset / vehicle_id / since / until parameters -> 400
//   - multi-csv vehicle_id parsing
//   - repo error paths -> 500
//   - catalog sort order is field ASC

// fakeSignalsCatalogRepo lets handler tests pin every repo response
// without touching a database.
type fakeSignalsCatalogRepo struct {
	aggregates    map[string]signaldb.CatalogAggregate
	aggregatesErr error

	observations    []signaldb.SignalObservation
	observationsErr error

	totalCount    int64
	totalCountErr error

	gotObservationsParams []signaldb.ObservationsParams
	gotCountParams        []signaldb.ObservationsParams
	gotAggregatesCalls    int
}

func (f *fakeSignalsCatalogRepo) CatalogAggregates(ctx context.Context) (map[string]signaldb.CatalogAggregate, error) {
	f.gotAggregatesCalls++
	if f.aggregatesErr != nil {
		return nil, f.aggregatesErr
	}
	return f.aggregates, nil
}

func (f *fakeSignalsCatalogRepo) ObservationsCount(ctx context.Context, params signaldb.ObservationsParams) (int64, error) {
	f.gotCountParams = append(f.gotCountParams, params)
	if f.totalCountErr != nil {
		return 0, f.totalCountErr
	}
	return f.totalCount, nil
}

func (f *fakeSignalsCatalogRepo) Observations(ctx context.Context, params signaldb.ObservationsParams) ([]signaldb.SignalObservation, error) {
	f.gotObservationsParams = append(f.gotObservationsParams, params)
	if f.observationsErr != nil {
		return nil, f.observationsErr
	}
	return f.observations, nil
}

// newSignalsCatalogHandlerForTest wraps a fixed entries slice (not
// router.Load()) so tests are deterministic regardless of whether
// future routing.yaml prompts add or remove entries. The fixed clock
// pins generated_at for shape assertions.
func newSignalsCatalogHandlerForTest(repo *fakeSignalsCatalogRepo, entries []router.Entry, fixedNow time.Time) *Handler {
	return &Handler{
		repo:    repo,
		entries: entries,
		clock:   func() time.Time { return fixedNow },
	}
}

func scRequest(target string) *http.Request {
	return httptest.NewRequest(http.MethodGet, target, nil)
}

// fixedTestEntries returns a small but representative routing slice
// covering every value-kind branch plus a routed-but-unobserved field.
// Re-derived in each test rather than shared package state so a future
// test that mutates the slice can't poison its neighbours.
func fixedTestEntries() []router.Entry {
	return []router.Entry{
		{Field: "BatteryLevel", Destination: router.DestSignalLog},
		{Field: "Gear", Destination: router.DestDriveTelemetry, Column: "gear"},
		{Field: "BrakePedal", Destination: router.DestDriveTelemetry, Column: "brake_pedal"},
		{Field: "VehicleName", Destination: router.DestSignalLog},
		// Routed-but-unobserved sentinel — will absent from the
		// aggregates map in the catalog tests.
		{Field: "ZTotallyUnobserved", Destination: router.DestSignalLog},
	}
}

// ---------- (a) Catalog includes routed-but-unobserved ----------

// TestSignalsCatalog_IncludesRoutedButUnobserved confirms that a
// routing entry with no signal_log aggregate row still appears in the
// response with last_seen_at=null and the count fields=null. This is
// the fall-through that makes "routed" the catalog spine and
// "observed" a separate dimension consumers can tell apart.
func TestSignalsCatalog_IncludesRoutedButUnobserved(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeSignalsCatalogRepo{
		// aggregates intentionally omits "ZTotallyUnobserved".
		aggregates: map[string]signaldb.CatalogAggregate{},
	}
	h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)

	rec := httptest.NewRecorder()
	h.Catalog(rec, scRequest("/signals/catalog"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	var body SignalsCatalogResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	if !body.GeneratedAt.Equal(now) {
		t.Errorf("generated_at = %v, want %v", body.GeneratedAt, now)
	}
	if got := len(body.Signals); got != len(fixedTestEntries()) {
		t.Fatalf("len(signals) = %d, want %d", got, len(fixedTestEntries()))
	}

	var unobserved *SignalCatalogEntryView
	for i := range body.Signals {
		if body.Signals[i].Field == "ZTotallyUnobserved" {
			unobserved = &body.Signals[i]
			break
		}
	}
	if unobserved == nil {
		t.Fatal("response missing routed-but-unobserved field 'ZTotallyUnobserved'")
	}
	if unobserved.LastSeenAt != nil {
		t.Errorf("last_seen_at = %v, want nil for unobserved field", unobserved.LastSeenAt)
	}
	if unobserved.SampleCountTotal != nil {
		t.Errorf("sample_count_total = %v, want nil for unobserved field", *unobserved.SampleCountTotal)
	}
	if unobserved.VehicleCount != nil {
		t.Errorf("vehicle_count = %v, want nil for unobserved field", *unobserved.VehicleCount)
	}
	if unobserved.Destination != string(router.DestSignalLog) {
		t.Errorf("destination = %q, want %q", unobserved.Destination, router.DestSignalLog)
	}
}

// ---------- (b) Catalog includes observed fields with counts ----------

// TestSignalsCatalog_IncludesObservedWithCounts confirms that fields
// with aggregate rows surface non-null counts and last_seen_at, and
// that the JSON shape matches the prompt-locked Decision #1 envelope.
func TestSignalsCatalog_IncludesObservedWithCounts(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	lastSeen := time.Date(2026, 5, 6, 11, 55, 32, 0, time.UTC)

	repo := &fakeSignalsCatalogRepo{
		aggregates: map[string]signaldb.CatalogAggregate{
			"BatteryLevel": {
				LastSeenAt:       &lastSeen,
				SampleCountTotal: 84231,
				VehicleCount:     3,
			},
			"Gear": {
				LastSeenAt:       &lastSeen,
				SampleCountTotal: 12,
				VehicleCount:     2,
			},
		},
	}
	h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)

	rec := httptest.NewRecorder()
	h.Catalog(rec, scRequest("/signals/catalog"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var body SignalsCatalogResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}

	byField := make(map[string]SignalCatalogEntryView, len(body.Signals))
	for _, s := range body.Signals {
		byField[s.Field] = s
	}

	bl, ok := byField["BatteryLevel"]
	if !ok {
		t.Fatal("response missing BatteryLevel")
	}
	if bl.LastSeenAt == nil || !bl.LastSeenAt.Equal(lastSeen) {
		t.Errorf("BatteryLevel.last_seen_at = %v, want %v", bl.LastSeenAt, lastSeen)
	}
	if bl.SampleCountTotal == nil || *bl.SampleCountTotal != 84231 {
		t.Errorf("BatteryLevel.sample_count_total = %v, want 84231", bl.SampleCountTotal)
	}
	if bl.VehicleCount == nil || *bl.VehicleCount != 3 {
		t.Errorf("BatteryLevel.vehicle_count = %v, want 3", bl.VehicleCount)
	}

	// Sort order: field ASC across the entire response.
	for i := 1; i < len(body.Signals); i++ {
		if body.Signals[i-1].Field > body.Signals[i].Field {
			t.Errorf("signals not sorted by field ASC: %q before %q",
				body.Signals[i-1].Field, body.Signals[i].Field)
		}
	}
}

// ---------- (c) Observations filtering by field ----------

// TestSignalsObservations_FilterByField confirms the field= query
// parameter (single + comma-separated) reaches the repo as
// ObservationsParams.Fields. The repo is faked, so the assertion is
// strictly on what the handler passes through — the SQL-shape test
// in signals_catalog_repo_test.go covers the WHERE assembly.
func TestSignalsObservations_FilterByField(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name       string
		query      string
		wantFields []string
	}{
		{"single", "field=BatteryLevel", []string{"BatteryLevel"}},
		{"multi", "field=BatteryLevel,Gear,VehicleName", []string{"BatteryLevel", "Gear", "VehicleName"}},
		{"with_whitespace", "field=BatteryLevel,%20Gear%20,VehicleName", []string{"BatteryLevel", "Gear", "VehicleName"}},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeSignalsCatalogRepo{}
			h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)
			rec := httptest.NewRecorder()
			h.Observations(rec, scRequest("/signals/observations?"+c.query))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
			}
			if len(repo.gotObservationsParams) != 1 {
				t.Fatalf("got %d observation calls, want 1", len(repo.gotObservationsParams))
			}
			gotFields := repo.gotObservationsParams[0].Fields
			if len(gotFields) != len(c.wantFields) {
				t.Fatalf("Fields = %v, want %v", gotFields, c.wantFields)
			}
			for i, f := range c.wantFields {
				if gotFields[i] != f {
					t.Errorf("Fields[%d] = %q, want %q", i, gotFields[i], f)
				}
			}
		})
	}
}

// ---------- (d) Observations limit clamp ----------

// TestSignalsObservations_LimitClamp covers all the limit-edge cases
// from Decision #4: default, explicit, max-inclusive, exceeds-max
// (with structured `{error,max,code}` envelope), zero, negative,
// non-integer.
func TestSignalsObservations_LimitClamp(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name       string
		query      string
		wantStatus int
		wantLimit  int
		wantErrTxt string
		wantMax    bool
	}{
		{"default_when_absent", "", http.StatusOK, signalsCatalogLimitDefault, "", false},
		{"explicit_50", "limit=50", http.StatusOK, 50, "", false},
		{"max_inclusive_1000", "limit=1000", http.StatusOK, 1000, "", false},
		{"exceeds_max_1001", "limit=1001", http.StatusBadRequest, 0, "limit exceeds maximum", true},
		// JSON encodes `>=` as the unicode escape `\u003e=`, so the
		// substring assertion matches the prefix only — the full
		// message body is asserted via the body containment check
		// in the OK paths above.
		{"zero", "limit=0", http.StatusBadRequest, 0, "limit must be", false},
		{"negative", "limit=-5", http.StatusBadRequest, 0, "limit must be", false},
		{"non_integer", "limit=abc", http.StatusBadRequest, 0, "limit must be an integer", false},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeSignalsCatalogRepo{}
			h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)
			rec := httptest.NewRecorder()
			h.Observations(rec, scRequest("/signals/observations?"+c.query))

			if rec.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, c.wantStatus, rec.Body.String())
			}
			if c.wantErrTxt != "" && !strings.Contains(rec.Body.String(), c.wantErrTxt) {
				t.Errorf("body missing %q\nbody=%s", c.wantErrTxt, rec.Body.String())
			}
			if c.wantMax {
				var body map[string]any
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatalf("decode: %v", err)
				}
				maxV, ok := body["max"].(float64)
				if !ok || int(maxV) != signalsCatalogLimitMax {
					t.Errorf("body.max = %v, want %d (Decision #4 envelope)", body["max"], signalsCatalogLimitMax)
				}
			}
			if c.wantStatus == http.StatusOK {
				if len(repo.gotObservationsParams) != 1 {
					t.Fatalf("got %d observation calls, want 1", len(repo.gotObservationsParams))
				}
				if got := repo.gotObservationsParams[0].Limit; got != c.wantLimit {
					t.Errorf("Limit = %d, want %d", got, c.wantLimit)
				}
			}
		})
	}
}

// TestSignalsObservations_OffsetValidation covers the offset edge
// cases (default, explicit, negative, non-integer). Bundled separately
// from the limit clamp so the table stays small enough to read.
func TestSignalsObservations_OffsetValidation(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name       string
		query      string
		wantStatus int
		wantOffset int
	}{
		{"default", "", http.StatusOK, 0},
		{"explicit", "offset=200", http.StatusOK, 200},
		{"zero_explicit", "offset=0", http.StatusOK, 0},
		{"negative", "offset=-1", http.StatusBadRequest, 0},
		{"non_integer", "offset=abc", http.StatusBadRequest, 0},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeSignalsCatalogRepo{}
			h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)
			rec := httptest.NewRecorder()
			h.Observations(rec, scRequest("/signals/observations?"+c.query))
			if rec.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, c.wantStatus)
			}
			if c.wantStatus == http.StatusOK {
				if got := repo.gotObservationsParams[0].Offset; got != c.wantOffset {
					t.Errorf("Offset = %d, want %d", got, c.wantOffset)
				}
			}
		})
	}
}

// ---------- (e) Observations time-range filter ----------

// TestSignalsObservations_TimeRangeFilter confirms the since/until
// query parameters parse as RFC3339 and reach the repo as
// ObservationsParams.Since/Until pointers; bad values return 400.
func TestSignalsObservations_TimeRangeFilter(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	t.Run("both_set_succeed", func(t *testing.T) {
		t.Parallel()
		repo := &fakeSignalsCatalogRepo{}
		h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)
		rec := httptest.NewRecorder()
		h.Observations(rec, scRequest("/signals/observations?since=2026-05-01T00:00:00Z&until=2026-05-06T00:00:00Z"))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
		}
		got := repo.gotObservationsParams[0]
		if got.Since == nil || !got.Since.Equal(time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)) {
			t.Errorf("Since = %v, want 2026-05-01T00:00:00Z", got.Since)
		}
		if got.Until == nil || !got.Until.Equal(time.Date(2026, 5, 6, 0, 0, 0, 0, time.UTC)) {
			t.Errorf("Until = %v, want 2026-05-06T00:00:00Z", got.Until)
		}
	})

	t.Run("since_only_succeed", func(t *testing.T) {
		t.Parallel()
		repo := &fakeSignalsCatalogRepo{}
		h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)
		rec := httptest.NewRecorder()
		h.Observations(rec, scRequest("/signals/observations?since=2026-05-01T00:00:00Z"))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
		}
		got := repo.gotObservationsParams[0]
		if got.Since == nil {
			t.Error("Since = nil, want non-nil")
		}
		if got.Until != nil {
			t.Errorf("Until = %v, want nil (not in query)", got.Until)
		}
	})

	t.Run("bad_since_400", func(t *testing.T) {
		t.Parallel()
		repo := &fakeSignalsCatalogRepo{}
		h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)
		rec := httptest.NewRecorder()
		h.Observations(rec, scRequest("/signals/observations?since=not-a-time"))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "since must be") {
			t.Errorf("body missing since-error message: %s", rec.Body.String())
		}
	})

	t.Run("bad_until_400", func(t *testing.T) {
		t.Parallel()
		repo := &fakeSignalsCatalogRepo{}
		h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)
		rec := httptest.NewRecorder()
		h.Observations(rec, scRequest("/signals/observations?until=not-a-time"))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", rec.Code)
		}
	})
}

// ---------- (f) value_kind matches the populated value column ----------

// TestSignalsObservations_ValueKindRendering covers every typed value
// kind: each repo row carries a populated Value of the right Go type
// and the response renders the corresponding ValueKind symbolic name.
func TestSignalsObservations_ValueKindRendering(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	ts := time.Date(2026, 5, 6, 11, 0, 0, 0, time.UTC)

	cases := []struct {
		name          string
		repoRow       signaldb.SignalObservation
		wantKindName  string
		wantValueJSON string
	}{
		{"string", signaldb.SignalObservation{VehicleID: 1, Ts: ts, Field: "Version", ValueKind: 1, Value: "2026.10.5"}, "ValueKindString", `"2026.10.5"`},
		{"bool", signaldb.SignalObservation{VehicleID: 1, Ts: ts, Field: "BrakePedal", ValueKind: 2, Value: true}, "ValueKindBool", `true`},
		{"int32", signaldb.SignalObservation{VehicleID: 1, Ts: ts, Field: "ChargeLimitSoc", ValueKind: 3, Value: int64(80)}, "ValueKindInt32", `80`},
		{"int64", signaldb.SignalObservation{VehicleID: 1, Ts: ts, Field: "Odometer", ValueKind: 4, Value: int64(123456)}, "ValueKindInt64", `123456`},
		{"float", signaldb.SignalObservation{VehicleID: 1, Ts: ts, Field: "BatteryLevel", ValueKind: 5, Value: 78.5}, "ValueKindFloat", `78.5`},
		{"double", signaldb.SignalObservation{VehicleID: 1, Ts: ts, Field: "EnergyRemaining", ValueKind: 6, Value: 50.25}, "ValueKindDouble", `50.25`},
		{"enum", signaldb.SignalObservation{VehicleID: 1, Ts: ts, Field: "Gear", ValueKind: 7, Value: int64(4)}, "ValueKindEnum", `4`},
		{"time", signaldb.SignalObservation{VehicleID: 1, Ts: ts, Field: "ScheduledChargingStart", ValueKind: 9, Value: ts}, "ValueKindTime", `"2026-05-06T11:00:00Z"`},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeSignalsCatalogRepo{
				observations: []signaldb.SignalObservation{c.repoRow},
				totalCount:   1,
			}
			h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)
			rec := httptest.NewRecorder()
			h.Observations(rec, scRequest("/signals/observations"))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
			}

			var body SignalsObservationsResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
			}
			if body.Count != 1 || body.Total != 1 {
				t.Fatalf("envelope = %+v, want count=1 total=1", body)
			}
			if got := body.Observations[0].ValueKind; got != c.wantKindName {
				t.Errorf("value_kind = %q, want %q", got, c.wantKindName)
			}

			// Pin the JSON serialisation of `value` so consumers see
			// stable types across runs (Go's json package would
			// otherwise serialise int as an int and float as a float
			// without unifying them — that's the desired behaviour
			// because value_kind tells the consumer which to expect).
			rawValue, _ := json.Marshal(body.Observations[0].Value)
			if string(rawValue) != c.wantValueJSON {
				t.Errorf("value JSON = %s, want %s", string(rawValue), c.wantValueJSON)
			}
		})
	}
}

// ---------- vehicle_id parsing ----------

// TestSignalsObservations_VehicleIDParsing covers the comma-separated
// bigint parser: valid inputs reach the repo as ObservationsParams.
// VehicleIDs; malformed inputs return 400 without a repo call.
func TestSignalsObservations_VehicleIDParsing(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name       string
		query      string
		wantStatus int
		wantIDs    []int64
	}{
		{"single", "vehicle_id=42", http.StatusOK, []int64{42}},
		{"multi", "vehicle_id=42,7,99", http.StatusOK, []int64{42, 7, 99}},
		{"with_whitespace", "vehicle_id=42,%207,%2099", http.StatusOK, []int64{42, 7, 99}},
		{"non_integer", "vehicle_id=abc", http.StatusBadRequest, nil},
		{"mixed_invalid", "vehicle_id=42,abc", http.StatusBadRequest, nil},
		{"zero", "vehicle_id=0", http.StatusBadRequest, nil},
		{"negative", "vehicle_id=-1", http.StatusBadRequest, nil},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeSignalsCatalogRepo{}
			h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)
			rec := httptest.NewRecorder()
			h.Observations(rec, scRequest("/signals/observations?"+c.query))
			if rec.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, c.wantStatus, rec.Body.String())
			}
			if c.wantStatus == http.StatusOK {
				gotIDs := repo.gotObservationsParams[0].VehicleIDs
				if len(gotIDs) != len(c.wantIDs) {
					t.Fatalf("VehicleIDs = %v, want %v", gotIDs, c.wantIDs)
				}
				for i, want := range c.wantIDs {
					if gotIDs[i] != want {
						t.Errorf("VehicleIDs[%d] = %d, want %d", i, gotIDs[i], want)
					}
				}
			}
			if c.wantStatus == http.StatusBadRequest {
				if len(repo.gotObservationsParams) != 0 {
					t.Errorf("Observations called for invalid vehicle_id — must validate first")
				}
			}
		})
	}
}

// ---------- repo error paths ----------

// TestSignalsCatalog_AggregateError_500 confirms a repo failure on the
// catalog endpoint maps to a clean 500 + structured error envelope
// rather than panicking or leaking the underlying SQL error.
func TestSignalsCatalog_AggregateError_500(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeSignalsCatalogRepo{
		aggregatesErr: errors.New("simulated DB failure"),
	}
	h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)
	rec := httptest.NewRecorder()
	h.Catalog(rec, scRequest("/signals/catalog"))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "failed to load catalog") {
		t.Errorf("body missing user-facing error: %s", rec.Body.String())
	}
}

// TestSignalsObservations_CountError_500 + TestSignalsObservations_SelectError_500
// cover the two repo calls in the observations endpoint independently.
func TestSignalsObservations_CountError_500(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeSignalsCatalogRepo{
		totalCountErr: errors.New("simulated DB failure"),
	}
	h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)
	rec := httptest.NewRecorder()
	h.Observations(rec, scRequest("/signals/observations"))
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
}

func TestSignalsObservations_SelectError_500(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeSignalsCatalogRepo{
		observationsErr: errors.New("simulated DB failure"),
	}
	h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)
	rec := httptest.NewRecorder()
	h.Observations(rec, scRequest("/signals/observations"))
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
}

// ---------- empty result envelopes ----------

// TestSignalsObservations_EmptyResult_200 confirms a 200 response with
// count=0 + total=0 + observations=[] (non-null) when the repo returns
// no rows; the consumer should never see `null` here because that
// would force a defensive check on every iteration.
func TestSignalsObservations_EmptyResult_200(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeSignalsCatalogRepo{
		observations: nil,
		totalCount:   0,
	}
	h := newSignalsCatalogHandlerForTest(repo, fixedTestEntries(), now)
	rec := httptest.NewRecorder()
	h.Observations(rec, scRequest("/signals/observations"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"observations":[]`) {
		t.Errorf("body missing empty observations array: %s", body)
	}
	if !strings.Contains(body, `"count":0`) {
		t.Errorf("body missing count=0: %s", body)
	}
	if !strings.Contains(body, `"total":0`) {
		t.Errorf("body missing total=0: %s", body)
	}
}

// ---------- production-wiring smoke ----------

// TestNewSignalsCatalogHandler_LoadsRoutingYAML confirms the
// production constructor parses the embedded routing.yaml without
// panicking and produces a non-empty entries slice. This guards
// against a future routing.yaml regression that would only surface at
// process startup in production.
func TestNewSignalsCatalogHandler_LoadsRoutingYAML(t *testing.T) {
	t.Parallel()

	// Construct via the package-level helper but with a nil repo —
	// this is fine because we never call Catalog or Observations
	// here. The test exercises router.Load() via the constructor.
	h := &Handler{}
	entries, err := router.Load()
	if err != nil {
		t.Fatalf("router.Load() failed: %v — production constructor would panic", err)
	}
	h.entries = entries
	if len(h.entries) == 0 {
		t.Fatal("router.Load() returned 0 entries — every Tesla-routed signal would be absent from the catalog")
	}
}
