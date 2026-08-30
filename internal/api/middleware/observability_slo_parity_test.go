package middleware

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/slo"
)

// A latency SLI selects a single cumulative histogram bucket by its exact
// `le=` boundary. Prometheus only materialises a `_bucket` series for
// boundaries that were configured on the histogram, so an SLI naming a
// boundary that is not in REDLatencyBuckets matches NOTHING.
//
// That failure is silent and dangerous: the generated ratio expression ends
// in `or on() vector(1)` so an empty numerator used to collapse to a
// fabricated, permanent 100 %. The ratio expression now coalesces the
// numerator (see cmd/slogen.ratioExpr) so the SLO reads 0 instead of 1, but
// the real fix is to never ship the mismatch. This test is that gate.
//
// Scope is deliberately the RED HTTP histogram only: frontend web-vitals and
// SSE/continuity SLOs observe different histograms with their own boundaries.
func TestREDLatencyBucketsCoverCatalogSLOs(t *testing.T) {
	t.Parallel()

	catalogPath := filepath.Join("..", "..", "..", "slo", "catalog.yaml")
	if _, err := os.Stat(catalogPath); err != nil {
		t.Fatalf("locate slo catalog: %v", err)
	}
	catalog, err := slo.LoadCatalog(catalogPath)
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}

	configured := make(map[string]struct{}, len(REDLatencyBuckets))
	for _, b := range REDLatencyBuckets {
		configured[promBucketLabel(b)] = struct{}{}
	}

	// Matches `le="<value>"` inside a selector that also names the RED
	// duration histogram.
	leRE := regexp.MustCompile(`le="([^"]+)"`)

	checked := 0
	for _, s := range catalog.SLOs {
		for _, expr := range []string{s.SLI.GoodEvents, s.SLI.ValidEvents} {
			if !strings.Contains(expr, "teslasync_red_http_request_duration_seconds_bucket") {
				continue
			}
			for _, m := range leRE.FindAllStringSubmatch(expr, -1) {
				checked++
				raw := m[1]
				if _, ok := configured[raw]; ok {
					continue
				}
				// Give a precise diagnosis: is it a formatting mismatch
				// (le="1.0" vs le="1") or a genuinely absent boundary?
				parsed, perr := strconv.ParseFloat(raw, 64)
				switch {
				case perr != nil:
					t.Errorf("SLO %q: le=%q is not a number", s.Name, raw)
				case hasBoundary(parsed):
					t.Errorf(
						"SLO %q: le=%q is not the canonical Prometheus label for boundary %v; use le=%q",
						s.Name, raw, parsed, promBucketLabel(parsed),
					)
				default:
					t.Errorf(
						"SLO %q selects le=%q, which is NOT a configured bucket of "+
							"teslasync_red_http_request_duration_seconds (buckets: %v). "+
							"This SLI would match no series and monitor nothing. "+
							"Add the boundary to REDLatencyBuckets or retarget the objective.",
						s.Name, raw, REDLatencyBuckets,
					)
				}
			}
		}
	}
	if checked == 0 {
		t.Fatal("no RED latency SLI found in the catalog — this gate would be vacuous")
	}
}

// TestREDLatencyBucketsIncludeTwoSecondObjective pins the specific boundary
// the named 2-second objectives depend on, so a future bucket-trimming change
// fails here with an explicit reason rather than silently unmonitoring them.
func TestREDLatencyBucketsIncludeTwoSecondObjective(t *testing.T) {
	t.Parallel()
	if !hasBoundary(2) {
		t.Fatalf("REDLatencyBuckets must contain the 2s boundary for the *_latency_2s SLOs; got %v", REDLatencyBuckets)
	}
}

// TestREDLatencyBucketsAreSortedAndUnique guards the Prometheus client
// requirement that bucket boundaries are strictly increasing.
func TestREDLatencyBucketsAreSortedAndUnique(t *testing.T) {
	t.Parallel()
	for i := 1; i < len(REDLatencyBuckets); i++ {
		if REDLatencyBuckets[i] <= REDLatencyBuckets[i-1] {
			t.Fatalf(
				"REDLatencyBuckets must be strictly increasing; %v <= %v at index %d",
				REDLatencyBuckets[i], REDLatencyBuckets[i-1], i,
			)
		}
	}
}

func hasBoundary(v float64) bool {
	for _, b := range REDLatencyBuckets {
		if b == v {
			return true
		}
	}
	return false
}

// promBucketLabel renders a bucket boundary the way the Prometheus client
// formats the `le` label (shortest round-trippable representation), so the
// comparison is against the label that will actually exist at scrape time.
func promBucketLabel(v float64) string {
	return strconv.FormatFloat(v, 'g', -1, 64)
}
