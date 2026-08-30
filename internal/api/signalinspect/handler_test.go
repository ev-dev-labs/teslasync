package signalinspect

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/signal/agreement"
)

// fakeLiveSignalStore is a lightweight implementation of
// signal.LiveSignalStore for Handler tests. It keeps a single
// canned snapshot per vehicle and lets each test customize the timestamps
// to exercise the L1/L2/STALE classification.
type fakeLiveSignalStore struct {
	snapshots map[int64]map[string]*signal.Value
	getErr    error
}

func newFakeLiveSignalStore() *fakeLiveSignalStore {
	return &fakeLiveSignalStore{snapshots: map[int64]map[string]*signal.Value{}}
}

func (f *fakeLiveSignalStore) Update(_ context.Context, _ int64, _ map[string]interface{}) error {
	return nil
}

func (f *fakeLiveSignalStore) UpdateNonBlocking(_ context.Context, _ int64, _ map[string]interface{}) error {
	return nil
}

func (f *fakeLiveSignalStore) UpdateValuesNonBlocking(_ context.Context, _ int64, _ map[string]*signal.Value) error {
	return nil
}

func (f *fakeLiveSignalStore) GetSignal(_ context.Context, vehicleID int64, name string, _ signal.LiveSignalReadPreference) (*signal.Value, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	if m, ok := f.snapshots[vehicleID]; ok {
		return m[name], nil
	}
	return nil, nil
}

func (f *fakeLiveSignalStore) GetAll(_ context.Context, vehicleID int64, _ signal.LiveSignalReadPreference) (map[string]*signal.Value, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	return f.snapshots[vehicleID], nil
}

func (f *fakeLiveSignalStore) Warm(_ context.Context, _ int64) error { return nil }

func (f *fakeLiveSignalStore) LocalVehicleIDs() []int64 { return nil }

var _ signal.LiveSignalStore = (*fakeLiveSignalStore)(nil)

type fakeTransportAgreementReader struct {
	samples   []agreement.Sample
	truncated bool
	err       error
	from      time.Time
	to        time.Time
	limit     int
}

func (f *fakeTransportAgreementReader) AgreementEvidence(
	_ context.Context,
	_ int64,
	from, to time.Time,
	limit int,
) ([]agreement.Sample, bool, error) {
	f.from = from
	f.to = to
	f.limit = limit
	return f.samples, f.truncated, f.err
}

// signalRequestWithVehicleID wires {vehicleID} onto the chi route context so
// chi.URLParam returns it inside the handler — same pattern the alert handler
// tests use.
func signalRequestWithVehicleID(t *testing.T, method, target, vehicleID string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("vehicleID", vehicleID)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	return req
}

func TestTransportAgreementReturnsMeasuredSourceTimeEvidence(t *testing.T) {
	t.Parallel()
	sourceAt := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
	value := 27.7
	repo := &fakeTransportAgreementReader{
		samples: []agreement.Sample{
			{
				Field:           "VehicleSpeed",
				Origin:          agreement.OriginHTTP,
				SourceEmittedAt: sourceAt,
				Value:           agreement.Value{Kind: 6, Float: &value},
			},
			{
				Field:           "VehicleSpeed",
				Origin:          agreement.OriginMQTT,
				SourceEmittedAt: sourceAt.Add(time.Second),
				Value:           agreement.Value{Kind: 6, Float: &value},
			},
		},
	}
	handler := &Handler{transportAgreement: repo}
	req := signalRequestWithVehicleID(
		t,
		http.MethodGet,
		"/signals/7/transport-agreement?from=2026-08-27T00:00:00Z&to=2026-08-28T00:00:00Z",
		"7",
	)
	recorder := httptest.NewRecorder()

	handler.TransportAgreement(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	var response transportAgreementResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Status != agreement.StatusMeasured || response.ComparablePairs != 1 {
		t.Fatalf("unexpected report: %+v", response.Report)
	}
	if response.AgreementPct == nil || *response.AgreementPct != 100 {
		t.Fatalf("agreement_pct = %v, want 100", response.AgreementPct)
	}
	if !response.SourceTimeOnly || response.PairToleranceMS != 2000 {
		t.Fatalf("provenance contract missing: %+v", response)
	}
	if repo.limit != transportAgreementRowLimit {
		t.Fatalf("repo limit = %d, want %d", repo.limit, transportAgreementRowLimit)
	}
}

func TestTransportAgreementRejectsInvalidRange(t *testing.T) {
	t.Parallel()
	handler := &Handler{transportAgreement: &fakeTransportAgreementReader{}}
	req := signalRequestWithVehicleID(
		t,
		http.MethodGet,
		"/signals/7/transport-agreement?from=2026-08-28T00:00:00Z&to=2026-08-27T00:00:00Z",
		"7",
	)
	recorder := httptest.NewRecorder()

	handler.TransportAgreement(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
}

func TestSignalHistoryPoint_ProvenanceFieldsRemainNullableInJSON(t *testing.T) {
	body, err := json.Marshal(signalHistoryPoint{
		Ts:    time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC),
		Kind:  "Float",
		Value: 12.5,
	})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	for _, key := range []string{"ingest_origin", "source_emitted_at", "received_at", "normalization_version"} {
		if value, ok := decoded[key]; !ok || value != nil {
			t.Errorf("%s = %v (present=%t), want explicit null", key, value, ok)
		}
	}
}

// TestLiveStateClassifiesSourceL1 verifies fresh values with non-zero
// timestamps within the freshness window are reported as source="l1".
func TestLiveStateClassifiesSourceL1(t *testing.T) {
	now := time.Now().UTC()
	store := newFakeLiveSignalStore()
	store.snapshots[42] = map[string]*signal.Value{
		"BatteryLevel": {Raw: float64(73), Timestamp: now.Add(-1 * time.Second)},
	}
	h := NewHandler(nil)
	h.WithLiveSignalStore(store)

	rec := httptest.NewRecorder()
	h.LiveState(rec, signalRequestWithVehicleID(t, http.MethodGet, "/api/v1/signals/42/live", "42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Signals map[string]map[string]any `json:"signals"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	got := body.Signals["BatteryLevel"]
	if src, _ := got["source"].(string); src != "l1" {
		t.Fatalf("source = %q, want l1", src)
	}
	if _, ok := got["age_ms"]; !ok {
		t.Fatalf("age_ms missing from response: %v", got)
	}
}

// TestLiveStateClassifiesSourceStale verifies values older than the
// freshness window are reported as source="stale".
func TestLiveStateClassifiesSourceStale(t *testing.T) {
	now := time.Now().UTC()
	store := newFakeLiveSignalStore()
	store.snapshots[42] = map[string]*signal.Value{
		"BatteryLevel": {Raw: float64(50), Timestamp: now.Add(-5 * time.Minute)},
	}
	h := NewHandler(nil)
	h.WithLiveSignalStore(store)

	rec := httptest.NewRecorder()
	h.LiveState(rec, signalRequestWithVehicleID(t, http.MethodGet, "/api/v1/signals/42/live", "42"))

	var body struct {
		Signals map[string]map[string]any `json:"signals"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	got := body.Signals["BatteryLevel"]
	if src, _ := got["source"].(string); src != "stale" {
		t.Fatalf("source = %q, want stale", src)
	}
}

// TestLiveStateClassifiesSourceL2 verifies legacy zero-timestamp values
// (Redis legacy scalars) are reported as source="l2".
func TestLiveStateClassifiesSourceL2(t *testing.T) {
	store := newFakeLiveSignalStore()
	store.snapshots[42] = map[string]*signal.Value{
		"BatteryLevel": {Raw: float64(50)}, // zero timestamp = legacy
	}
	h := NewHandler(nil)
	h.WithLiveSignalStore(store)

	rec := httptest.NewRecorder()
	h.LiveState(rec, signalRequestWithVehicleID(t, http.MethodGet, "/api/v1/signals/42/live", "42"))

	var body struct {
		Signals map[string]map[string]any `json:"signals"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	got := body.Signals["BatteryLevel"]
	if src, _ := got["source"].(string); src != "l2" {
		t.Fatalf("source = %q, want l2", src)
	}
}

// TestSnapshotPresentTimeUsesLiveStore verifies that omitting `at` (or
// passing now) reads through the live signal store rather than signal_log.
func TestSnapshotPresentTimeUsesLiveStore(t *testing.T) {
	now := time.Now().UTC()
	store := newFakeLiveSignalStore()
	store.snapshots[42] = map[string]*signal.Value{
		"BatteryLevel": {Raw: float64(80), Timestamp: now.Add(-2 * time.Second)},
		"Speed":        {Raw: float64(0), Timestamp: now.Add(-1 * time.Second)},
	}
	h := NewHandler(nil)
	h.WithLiveSignalStore(store)

	rec := httptest.NewRecorder()
	h.Snapshot(rec, signalRequestWithVehicleID(t, http.MethodGet, "/api/v1/signals/42/snapshot", "42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Count   int                       `json:"count"`
		Signals map[string]map[string]any `json:"signals"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Count != 2 {
		t.Fatalf("count = %d, want 2", body.Count)
	}
	if src, _ := body.Signals["BatteryLevel"]["source"].(string); src != "l1" {
		t.Fatalf("source = %q, want l1", src)
	}
}

// TestSnapshotInvalidAtRejected verifies a malformed `at` query string yields
// a 400 rather than silently falling back to "now".
func TestSnapshotInvalidAtRejected(t *testing.T) {
	store := newFakeLiveSignalStore()
	h := NewHandler(nil)
	h.WithLiveSignalStore(store)

	rec := httptest.NewRecorder()
	h.Snapshot(rec, signalRequestWithVehicleID(t, http.MethodGet, "/api/v1/signals/42/snapshot?at=not-a-timestamp", "42"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// TestSnapshotPastNoHistoryReturnsEmpty verifies that asking for an old
// snapshot when no signal_history is wired returns an empty signals map
// (not a 5xx) so the frontend renders an empty inspector cleanly.
func TestSnapshotPastNoHistoryReturnsEmpty(t *testing.T) {
	store := newFakeLiveSignalStore()
	h := NewHandler(nil)
	h.WithLiveSignalStore(store) // signalHistoryWriter remains nil

	old := time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339)
	rec := httptest.NewRecorder()
	h.Snapshot(rec, signalRequestWithVehicleID(t, http.MethodGet, "/api/v1/signals/42/snapshot?at="+old, "42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Count int `json:"count"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Count != 0 {
		t.Fatalf("count = %d, want 0 (no history wired)", body.Count)
	}
}

// TestDiffOmitsUnchanged verifies the server-side diff filters out signals
// whose values match across both snapshots, keeping the wire payload tight.
func TestDiffOmitsUnchanged(t *testing.T) {
	now := time.Now().UTC()
	store := newFakeLiveSignalStore()
	// Snapshot at "now" — same data both times; diff should be empty.
	store.snapshots[42] = map[string]*signal.Value{
		"BatteryLevel": {Raw: float64(80), Timestamp: now.Add(-1 * time.Second)},
		"Speed":        {Raw: float64(0), Timestamp: now.Add(-1 * time.Second)},
	}
	h := NewHandler(nil)
	h.WithLiveSignalStore(store)

	// Both at_a and at_b at "now" force collectSnapshot to use the live
	// store path for both snapshots, returning identical values.
	target := "/api/v1/signals/42/diff?at_a=" + now.Add(-1*time.Second).Format(time.RFC3339) +
		"&at_b=" + now.Format(time.RFC3339)
	rec := httptest.NewRecorder()
	h.Diff(rec, signalRequestWithVehicleID(t, http.MethodGet, target, "42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Count int              `json:"count"`
		Data  []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Count != 0 {
		t.Fatalf("count = %d, want 0 (identical snapshots)", body.Count)
	}
	if len(body.Data) != 0 {
		t.Fatalf("data length = %d, want 0 (identical snapshots)", len(body.Data))
	}
}

// TestDiffInvalidAtRejected verifies a malformed at_a/at_b yields 400.
func TestDiffInvalidAtRejected(t *testing.T) {
	store := newFakeLiveSignalStore()
	h := NewHandler(nil)
	h.WithLiveSignalStore(store)

	rec := httptest.NewRecorder()
	h.Diff(rec, signalRequestWithVehicleID(t, http.MethodGet, "/api/v1/signals/42/diff?at_a=invalid&at_b=2024-01-01T00:00:00Z", "42"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("at_a invalid: status = %d, want 400", rec.Code)
	}

	rec2 := httptest.NewRecorder()
	h.Diff(rec2, signalRequestWithVehicleID(t, http.MethodGet, "/api/v1/signals/42/diff?at_a=2024-01-01T00:00:00Z&at_b=invalid", "42"))
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("at_b invalid: status = %d, want 400", rec2.Code)
	}
}

// TestValuesEqualHandlesNumericCoercion regression-tests the diff equality
// helper across the value shapes the live store actually emits.
func TestValuesEqualHandlesNumericCoercion(t *testing.T) {
	tests := []struct {
		name string
		a, b interface{}
		want bool
	}{
		{"both nil", nil, nil, true},
		{"one nil", nil, float64(1), false},
		{"int vs float same", int(5), float64(5), true},
		{"int vs float different", int(5), float64(6), false},
		{"bool same", true, true, true},
		{"bool different", true, false, false},
		{"string same", "foo", "foo", true},
		{"string different", "foo", "bar", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := valuesEqual(tt.a, tt.b); got != tt.want {
				t.Fatalf("valuesEqual(%v, %v) = %v, want %v", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

// TestParseSignalNamesTrimsAndDropsEmpty verifies the comma-split helper
// matches the behavior the frontend relies on (extra whitespace tolerated,
// empty entries dropped).
func TestParseSignalNamesTrimsAndDropsEmpty(t *testing.T) {
	got := parseSignalNames(" BatteryLevel ,, Speed,Gear ")
	want := []string{"BatteryLevel", "Speed", "Gear"}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d (got=%v)", len(got), len(want), got)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("got[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestClassifyLiveSourceBoundary verifies the classification boundary at
// exactly the freshness threshold treats values as fresh, not stale.
func TestClassifyLiveSourceBoundary(t *testing.T) {
	now := time.Now().UTC()
	freshAtBoundary := &signal.Value{Raw: float64(1), Timestamp: now.Add(-signal.LiveSignalFreshnessThreshold)}
	if got := classifyLiveSource(freshAtBoundary, now); got != "l1" {
		t.Fatalf("at boundary: source = %q, want l1", got)
	}

	staleJustOver := &signal.Value{Raw: float64(1), Timestamp: now.Add(-signal.LiveSignalFreshnessThreshold - time.Second)}
	if got := classifyLiveSource(staleJustOver, now); got != "stale" {
		t.Fatalf("just over boundary: source = %q, want stale", got)
	}

	zeroTs := &signal.Value{Raw: float64(1)}
	if got := classifyLiveSource(zeroTs, now); got != "l2" {
		t.Fatalf("zero timestamp: source = %q, want l2", got)
	}
}
