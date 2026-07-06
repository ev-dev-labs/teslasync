// Package searchtest exports an in-memory FakeSearcher implementing
// search.Searcher for unit tests that need to drive search-backed
// handlers (the typed search Handler itself, AI hydrators that
// reuse the canonical pgSearcher backend, etc.) without touching
// pgx.
//
// # Why a separate package
//
// Go forbids importing a `*_test.go` file from outside its package,
// so the original `fakeSearcher` declared inside
// internal/api/search/handler_test.go (and previously shared with
// AI search/drive-search tests by package-internal access) became
// invisible to those tests when search/ moved out of the flat
// internal/api parent. searchtest is the smallest-blast-radius
// fix: a tiny non-_test subpackage exporting the same fake under a
// capitalised name, importable by any consumer test in
// internal/api/* (or any other module that wants a real
// search.Searcher stub for assertions).
//
// # Usage
//
//	fake := searchtest.NewFakeSearcher()
//	fake.Hits[search.SearchTypeDrive] = []search.SearchHit{{ ... }}
//	h := apiaihydrators.NewFromSearcher(fake)
//
// Methods record which corpus was invoked via the CallLog map keyed
// by the same lowercase name handler.go's run() helper uses — the
// singular search.SearchType* values ("vehicle", "drive", "charging",
// "alert", "notification", "geofence", "automation", "location",
// "trip") — so tests can assert which corpora the handler chose to
// fan out to.
package searchtest

import (
	"context"
	"sync"

	"github.com/ev-dev-labs/teslasync/internal/api/search"
)

// FakeSearcher is an in-memory implementation of search.Searcher.
// Each Search* method returns whatever was preloaded into Hits /
// Errs keyed by the singular search.SearchType* value its corpus
// uses ("vehicle", "drive", "charging", "alert", "notification",
// "geofence", "automation", "location", "trip").
//
// Resolution precedence for a corpus name: a corpus-specific non-nil
// Errs entry wins, then a corpus-specific Hits entry (even an
// explicit nil slice, so a test can preload a deliberate empty
// result), then the empty-string catch-all — Errs[""] then Hits[""]
// — which lets a test preload one default that every corpus returns.
type FakeSearcher struct {
	mu      sync.Mutex
	Hits    map[string][]search.SearchHit
	Errs    map[string]error
	CallLog map[string]int
}

// NewFakeSearcher constructs an empty FakeSearcher with all maps
// initialised so callers can mutate them directly.
func NewFakeSearcher() *FakeSearcher {
	return &FakeSearcher{
		Hits:    map[string][]search.SearchHit{},
		Errs:    map[string]error{},
		CallLog: map[string]int{},
	}
}

func (f *FakeSearcher) record(name string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.CallLog[name]++
}

// lookup resolves the hits/error for a corpus using the precedence
// documented on FakeSearcher: a corpus-specific non-nil error wins,
// then corpus-specific hits (even an explicit nil slice), then the
// empty-string catch-all error, then the empty-string catch-all hits.
func (f *FakeSearcher) lookup(name string) ([]search.SearchHit, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err, ok := f.Errs[name]; ok && err != nil {
		return nil, err
	}
	if hits, ok := f.Hits[name]; ok {
		return hits, nil
	}
	if err, ok := f.Errs[""]; ok && err != nil {
		return nil, err
	}
	return f.Hits[""], nil
}

func (f *FakeSearcher) SearchVehicles(_ context.Context, _ string, _ int64, _ int) ([]search.SearchHit, error) {
	f.record("vehicle")
	return f.lookup("vehicle")
}

func (f *FakeSearcher) SearchDrives(_ context.Context, _ string, _ int64, _ int) ([]search.SearchHit, error) {
	f.record("drive")
	return f.lookup("drive")
}

func (f *FakeSearcher) SearchCharging(_ context.Context, _ string, _ int64, _ int) ([]search.SearchHit, error) {
	f.record("charging")
	return f.lookup("charging")
}

func (f *FakeSearcher) SearchAlerts(_ context.Context, _ string, _ int64, _ int) ([]search.SearchHit, error) {
	f.record("alert")
	return f.lookup("alert")
}

func (f *FakeSearcher) SearchNotifications(_ context.Context, _ string, _ int64, _ int) ([]search.SearchHit, error) {
	f.record("notification")
	return f.lookup("notification")
}

func (f *FakeSearcher) SearchGeofences(_ context.Context, _ string, _ int64, _ int) ([]search.SearchHit, error) {
	f.record("geofence")
	return f.lookup("geofence")
}

func (f *FakeSearcher) SearchAutomations(_ context.Context, _ string, _ int64, _ int) ([]search.SearchHit, error) {
	f.record("automation")
	return f.lookup("automation")
}

func (f *FakeSearcher) SearchLocations(_ context.Context, _ string, _ int64, _ int) ([]search.SearchHit, error) {
	f.record("location")
	return f.lookup("location")
}

func (f *FakeSearcher) SearchTrips(_ context.Context, _ string, _ int64, _ int) ([]search.SearchHit, error) {
	f.record("trip")
	return f.lookup("trip")
}

// compile-time conformance assertion — keeps drift between the
// production interface and this stub from going silent.
var _ search.Searcher = (*FakeSearcher)(nil)
