package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// TestAPIContracts is an env-gated HTTP smoke test that asserts every critical
// API endpoint still returns its required response shape after a schema or
// query refactor. It runs only when TESLASYNC_API_URL is set — CI wires this
// up against an ephemeral docker-compose stack; developers can run it ad-hoc
// against a local server:
//
//	TESLASYNC_API_URL=http://localhost:8080 \
//	  go test -run TestAPIContracts ./internal/api/...
//
// Without TESLASYNC_API_URL the test is skipped (not failed), keeping `go
// test ./...` green on machines that don't have the full stack up.
func TestAPIContracts(t *testing.T) {
	base := strings.TrimRight(os.Getenv("TESLASYNC_API_URL"), "/")
	if base == "" {
		t.Skip("TESLASYNC_API_URL not set — skipping contract smoke test")
	}

	token := os.Getenv("TESLASYNC_API_TOKEN") // optional

	type endpoint struct {
		Name           string
		Path           string
		RequiredFields []string
	}

	cases := []endpoint{
		{
			Name: "vehicles_list",
			Path: "/api/v1/vehicles",
			// List endpoint — fields are validated on first element.
			RequiredFields: []string{"id", "display_name"},
		},
		{
			Name:           "vehicle_state",
			Path:           "/api/v1/vehicles/1/state",
			RequiredFields: []string{"vehicle_id"},
		},
		{
			Name:           "charging_list",
			Path:           "/api/v1/charging",
			RequiredFields: []string{}, // list may be empty; only shape is checked
		},
		{
			Name:           "analytics_battery_degradation",
			Path:           "/api/v1/analytics/battery-degradation?vehicle_id=1",
			RequiredFields: []string{},
		},
		{
			Name:           "analytics_fleet",
			Path:           "/api/v1/analytics/fleet",
			RequiredFields: []string{},
		},
		{
			Name:           "system_health",
			Path:           "/api/v1/system/health",
			RequiredFields: []string{},
		},
	}

	client := &http.Client{Timeout: 10 * time.Second}

	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodGet, base+tc.Path, nil)
			if err != nil {
				t.Fatalf("build request: %v", err)
			}
			if token != "" {
				req.Header.Set("Authorization", "Bearer "+token)
			}

			resp, err := client.Do(req)
			if err != nil {
				t.Fatalf("request %s failed: %v", tc.Path, err)
			}
			defer resp.Body.Close()

			body, _ := io.ReadAll(resp.Body)

			// Accept 200 and 404 (e.g. vehicle 1 may not exist on a fresh DB) — only
			// reject transport/5xx/structural failures.
			if resp.StatusCode >= 500 {
				t.Fatalf("%s: server error %d: %s", tc.Path, resp.StatusCode, truncate(body, 300))
			}
			if resp.StatusCode == http.StatusNotFound {
				t.Skipf("%s returned 404 — no seed data", tc.Path)
			}
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("%s: unexpected status %d: %s", tc.Path, resp.StatusCode, truncate(body, 300))
			}

			first, err := firstObject(body)
			if err != nil {
				t.Fatalf("%s: response is not an object or array of objects: %v (body: %s)", tc.Path, err, truncate(body, 200))
			}
			if first == nil {
				// Empty list/object is acceptable when no RequiredFields are asserted.
				if len(tc.RequiredFields) > 0 {
					t.Fatalf("%s: response is empty but required fields %v expected", tc.Path, tc.RequiredFields)
				}
				return
			}

			for _, f := range tc.RequiredFields {
				if _, ok := first[f]; !ok {
					t.Errorf("%s: response missing required field %q (got keys: %v)", tc.Path, f, keys(first))
				}
			}
		})
	}
}

// firstObject returns the response when it's a single object, or the first
// element when it's an array of objects. Returns (nil, nil) for an empty array.
func firstObject(body []byte) (map[string]any, error) {
	var asObject map[string]any
	if err := json.Unmarshal(body, &asObject); err == nil {
		return asObject, nil
	}
	var asArray []map[string]any
	if err := json.Unmarshal(body, &asArray); err != nil {
		return nil, err
	}
	if len(asArray) == 0 {
		return nil, nil
	}
	return asArray[0], nil
}

func keys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "…"
}
