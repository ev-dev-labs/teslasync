// Tests for the toolstest fixture package.
//
// toolstest is imported by the carved internal/ai/tools/* bounded-context
// test files to share a single canonical set of fakes. Those consumers
// silently depend on two guarantees this file locks down:
//
//  1. Each Fake* type still satisfies the EXACT narrow production port
//     (tools.VehicleSource, rag.Retriever, …) it stands in for. The
//     compile-time assertions below make a port-signature drift fail
//     HERE, in one obvious place, instead of in every downstream test.
//  2. Each fake's runtime behaviour — seeding, limit windowing, nil-map
//     safety, error propagation, and the deep-copy isolation of recorded
//     Retrieve args — matches what the consumers assert against.
//
// The file uses the external test package (toolstest_test) so it exercises
// the fixtures exactly as a consumer would: only the exported surface.
package toolstest_test

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/toolstest"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

// Compile-time proof that every fixture satisfies the production port it
// substitutes for. FakeVehicles ⇒ VehicleSource, FakeDrives ⇒ both
// DriveSource AND EfficiencySource (the efficiency tool reuses the drive
// window), FakeRetriever ⇒ rag.Retriever, etc. A signature change on any
// port that the fakes fail to track breaks the test build immediately.
var (
	_ tools.VehicleSource      = (*toolstest.FakeVehicles)(nil)
	_ tools.VehicleStateSource = (*toolstest.FakeState)(nil)
	_ tools.DriveSource        = (*toolstest.FakeDrives)(nil)
	_ tools.ChargeSource       = (*toolstest.FakeCharges)(nil)
	_ tools.AlertRuleSource    = (*toolstest.FakeRules)(nil)
	_ tools.NotificationSource = (*toolstest.FakeNotif)(nil)
	_ tools.GeofenceSource     = (*toolstest.FakeFences)(nil)
	_ tools.EfficiencySource   = (*toolstest.FakeDrives)(nil)
	_ rag.Retriever            = (*toolstest.FakeRetriever)(nil)
)

// errSeeded is the canonical sentinel used to assert that a fake
// propagates the exact error the test seeded (via errors.Is), not just
// "some error".
var errSeeded = errors.New("toolstest: seeded failure")

// TestFixturesSatisfyPorts turns the compile-time assertions above into a
// visible passing test AND exercises each fake once through its interface
// type, proving the method set is reachable via the port (not just the
// concrete type).
func TestFixturesSatisfyPorts(t *testing.T) {
	t.Parallel()

	var vs tools.VehicleSource = &toolstest.FakeVehicles{}
	if _, err := vs.GetAll(context.Background()); err != nil {
		t.Errorf("VehicleSource.GetAll via port: unexpected err %v", err)
	}

	var st tools.VehicleStateSource = &toolstest.FakeState{}
	if _, err := st.SignalAt(context.Background(), 1, "Soc", time.Now()); err != nil {
		t.Errorf("VehicleStateSource.SignalAt via port: unexpected err %v", err)
	}

	var ret rag.Retriever = &toolstest.FakeRetriever{}
	if _, err := ret.Retrieve(context.Background(), "u", "q", nil, 4); err != nil {
		t.Errorf("rag.Retriever.Retrieve via port: unexpected err %v", err)
	}
	if err := ret.Index(context.Background(), "u", "docs", "id", nil); err != nil {
		t.Errorf("rag.Retriever.Index via port: unexpected err %v", err)
	}
	if err := ret.Forget(context.Background(), "u", "docs", "id"); err != nil {
		t.Errorf("rag.Retriever.Forget via port: unexpected err %v", err)
	}
}

// ---------------------------------------------------------------------------
// FakeVehicles
// ---------------------------------------------------------------------------

func TestFakeVehicles_GetAll(t *testing.T) {
	t.Parallel()

	rows := []*vehiclemodel.Vehicle{{ID: 1}, {ID: 2}}

	tests := []struct {
		name    string
		fake    toolstest.FakeVehicles
		wantLen int
		wantErr bool
	}{
		{"nil slice, no error", toolstest.FakeVehicles{}, 0, false},
		{"seeded rows", toolstest.FakeVehicles{All: rows}, 2, false},
		{"error short-circuits to nil", toolstest.FakeVehicles{All: rows, Err: errSeeded}, 0, true},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := tc.fake.GetAll(context.Background())
			if tc.wantErr {
				if !errors.Is(err, errSeeded) {
					t.Fatalf("GetAll err = %v, want errors.Is(err, errSeeded)", err)
				}
				if got != nil {
					t.Errorf("GetAll on error returned %d rows, want nil", len(got))
				}
				return
			}
			if err != nil {
				t.Fatalf("GetAll err = %v, want nil", err)
			}
			if len(got) != tc.wantLen {
				t.Fatalf("GetAll len = %d, want %d", len(got), tc.wantLen)
			}
			for i := range got {
				if got[i] != rows[i] {
					t.Errorf("GetAll[%d] identity mismatch: got %p want %p", i, got[i], rows[i])
				}
			}
		})
	}
}

func TestFakeVehicles_GetByID(t *testing.T) {
	t.Parallel()

	v7 := &vehiclemodel.Vehicle{ID: 7, DisplayName: "seven"}

	tests := []struct {
		name    string
		fake    toolstest.FakeVehicles
		id      int64
		want    *vehiclemodel.Vehicle
		wantErr bool
	}{
		{"found", toolstest.FakeVehicles{One: map[int64]*vehiclemodel.Vehicle{7: v7}}, 7, v7, false},
		{"missing id → nil, nil", toolstest.FakeVehicles{One: map[int64]*vehiclemodel.Vehicle{7: v7}}, 99, nil, false},
		{"nil map → nil, nil (no panic)", toolstest.FakeVehicles{}, 7, nil, false},
		{"error short-circuits before map read", toolstest.FakeVehicles{One: map[int64]*vehiclemodel.Vehicle{7: v7}, Err: errSeeded}, 7, nil, true},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := tc.fake.GetByID(context.Background(), tc.id)
			if tc.wantErr {
				if !errors.Is(err, errSeeded) {
					t.Fatalf("GetByID err = %v, want errors.Is(err, errSeeded)", err)
				}
			} else if err != nil {
				t.Fatalf("GetByID err = %v, want nil", err)
			}
			if got != tc.want {
				t.Errorf("GetByID(%d) = %v, want %v", tc.id, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// FakeState
// ---------------------------------------------------------------------------

func TestFakeState_SignalAt(t *testing.T) {
	t.Parallel()

	fake := &toolstest.FakeState{Values: map[string]any{
		"VehicleState": "D",
		"Soc":          87.5,
		"GpsHeading":   180,
		"present":      nil, // explicitly-seeded nil is indistinguishable from absent
	}}

	tests := []struct {
		name string
		sig  string
		want any
	}{
		{"string signal", "VehicleState", "D"},
		{"float signal", "Soc", 87.5},
		{"int signal", "GpsHeading", 180},
		{"seeded nil signal", "present", nil},
		{"absent signal → nil", "DoesNotExist", nil},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := fake.SignalAt(context.Background(), 1, tc.sig, toolstest.FixedNow())
			if err != nil {
				t.Fatalf("SignalAt err = %v, want nil", err)
			}
			if got != tc.want {
				t.Errorf("SignalAt(%q) = %v (%T), want %v (%T)", tc.sig, got, got, tc.want, tc.want)
			}
		})
	}

	t.Run("nil Values map is safe", func(t *testing.T) {
		t.Parallel()
		empty := &toolstest.FakeState{}
		got, err := empty.SignalAt(context.Background(), 1, "anything", time.Now())
		if err != nil || got != nil {
			t.Fatalf("SignalAt on nil map = (%v, %v), want (nil, nil)", got, err)
		}
	})

	t.Run("ignores vehicleID and timestamp", func(t *testing.T) {
		t.Parallel()
		a, _ := fake.SignalAt(context.Background(), 1, "Soc", time.Unix(0, 0))
		b, _ := fake.SignalAt(context.Background(), 999, "Soc", time.Now().Add(time.Hour))
		if a != b {
			t.Errorf("SignalAt varied with vid/at: %v vs %v", a, b)
		}
	})
}

// ---------------------------------------------------------------------------
// FakeDrives
// ---------------------------------------------------------------------------

func TestFakeDrives_GetByVehicle(t *testing.T) {
	t.Parallel()

	rows := []*drivemodel.Drive{{ID: 1}, {ID: 2}, {ID: 3}}

	tests := []struct {
		name    string
		rows    []*drivemodel.Drive
		limit   int
		wantLen int
	}{
		{"limit zero returns all", rows, 0, 3},
		{"negative limit returns all", rows, -5, 3},
		{"limit below len truncates", rows, 2, 2},
		{"limit one returns first", rows, 1, 1},
		{"limit equal to len returns all", rows, 3, 3},
		{"limit above len returns all", rows, 10, 3},
		{"empty rows with positive limit", nil, 5, 0},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			fake := &toolstest.FakeDrives{Rows: tc.rows}
			got, err := fake.GetByVehicle(context.Background(), 42, tc.limit, 0, time.Time{}, time.Time{})
			if err != nil {
				t.Fatalf("GetByVehicle err = %v, want nil", err)
			}
			if len(got) != tc.wantLen {
				t.Fatalf("GetByVehicle len = %d, want %d", len(got), tc.wantLen)
			}
			// Truncation must preserve order from the head of Rows.
			for i := range got {
				if got[i] != tc.rows[i] {
					t.Errorf("row[%d] identity mismatch", i)
				}
			}
		})
	}
}

func TestFakeDrives_GetByID(t *testing.T) {
	t.Parallel()

	d5 := &drivemodel.Drive{ID: 5}
	fake := &toolstest.FakeDrives{One: map[int64]*drivemodel.Drive{5: d5}}

	if got, err := fake.GetByID(context.Background(), 5); err != nil || got != d5 {
		t.Fatalf("GetByID(5) = (%v, %v), want (%p, nil)", got, err, d5)
	}
	if got, err := fake.GetByID(context.Background(), 6); err != nil || got != nil {
		t.Fatalf("GetByID(6) = (%v, %v), want (nil, nil)", got, err)
	}
	// nil One map must not panic.
	empty := &toolstest.FakeDrives{}
	if got, err := empty.GetByID(context.Background(), 1); err != nil || got != nil {
		t.Fatalf("GetByID on nil map = (%v, %v), want (nil, nil)", got, err)
	}
}

// ---------------------------------------------------------------------------
// FakeCharges
// ---------------------------------------------------------------------------

func TestFakeCharges_GetByVehicle(t *testing.T) {
	t.Parallel()

	rows := []*chargingmodel.ChargingSession{{ID: 10}, {ID: 20}, {ID: 30}, {ID: 40}}

	tests := []struct {
		name    string
		rows    []*chargingmodel.ChargingSession
		limit   int
		wantLen int
	}{
		{"limit zero returns all", rows, 0, 4},
		{"negative limit returns all", rows, -1, 4},
		{"limit below len truncates", rows, 3, 3},
		{"limit equal to len returns all", rows, 4, 4},
		{"limit above len returns all", rows, 99, 4},
		{"empty rows", nil, 2, 0},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			fake := &toolstest.FakeCharges{Rows: tc.rows}
			got, err := fake.GetByVehicle(context.Background(), 7, tc.limit, 0, time.Time{}, time.Time{})
			if err != nil {
				t.Fatalf("GetByVehicle err = %v, want nil", err)
			}
			if len(got) != tc.wantLen {
				t.Fatalf("GetByVehicle len = %d, want %d", len(got), tc.wantLen)
			}
			for i := range got {
				if got[i] != tc.rows[i] {
					t.Errorf("row[%d] identity mismatch", i)
				}
			}
		})
	}
}

func TestFakeCharges_GetByID(t *testing.T) {
	t.Parallel()

	c9 := &chargingmodel.ChargingSession{ID: 9}
	fake := &toolstest.FakeCharges{One: map[int64]*chargingmodel.ChargingSession{9: c9}}

	if got, err := fake.GetByID(context.Background(), 9); err != nil || got != c9 {
		t.Fatalf("GetByID(9) = (%v, %v), want (%p, nil)", got, err, c9)
	}
	if got, err := fake.GetByID(context.Background(), 1); err != nil || got != nil {
		t.Fatalf("GetByID(1) = (%v, %v), want (nil, nil)", got, err)
	}
	empty := &toolstest.FakeCharges{}
	if got, err := empty.GetByID(context.Background(), 9); err != nil || got != nil {
		t.Fatalf("GetByID on nil map = (%v, %v), want (nil, nil)", got, err)
	}
}

// ---------------------------------------------------------------------------
// FakeRules / FakeNotif / FakeFences (GetAll / GetLogs pass-throughs)
// ---------------------------------------------------------------------------

func TestFakeRules_GetAll(t *testing.T) {
	t.Parallel()

	t.Run("empty", func(t *testing.T) {
		t.Parallel()
		got, err := (&toolstest.FakeRules{}).GetAll(context.Background())
		if err != nil || len(got) != 0 {
			t.Fatalf("GetAll empty = (%v, %v), want (0, nil)", got, err)
		}
	})
	t.Run("seeded", func(t *testing.T) {
		t.Parallel()
		rules := []*alertmodel.AlertRule{{ID: 1, Name: "a"}, {ID: 2, Name: "b"}}
		got, err := (&toolstest.FakeRules{Rules: rules}).GetAll(context.Background())
		if err != nil {
			t.Fatalf("GetAll err = %v, want nil", err)
		}
		if len(got) != 2 || got[0] != rules[0] || got[1] != rules[1] {
			t.Errorf("GetAll = %v, want seeded rules verbatim", got)
		}
	})
}

func TestFakeNotif_GetLogs(t *testing.T) {
	t.Parallel()

	logs := []*notificationmodel.NotificationLog{{ID: 1, Title: "x"}, {ID: 2, Title: "y"}}
	fake := &toolstest.FakeNotif{Logs: logs}

	got, err := fake.GetLogs(context.Background(), 1, 0)
	if err != nil {
		t.Fatalf("GetLogs err = %v, want nil", err)
	}
	if len(got) != 2 || got[0] != logs[0] {
		t.Errorf("GetLogs = %v, want seeded logs verbatim", got)
	}

	// GetLogs ignores limit/offset — differing paging args yield the same
	// slice, matching the fake's documented "return everything" contract.
	other, _ := fake.GetLogs(context.Background(), 999, 5)
	if len(other) != len(got) {
		t.Errorf("GetLogs varied with limit/offset: %d vs %d", len(other), len(got))
	}

	empty, err := (&toolstest.FakeNotif{}).GetLogs(context.Background(), 10, 0)
	if err != nil || len(empty) != 0 {
		t.Fatalf("GetLogs empty = (%v, %v), want (0, nil)", empty, err)
	}
}

func TestFakeFences_GetAll(t *testing.T) {
	t.Parallel()

	fences := []*systemmodel.Geofence{{ID: 1, Name: "home"}, {ID: 2, Name: "work"}}
	got, err := (&toolstest.FakeFences{Fences: fences}).GetAll(context.Background())
	if err != nil {
		t.Fatalf("GetAll err = %v, want nil", err)
	}
	if len(got) != 2 || got[0] != fences[0] {
		t.Errorf("GetAll = %v, want seeded fences verbatim", got)
	}

	empty, err := (&toolstest.FakeFences{}).GetAll(context.Background())
	if err != nil || len(empty) != 0 {
		t.Fatalf("GetAll empty = (%v, %v), want (0, nil)", empty, err)
	}
}

// ---------------------------------------------------------------------------
// FakeRetriever
// ---------------------------------------------------------------------------

func TestFakeRetriever_Retrieve_ReturnsSeededOutput(t *testing.T) {
	t.Parallel()

	want := []rag.Chunk{
		{SourceType: rag.SourceDriveSummary, SourceID: "drive-1", ChunkIdx: 0, Text: "Home → Work", Score: 0.9},
	}
	fake := &toolstest.FakeRetriever{Out: want}

	got, err := fake.Retrieve(context.Background(), "subj", "query", []string{rag.SourceDriveSummary}, 4)
	if err != nil {
		t.Fatalf("Retrieve err = %v, want nil", err)
	}
	if len(got) != 1 || got[0] != want[0] {
		t.Errorf("Retrieve = %v, want %v", got, want)
	}
}

func TestFakeRetriever_Retrieve_PropagatesError(t *testing.T) {
	t.Parallel()

	fake := &toolstest.FakeRetriever{Out: []rag.Chunk{{SourceID: "ignored"}}, Err: errSeeded}
	got, err := fake.Retrieve(context.Background(), "s", "q", nil, 1)
	if !errors.Is(err, errSeeded) {
		t.Fatalf("Retrieve err = %v, want errors.Is(err, errSeeded)", err)
	}
	if got != nil {
		t.Errorf("Retrieve on error returned %v, want nil chunks", got)
	}
	// The call is still recorded even though it errored, so a test can
	// assert the tool DID reach the retriever before it failed.
	if len(fake.Queries) != 1 || fake.Queries[0] != "q" {
		t.Errorf("Queries = %v, want the errored call to be recorded", fake.Queries)
	}
}

func TestFakeRetriever_Retrieve_RecordsArgsInOrder(t *testing.T) {
	t.Parallel()

	fake := &toolstest.FakeRetriever{}
	fake.Retrieve(context.Background(), "subjA", "qA", []string{"docs"}, 4)          //nolint:errcheck
	fake.Retrieve(context.Background(), "subjB", "qB", []string{"drive_summary"}, 8) //nolint:errcheck

	if want := []string{"subjA", "subjB"}; !equalStrings(fake.Subjects, want) {
		t.Errorf("Subjects = %v, want %v", fake.Subjects, want)
	}
	if want := []string{"qA", "qB"}; !equalStrings(fake.Queries, want) {
		t.Errorf("Queries = %v, want %v", fake.Queries, want)
	}
	if want := []int{4, 8}; !equalInts(fake.Ks, want) {
		t.Errorf("Ks = %v, want %v", fake.Ks, want)
	}
	if len(fake.SourceTypes) != 2 ||
		!equalStrings(fake.SourceTypes[0], []string{"docs"}) ||
		!equalStrings(fake.SourceTypes[1], []string{"drive_summary"}) {
		t.Errorf("SourceTypes = %v, want [[docs] [drive_summary]]", fake.SourceTypes)
	}
}

// TestFakeRetriever_Retrieve_DeepCopiesSourceTypes is the important
// correctness property of the fake: because it copies the sourceTypes
// slice before recording it, a caller that reuses/mutates its own slice
// after the call cannot retroactively corrupt the recorded history. A
// shallow copy here would make consumer assertions flaky.
func TestFakeRetriever_Retrieve_DeepCopiesSourceTypes(t *testing.T) {
	t.Parallel()

	fake := &toolstest.FakeRetriever{}
	arg := []string{"docs", "drive_summary"}
	fake.Retrieve(context.Background(), "s", "q", arg, 4) //nolint:errcheck

	// Mutate the caller's slice AFTER the call.
	arg[0] = "MUTATED"

	if got := fake.SourceTypes[0]; got[0] != "docs" {
		t.Errorf("recorded SourceTypes aliased the caller slice: got %v, want [docs drive_summary]", got)
	}
}

func TestFakeRetriever_Retrieve_NilSourceTypesRecordedAsEmpty(t *testing.T) {
	t.Parallel()

	fake := &toolstest.FakeRetriever{}
	fake.Retrieve(context.Background(), "s", "q", nil, 4) //nolint:errcheck

	if len(fake.SourceTypes) != 1 || len(fake.SourceTypes[0]) != 0 {
		t.Errorf("nil sourceTypes recorded as %v, want a single empty slice", fake.SourceTypes)
	}
}

func TestFakeRetriever_IndexAndForget_AreNoOps(t *testing.T) {
	t.Parallel()

	fake := &toolstest.FakeRetriever{}

	// No-ops must return nil for any args, including empty/invalid ones,
	// and must not disturb the Retrieve recording slices.
	if err := fake.Index(context.Background(), "", "", "", nil); err != nil {
		t.Errorf("Index(empty) = %v, want nil", err)
	}
	if err := fake.Index(context.Background(), "u", "docs", "id", []string{"chunk"}); err != nil {
		t.Errorf("Index = %v, want nil", err)
	}
	if err := fake.Forget(context.Background(), "", "", ""); err != nil {
		t.Errorf("Forget(empty) = %v, want nil", err)
	}
	if err := fake.Forget(context.Background(), "u", "docs", "id"); err != nil {
		t.Errorf("Forget = %v, want nil", err)
	}
	if len(fake.Subjects)+len(fake.Queries)+len(fake.Ks)+len(fake.SourceTypes) != 0 {
		t.Error("Index/Forget must not record into the Retrieve tracking slices")
	}
}

// ---------------------------------------------------------------------------
// Pointer helpers + FixedNow
// ---------------------------------------------------------------------------

func TestPtrString(t *testing.T) {
	t.Parallel()
	for _, in := range []string{"", "hello", "  spaced  "} {
		in := in
		t.Run(in, func(t *testing.T) {
			t.Parallel()
			p := toolstest.PtrString(in)
			if p == nil {
				t.Fatal("PtrString returned nil")
			}
			if *p != in {
				t.Errorf("*PtrString(%q) = %q", in, *p)
			}
		})
	}
	// Distinct calls must yield distinct addresses so callers can hold
	// independent pointers without aliasing.
	if toolstest.PtrString("x") == toolstest.PtrString("x") {
		t.Error("PtrString returned the same address for two calls")
	}
}

func TestPtrInt16(t *testing.T) {
	t.Parallel()
	for _, in := range []int16{0, 1, -1, math.MinInt16, math.MaxInt16} {
		in := in
		t.Run("", func(t *testing.T) {
			t.Parallel()
			p := toolstest.PtrInt16(in)
			if p == nil || *p != in {
				t.Fatalf("PtrInt16(%d) = %v", in, p)
			}
		})
	}
}

func TestPtrFloat64(t *testing.T) {
	t.Parallel()
	for _, in := range []float64{0, 3.14, -2.5, math.MaxFloat64, math.SmallestNonzeroFloat64} {
		in := in
		t.Run("", func(t *testing.T) {
			t.Parallel()
			p := toolstest.PtrFloat64(in)
			if p == nil || *p != in {
				t.Fatalf("PtrFloat64(%v) = %v", in, p)
			}
		})
	}
	// NaN is never == itself, so verify via math.IsNaN rather than *p == in.
	if p := toolstest.PtrFloat64(math.NaN()); p == nil || !math.IsNaN(*p) {
		t.Errorf("PtrFloat64(NaN) = %v, want pointer to NaN", p)
	}
}

func TestPtrTime(t *testing.T) {
	t.Parallel()
	in := time.Date(2025, 3, 1, 8, 30, 0, 0, time.UTC)
	p := toolstest.PtrTime(in)
	if p == nil {
		t.Fatal("PtrTime returned nil")
	}
	if !p.Equal(in) {
		t.Errorf("*PtrTime = %v, want %v", *p, in)
	}
	// Zero time round-trips (a common "no timestamp" fixture value).
	if z := toolstest.PtrTime(time.Time{}); z == nil || !z.IsZero() {
		t.Errorf("PtrTime(zero) = %v, want pointer to zero time", z)
	}
}

func TestFixedNow(t *testing.T) {
	t.Parallel()

	want := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)
	got := toolstest.FixedNow()
	if !got.Equal(want) {
		t.Errorf("FixedNow() = %v, want %v", got, want)
	}
	if got.Location() != time.UTC {
		t.Errorf("FixedNow() location = %v, want UTC", got.Location())
	}
	// Deterministic across calls — the whole point of a fixed clock.
	if !toolstest.FixedNow().Equal(toolstest.FixedNow()) {
		t.Error("FixedNow() is not deterministic")
	}
}

// ---------------------------------------------------------------------------
// small local slice-equality helpers (kept private to the test package)
// ---------------------------------------------------------------------------

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func equalInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
