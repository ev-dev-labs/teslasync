package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// contractEndpoints lists the read-only API endpoints whose response shape
// must remain stable across the database refactor. The test verifies that:
//   1. Each endpoint returns 200 OK.
//   2. The response contains every field listed in RequiredFields.
//   3. Top-level keys do not regress against a saved snapshot.
//
// The test only runs when CONTRACT_TEST_URL is set (e.g. to
// http://localhost:8080) — this lets us validate against a deployed canary
// instance in CI without booting the full app stack from a unit test.
var contractEndpoints = []struct {
	Name           string
	Method         string
	Path           string
	RequiredFields []string
}{
	{
		Name:   "charging_telemetry_latest",
		Method: http.MethodGet,
		Path:   "/api/v1/charging/latest?vehicle_id=1",
		RequiredFields: []string{
			"vehicle_id", "battery_level", "created_at",
		},
	},
	{
		Name:   "vehicle_state",
		Method: http.MethodGet,
		Path:   "/api/v1/vehicles/1/state",
		RequiredFields: []string{
			"vehicle_id",
		},
	},
	{
		Name:           "analytics_battery_degradation",
		Method:         http.MethodGet,
		Path:           "/api/v1/analytics/battery-degradation?vehicle_id=1&days=30",
		RequiredFields: []string{},
	},
	{
		Name:           "analytics_fleet",
		Method:         http.MethodGet,
		Path:           "/api/v1/analytics/fleet",
		RequiredFields: []string{},
	},
}

func TestAPIContracts(t *testing.T) {
	baseURL := os.Getenv("CONTRACT_TEST_URL")
	if baseURL == "" {
		t.Skip("CONTRACT_TEST_URL not set; skipping API contract tests")
	}

	snapshotDir := filepath.Join("testdata", "api_snapshots")
	require.NoError(t, os.MkdirAll(snapshotDir, 0o755))

	client := &http.Client{}

	for _, ep := range contractEndpoints {
		ep := ep
		t.Run(ep.Name, func(t *testing.T) {
			req, err := http.NewRequest(ep.Method, baseURL+ep.Path, nil)
			require.NoError(t, err)

			resp, err := client.Do(req)
			require.NoError(t, err)
			defer resp.Body.Close()

			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			require.Equalf(t, http.StatusOK, resp.StatusCode,
				"endpoint %s returned %d: %s", ep.Path, resp.StatusCode, string(body))

			// Try object first, then array of objects.
			var result map[string]any
			if err := json.Unmarshal(body, &result); err != nil {
				var arr []map[string]any
				require.NoErrorf(t, json.Unmarshal(body, &arr),
					"response is neither object nor array: %s", string(body))
				if len(arr) == 0 {
					t.Logf("warning: %s returned empty array", ep.Path)
					return
				}
				result = arr[0]
			}

			for _, field := range ep.RequiredFields {
				assert.Containsf(t, result, field,
					"response missing required field %q in %s", field, ep.Path)
			}

			snapshotFile := filepath.Join(snapshotDir, ep.Name+".json")
			if existing, err := os.ReadFile(snapshotFile); err == nil {
				var expected map[string]any
				require.NoError(t, json.Unmarshal(existing, &expected))
				for key := range expected {
					assert.Containsf(t, result, key,
						"field %q present in snapshot but missing in current response", key)
				}
			} else {
				require.NoError(t, os.WriteFile(snapshotFile, body, 0o644))
				t.Logf("snapshot saved: %s", snapshotFile)
			}
		})
	}
}
