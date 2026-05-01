package api

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// TestChatbot_LocationLookup_UsesForwardFoldedState is the wire-up proof
// for the phase-39 chatbot-handler migration.
//
// The chatbot's "where is my car?" answer is the user-facing surface for
// the layered live-state contract: Tesla Fleet Telemetry only emits a
// Latitude / Longitude value once when the vehicle parks, then NEVER
// re-emits it until the car moves. A naive raw `SELECT lat, lon FROM
// positions ORDER BY ts DESC LIMIT 1` against a vehicle parked beyond
// the snapshot lookback would return NO row, causing the chatbot to tell
// the user "I don't know where your car is" for a vehicle that has been
// in the driveway all day.
//
// signal.StateReader.State forward-folds the change feed: an emission
// from 24h ago is carried forward to time.Now() and shows up under the
// "Latitude" / "Longitude" keys exactly as if it had been emitted in the
// current second. This test seeds the fake StateReader with such a
// stale-but-forward-folded snapshot and asserts that the chatbot answer
// includes the actual coordinates — proving the handler reads through
// StateReader and trusts forward-folded values rather than re-imposing
// a snapshot freshness window.
func TestChatbot_LocationLookup_UsesForwardFoldedState(t *testing.T) {
	const (
		wantLat = 37.7749
		wantLon = -122.4194
	)
	staleSeed := time.Now().Add(-24 * time.Hour)
	var gotAt time.Time
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vehicleID int64, at time.Time) (signal.State, error) {
			gotAt = at
			if vehicleID != 42 {
				t.Fatalf("vehicleID = %d, want 42", vehicleID)
			}
			// Forward-folded snapshot: values emitted at staleSeed are
			// carried forward to the requested `at` timestamp by State.
			// The fake just hands back the latest known values.
			_ = staleSeed
			return signal.State{
				"Latitude":  wantLat,
				"Longitude": wantLon,
			}, nil
		},
	}
	h := &ChatbotHandler{state: fake}

	line, err := h.vehicleLocationLine(context.Background(), 42, "Falcon")
	if err != nil {
		t.Fatalf("vehicleLocationLine returned error: %v", err)
	}

	// Forward-fold contract: State must be queried at "now-ish" — never
	// at the snapshot's seed timestamp — so that any subsequent emissions
	// after staleSeed are also rolled in.
	if time.Since(gotAt) > time.Minute {
		t.Fatalf("State was queried at %v, want close to time.Now()", gotAt)
	}

	// The response must include both coordinates rendered from the
	// forward-folded snapshot. We only care that the numeric values are
	// present in the answer, not the exact prose.
	if !strings.Contains(line, "37.77490") {
		t.Fatalf("response missing latitude 37.77490; got %q", line)
	}
	if !strings.Contains(line, "-122.41940") {
		t.Fatalf("response missing longitude -122.41940; got %q", line)
	}
	if !strings.Contains(line, "Falcon") {
		t.Fatalf("response missing vehicle name 'Falcon'; got %q", line)
	}
}

// TestChatbot_NoRawPositionsQuery is an anchored meta-test that locks in
// the phase-39 invariant: chatbot_handler.go must NEVER again contain a
// raw `FROM positions` query, because that would resurrect the
// snapshot-table bug class fixed by routing location reads through
// signal.StateReader. If a future refactor reintroduces a direct
// positions read this test fails BEFORE the bug ships, and the failure
// message points the author at the layered live-state contract.
func TestChatbot_NoRawPositionsQuery(t *testing.T) {
	body, err := os.ReadFile("chatbot_handler.go")
	if err != nil {
		t.Fatalf("read chatbot_handler.go: %v", err)
	}
	if strings.Contains(string(body), "FROM positions") {
		t.Fatalf("chatbot_handler.go contains forbidden 'FROM positions' query — " +
			"location reads MUST go through signal.StateReader.State per ADR-002")
	}
}

// TestChatbot_PropagatesError verifies the failure path: when the
// underlying signal.StateReader reports an error (DB unreachable, query
// timeout, etc.) the handler must propagate it so the orchestrating
// caller can render a single user-facing failure message instead of
// silently dropping the row or, worse, returning a fabricated answer
// like "your car is at (0, 0)". The chatbot is a user-trust surface;
// silent partial failures here would erode confidence.
func TestChatbot_PropagatesError(t *testing.T) {
	wantErr := errors.New("signal_log: connection refused")
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
			return nil, wantErr
		},
	}
	h := &ChatbotHandler{state: fake}

	line, err := h.vehicleLocationLine(context.Background(), 42, "Falcon")
	if err == nil {
		t.Fatalf("vehicleLocationLine should propagate state-reader error; got line=%q err=nil", line)
	}
	if !errors.Is(err, wantErr) {
		t.Fatalf("error chain missing original; got %v", err)
	}
	if line != "" {
		t.Fatalf("on error vehicleLocationLine must return empty string; got %q", line)
	}
}

// TestChatbot_LocationLookup_UnknownWhenNoCoords covers the cold-start
// path: a freshly synced vehicle that has never streamed Latitude /
// Longitude must be rendered as "Location unknown" rather than being
// silently omitted (the user always sees one line per vehicle they own)
// or rendered at (0, 0) (which would map-pin the car off the coast of
// Africa).
func TestChatbot_LocationLookup_UnknownWhenNoCoords(t *testing.T) {
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
			return signal.State{}, nil
		},
	}
	h := &ChatbotHandler{state: fake}

	line, err := h.vehicleLocationLine(context.Background(), 42, "Falcon")
	if err != nil {
		t.Fatalf("vehicleLocationLine returned error: %v", err)
	}
	if !strings.Contains(line, "Location unknown") {
		t.Fatalf("response should say 'Location unknown' when coords missing; got %q", line)
	}
	if !strings.Contains(line, "Falcon") {
		t.Fatalf("response missing vehicle name; got %q", line)
	}
}
