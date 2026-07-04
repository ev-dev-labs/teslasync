package searchtest_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/search"
	"github.com/ev-dev-labs/teslasync/internal/api/search/searchtest"
)

// searchMethod is the shared shape of every FakeSearcher.Search* method.
type searchMethod func(ctx context.Context, q string, idHint int64, limit int) ([]search.SearchHit, error)

// corpusDesc pairs a human-facing method name with the singular key the
// method records/looks up (which MUST equal the matching
// search.SearchType* constant) and a binder that yields the bound
// method value for a given fake. Keeping call as a binder (rather than
// a pre-bound value) lets every subtest use its own fresh fake.
type corpusDesc struct {
	method string
	key    string
	bind   func(*searchtest.FakeSearcher) searchMethod
}

// corpora enumerates all nine Search* methods in handler.go fan-out
// order. The key column is the anti-drift anchor: if a method ever
// records a different corpus name than its search.SearchType* constant,
// the mapping tests below fail loudly.
func corpora() []corpusDesc {
	return []corpusDesc{
		{"SearchVehicles", search.SearchTypeVehicle, func(f *searchtest.FakeSearcher) searchMethod { return f.SearchVehicles }},
		{"SearchDrives", search.SearchTypeDrive, func(f *searchtest.FakeSearcher) searchMethod { return f.SearchDrives }},
		{"SearchCharging", search.SearchTypeCharging, func(f *searchtest.FakeSearcher) searchMethod { return f.SearchCharging }},
		{"SearchAlerts", search.SearchTypeAlert, func(f *searchtest.FakeSearcher) searchMethod { return f.SearchAlerts }},
		{"SearchNotifications", search.SearchTypeNotification, func(f *searchtest.FakeSearcher) searchMethod { return f.SearchNotifications }},
		{"SearchGeofences", search.SearchTypeGeofence, func(f *searchtest.FakeSearcher) searchMethod { return f.SearchGeofences }},
		{"SearchAutomations", search.SearchTypeAutomation, func(f *searchtest.FakeSearcher) searchMethod { return f.SearchAutomations }},
		{"SearchLocations", search.SearchTypeLocation, func(f *searchtest.FakeSearcher) searchMethod { return f.SearchLocations }},
		{"SearchTrips", search.SearchTypeTrip, func(f *searchtest.FakeSearcher) searchMethod { return f.SearchTrips }},
	}
}

func TestNewFakeSearcher_InitializesEmptyWritableMaps(t *testing.T) {
	t.Parallel()
	f := searchtest.NewFakeSearcher()
	if f == nil {
		t.Fatal("NewFakeSearcher() = nil, want non-nil")
	}
	if f.Hits == nil {
		t.Error("Hits map is nil; want an initialised empty map")
	}
	if f.Errs == nil {
		t.Error("Errs map is nil; want an initialised empty map")
	}
	if f.CallLog == nil {
		t.Error("CallLog map is nil; want an initialised empty map")
	}
	if len(f.Hits) != 0 || len(f.Errs) != 0 || len(f.CallLog) != 0 {
		t.Errorf("fresh fake not empty: len(Hits)=%d len(Errs)=%d len(CallLog)=%d",
			len(f.Hits), len(f.Errs), len(f.CallLog))
	}
	// Maps must be immediately writable — a nil map here would panic.
	f.Hits[search.SearchTypeDrive] = []search.SearchHit{{ID: 1}}
	f.Errs[search.SearchTypeDrive] = errors.New("x")
	f.CallLog[search.SearchTypeDrive]++
	if len(f.Hits) != 1 || len(f.Errs) != 1 || f.CallLog[search.SearchTypeDrive] != 1 {
		t.Error("maps did not accept direct mutation")
	}
}

// TestFakeSearcher_KeysCoverExactlyAllSearchTypes proves the fake fans
// out to every corpus the production Searcher interface declares — no
// more, no fewer — and that each key is a singular SearchType constant.
func TestFakeSearcher_KeysCoverExactlyAllSearchTypes(t *testing.T) {
	t.Parallel()
	got := make([]string, 0, len(corpora()))
	seen := map[string]bool{}
	for _, c := range corpora() {
		if seen[c.key] {
			t.Errorf("duplicate corpus key %q across methods", c.key)
		}
		seen[c.key] = true
		got = append(got, c.key)
	}
	want := []string{
		search.SearchTypeVehicle, search.SearchTypeDrive, search.SearchTypeCharging,
		search.SearchTypeAlert, search.SearchTypeNotification, search.SearchTypeGeofence,
		search.SearchTypeAutomation, search.SearchTypeLocation, search.SearchTypeTrip,
	}
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("corpus keys = %v, want %v", got, want)
	}
}

// TestFakeSearcher_EachMethodRecordsItsOwnKey calls all nine methods on
// one fake and asserts every method incremented exactly its own
// (distinct) SearchType key — the contract handler tests rely on to
// assert which corpora fired.
func TestFakeSearcher_EachMethodRecordsItsOwnKey(t *testing.T) {
	t.Parallel()
	f := searchtest.NewFakeSearcher()
	for _, c := range corpora() {
		if _, err := c.bind(f)(context.Background(), "q", -1, 5); err != nil {
			t.Fatalf("%s returned unexpected error: %v", c.method, err)
		}
	}
	if len(f.CallLog) != len(corpora()) {
		t.Fatalf("CallLog has %d distinct keys, want %d: %v", len(f.CallLog), len(corpora()), f.CallLog)
	}
	for _, c := range corpora() {
		if got := f.CallLog[c.key]; got != 1 {
			t.Errorf("%s: CallLog[%q] = %d, want 1 (recorded wrong or duplicate key?)", c.method, c.key, got)
		}
	}
}

func TestFakeSearcher_ReturnsPreloadedHits(t *testing.T) {
	t.Parallel()
	for _, c := range corpora() {
		c := c
		t.Run(c.method, func(t *testing.T) {
			t.Parallel()
			f := searchtest.NewFakeSearcher()
			want := []search.SearchHit{
				{Type: c.key, ID: 7, Title: "hit-a", Score: 0.9},
				{Type: c.key, ID: 8, Title: "hit-b", Score: 0.1},
			}
			f.Hits[c.key] = want

			got, err := c.bind(f)(context.Background(), "q", -1, 5)
			if err != nil {
				t.Fatalf("err = %v, want nil", err)
			}
			if len(got) != len(want) {
				t.Fatalf("len(hits) = %d, want %d", len(got), len(want))
			}
			for i := range want {
				if got[i] != want[i] {
					t.Errorf("hit[%d] = %+v, want %+v", i, got[i], want[i])
				}
			}
			if f.CallLog[c.key] != 1 {
				t.Errorf("CallLog[%q] = %d, want 1", c.key, f.CallLog[c.key])
			}
		})
	}
}

func TestFakeSearcher_ReturnsPreloadedError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("simulated corpus failure")
	for _, c := range corpora() {
		c := c
		t.Run(c.method, func(t *testing.T) {
			t.Parallel()
			f := searchtest.NewFakeSearcher()
			f.Errs[c.key] = sentinel
			// Hits for the same corpus must be shadowed by the error.
			f.Hits[c.key] = []search.SearchHit{{ID: 99}}

			got, err := c.bind(f)(context.Background(), "q", -1, 5)
			if !errors.Is(err, sentinel) {
				t.Fatalf("err = %v, want %v", err, sentinel)
			}
			if got != nil {
				t.Errorf("hits = %+v, want nil when error is returned", got)
			}
			if f.CallLog[c.key] != 1 {
				t.Errorf("CallLog[%q] = %d, want 1 (method must record even on error)", c.key, f.CallLog[c.key])
			}
		})
	}
}

// TestFakeSearcher_DefaultReturnsNilNil proves an un-configured corpus
// yields (nil, nil) — the "no results, no error" empty state.
func TestFakeSearcher_DefaultReturnsNilNil(t *testing.T) {
	t.Parallel()
	for _, c := range corpora() {
		c := c
		t.Run(c.method, func(t *testing.T) {
			t.Parallel()
			f := searchtest.NewFakeSearcher()
			got, err := c.bind(f)(context.Background(), "q", -1, 5)
			if err != nil {
				t.Errorf("err = %v, want nil", err)
			}
			if got != nil {
				t.Errorf("hits = %+v, want nil", got)
			}
			if f.CallLog[c.key] != 1 {
				t.Errorf("CallLog[%q] = %d, want 1", c.key, f.CallLog[c.key])
			}
		})
	}
}

// TestFakeSearcher_NilErrorValueIsIgnored pins the `ok && err != nil`
// guard: an explicit nil error stored for a corpus must NOT mask its
// preloaded hits (a stored-but-nil error is not a failure).
func TestFakeSearcher_NilErrorValueIsIgnored(t *testing.T) {
	t.Parallel()
	f := searchtest.NewFakeSearcher()
	want := []search.SearchHit{{Type: search.SearchTypeDrive, ID: 3, Title: "keep"}}
	f.Errs[search.SearchTypeDrive] = nil // present but nil — not a failure
	f.Hits[search.SearchTypeDrive] = want

	got, err := f.SearchDrives(context.Background(), "q", -1, 5)
	if err != nil {
		t.Fatalf("err = %v, want nil (nil error value must be ignored)", err)
	}
	if len(got) != 1 || got[0] != want[0] {
		t.Errorf("hits = %+v, want %+v", got, want)
	}
}

// TestFakeSearcher_ExplicitNilHitsBeatCatchAll proves a corpus-specific
// key that is present but nil (the "deliberate empty result" pattern
// used by the not-found hydrator tests) shadows the empty-string
// catch-all — precedence step 2 beats step 4.
func TestFakeSearcher_ExplicitNilHitsBeatCatchAll(t *testing.T) {
	t.Parallel()
	f := searchtest.NewFakeSearcher()
	f.Hits[""] = []search.SearchHit{{ID: 1, Title: "default"}}
	f.Hits[search.SearchTypeDrive] = nil // explicit empty for drives only

	drives, err := f.SearchDrives(context.Background(), "q", -1, 5)
	if err != nil {
		t.Fatalf("SearchDrives err = %v, want nil", err)
	}
	if len(drives) != 0 {
		t.Errorf("SearchDrives hits = %+v, want empty (explicit nil must shadow catch-all)", drives)
	}
	// A corpus with no specific key still sees the catch-all default.
	vehicles, err := f.SearchVehicles(context.Background(), "q", -1, 5)
	if err != nil {
		t.Fatalf("SearchVehicles err = %v, want nil", err)
	}
	if len(vehicles) != 1 || vehicles[0].Title != "default" {
		t.Errorf("SearchVehicles hits = %+v, want the catch-all default", vehicles)
	}
}

// TestFakeSearcher_EmptyStringCatchAllHits proves the documented
// contract: preloading Hits[""] makes every un-keyed corpus return it.
func TestFakeSearcher_EmptyStringCatchAllHits(t *testing.T) {
	t.Parallel()
	f := searchtest.NewFakeSearcher()
	def := []search.SearchHit{{ID: 42, Title: "default"}}
	f.Hits[""] = def

	for _, c := range corpora() {
		got, err := c.bind(f)(context.Background(), "q", -1, 5)
		if err != nil {
			t.Fatalf("%s err = %v, want nil", c.method, err)
		}
		if len(got) != 1 || got[0].ID != 42 {
			t.Errorf("%s hits = %+v, want the catch-all default", c.method, got)
		}
	}
}

// TestFakeSearcher_EmptyStringCatchAllError proves Errs[""] is a
// "make every corpus fail" switch, and that a corpus-specific hit still
// takes precedence over the catch-all error (precedence step 2 > 3).
func TestFakeSearcher_EmptyStringCatchAllError(t *testing.T) {
	t.Parallel()
	boom := errors.New("everything is down")
	f := searchtest.NewFakeSearcher()
	f.Errs[""] = boom
	f.Hits[search.SearchTypeVehicle] = []search.SearchHit{{ID: 1, Title: "survivor"}}

	// Un-keyed corpus inherits the catch-all error.
	if _, err := f.SearchDrives(context.Background(), "q", -1, 5); !errors.Is(err, boom) {
		t.Errorf("SearchDrives err = %v, want %v (catch-all error)", err, boom)
	}
	// Corpus-specific hits win over the catch-all error.
	got, err := f.SearchVehicles(context.Background(), "q", -1, 5)
	if err != nil {
		t.Fatalf("SearchVehicles err = %v, want nil (specific hits beat catch-all error)", err)
	}
	if len(got) != 1 || got[0].Title != "survivor" {
		t.Errorf("SearchVehicles hits = %+v, want the specific survivor hit", got)
	}
}

// TestFakeSearcher_SpecificErrorBeatsCatchAllHits proves a
// corpus-specific error wins over the empty-string catch-all hits
// (precedence step 1 > step 4).
func TestFakeSearcher_SpecificErrorBeatsCatchAllHits(t *testing.T) {
	t.Parallel()
	boom := errors.New("drives table locked")
	f := searchtest.NewFakeSearcher()
	f.Hits[""] = []search.SearchHit{{ID: 1, Title: "default"}}
	f.Errs[search.SearchTypeDrive] = boom

	if _, err := f.SearchDrives(context.Background(), "q", -1, 5); !errors.Is(err, boom) {
		t.Errorf("SearchDrives err = %v, want %v", err, boom)
	}
	// A sibling corpus with no specific error still gets the catch-all hits.
	got, err := f.SearchTrips(context.Background(), "q", -1, 5)
	if err != nil {
		t.Fatalf("SearchTrips err = %v, want nil", err)
	}
	if len(got) != 1 || got[0].Title != "default" {
		t.Errorf("SearchTrips hits = %+v, want the catch-all default", got)
	}
}

// TestFakeSearcher_CallLogCountsRepeatedInvocations proves CallLog
// accumulates rather than latching at one.
func TestFakeSearcher_CallLogCountsRepeatedInvocations(t *testing.T) {
	t.Parallel()
	f := searchtest.NewFakeSearcher()
	const n = 4
	for i := 0; i < n; i++ {
		if _, err := f.SearchCharging(context.Background(), "q", -1, 5); err != nil {
			t.Fatalf("iteration %d: err = %v", i, err)
		}
	}
	if f.CallLog[search.SearchTypeCharging] != n {
		t.Errorf("CallLog[%q] = %d, want %d", search.SearchTypeCharging, f.CallLog[search.SearchTypeCharging], n)
	}
	if len(f.CallLog) != 1 {
		t.Errorf("CallLog has %d keys, want 1: %v", len(f.CallLog), f.CallLog)
	}
}

// TestFakeSearcher_ConcurrentCallsAreRaceFree hammers every method from
// many goroutines to prove the internal mutex serialises record/lookup
// (run under -race). It also asserts the aggregate CallLog is exact,
// which would fail on a lost update if the lock were dropped.
func TestFakeSearcher_ConcurrentCallsAreRaceFree(t *testing.T) {
	t.Parallel()
	f := searchtest.NewFakeSearcher()
	cs := corpora()
	// Preload each corpus so lookup exercises a real read path, and one
	// corpus with an error so both branches run concurrently.
	for _, c := range cs {
		f.Hits[c.key] = []search.SearchHit{{Type: c.key, ID: 1}}
	}
	f.Errs[search.SearchTypeAlert] = errors.New("boom")

	const perMethod = 50
	var wg sync.WaitGroup
	for _, c := range cs {
		c := c
		for i := 0; i < perMethod; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, _ = c.bind(f)(context.Background(), "q", -1, 5)
			}()
		}
	}
	wg.Wait()

	total := 0
	for _, c := range cs {
		if got := f.CallLog[c.key]; got != perMethod {
			t.Errorf("CallLog[%q] = %d, want %d", c.key, got, perMethod)
		}
		total += f.CallLog[c.key]
	}
	if want := perMethod * len(cs); total != want {
		t.Errorf("total recorded calls = %d, want %d", total, want)
	}
}

// TestFakeSearcher_ImplementsSearcher is a compile-time + runtime
// assertion that the exported fake satisfies the production port.
func TestFakeSearcher_ImplementsSearcher(t *testing.T) {
	t.Parallel()
	var _ search.Searcher = (*searchtest.FakeSearcher)(nil)
	var s search.Searcher = searchtest.NewFakeSearcher()
	if s == nil {
		t.Fatal("FakeSearcher does not satisfy search.Searcher")
	}
}

type searchResponse struct {
	Hits  []search.SearchHit `json:"hits"`
	Query string             `json:"query"`
}

func decodeSearchResponse(t *testing.T, body []byte) searchResponse {
	t.Helper()
	var resp searchResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode response: %v\nbody=%s", err, string(body))
	}
	return resp
}

// TestFakeSearcher_DrivesRealSearchHandler is the load-bearing
// integration proof: the exported fake plugs into the *production*
// search.Handler and its recorded keys line up with the handler's
// fan-out names. A no-filter query must fan out to all nine corpora and
// surface exactly the preloaded hits, ranked by score.
func TestFakeSearcher_DrivesRealSearchHandler(t *testing.T) {
	t.Parallel()
	f := searchtest.NewFakeSearcher()
	f.Hits[search.SearchTypeVehicle] = []search.SearchHit{
		{Type: search.SearchTypeVehicle, ID: 1, Title: "Model 3", URL: "/vehicles/1", Score: 0.4},
	}
	f.Hits[search.SearchTypeDrive] = []search.SearchHit{
		{Type: search.SearchTypeDrive, ID: 9, Title: "Home to Work", URL: "/drives/9", Score: 0.9},
	}
	// One corpus deliberately fails; the handler must swallow it and
	// still return the surviving hits (partial-failure tolerance).
	f.Errs[search.SearchTypeCharging] = errors.New("charging table down")

	h := search.NewHandlerWithSearcher(f)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/search?q=model", nil)
	h.Search(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	resp := decodeSearchResponse(t, rec.Body.Bytes())
	if resp.Query != "model" {
		t.Errorf("echoed query = %q, want %q", resp.Query, "model")
	}
	if len(resp.Hits) != 2 {
		t.Fatalf("hits = %d, want 2 (vehicle + drive survive, charging error dropped): %+v", len(resp.Hits), resp.Hits)
	}
	if resp.Hits[0].ID != 9 {
		t.Errorf("top hit ID = %d, want 9 (higher score should rank first)", resp.Hits[0].ID)
	}
	// No ?types= filter → the handler must have fanned out to every corpus,
	// which proves the fake's recorded keys match the handler run() names.
	for _, c := range corpora() {
		if f.CallLog[c.key] != 1 {
			t.Errorf("corpus %q fired %d time(s), want 1 — key/name drift between fake and handler", c.key, f.CallLog[c.key])
		}
	}
}

// TestFakeSearcher_HandlerTypesFilterOnlyFiresRequested proves the fake
// records precisely the corpora the handler chose, so consumer tests can
// assert fan-out scoping.
func TestFakeSearcher_HandlerTypesFilterOnlyFiresRequested(t *testing.T) {
	t.Parallel()
	f := searchtest.NewFakeSearcher()
	f.Hits[search.SearchTypeDrive] = []search.SearchHit{
		{Type: search.SearchTypeDrive, ID: 9, Title: "Home to Work", URL: "/drives/9", Score: 0.9},
	}

	h := search.NewHandlerWithSearcher(f)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/search?q=home&types="+search.SearchTypeDrive, nil)
	h.Search(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if f.CallLog[search.SearchTypeDrive] != 1 {
		t.Errorf("drive corpus fired %d time(s), want 1", f.CallLog[search.SearchTypeDrive])
	}
	if len(f.CallLog) != 1 {
		t.Errorf("CallLog = %v, want only the drive corpus to have fired", f.CallLog)
	}
}
