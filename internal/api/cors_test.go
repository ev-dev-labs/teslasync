package api

import (
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// TestResolveCORSOrigins_FailClosedInProduction verifies that production
// environments reject both empty CORS_ORIGINS and an explicit "*".
// In development the wildcard is allowed (paired with
// AllowCredentials=false per the Fetch spec).
func TestResolveCORSOrigins_FailClosedInProduction(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name        string
		environment string
		corsOrigins string
		wantErr     bool
		errContains string
		wantOrigins []string
	}{
		{name: "dev empty -> wildcard allowed", environment: "development", corsOrigins: "", wantOrigins: []string{"*"}},
		{name: "dev wildcard -> wildcard allowed", environment: "development", corsOrigins: "*", wantOrigins: []string{"*"}},
		{name: "dev explicit -> allowed", environment: "development", corsOrigins: "https://localhost", wantOrigins: []string{"https://localhost"}},
		{name: "prod empty -> rejected", environment: "production", corsOrigins: "", wantErr: true, errContains: "CORS_ORIGINS must be set"},
		{name: "prod wildcard -> rejected", environment: "production", corsOrigins: "*", wantErr: true, errContains: "forbidden"},
		{name: "prod explicit -> allowed", environment: "production", corsOrigins: "https://teslasync.example", wantOrigins: []string{"https://teslasync.example"}},
		{name: "prod multi-origin -> allowed", environment: "production", corsOrigins: "https://a.example, https://b.example", wantOrigins: []string{"https://a.example", "https://b.example"}},
		{name: "prod alias (prod) wildcard -> rejected", environment: "prod", corsOrigins: "*", wantErr: true, errContains: "forbidden"},
		{name: "prod whitespace-only origin -> rejected", environment: "production", corsOrigins: "  ,  ", wantErr: true, errContains: "must be set"},
		{name: "dev whitespace-only -> wildcard fallback", environment: "development", corsOrigins: "  ,  ", wantOrigins: []string{"*"}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			cfg := &config.Config{
				Environment: tc.environment,
				CORSOrigins: tc.corsOrigins,
			}
			got, err := resolveCORSOrigins(cfg)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("want error containing %q, got nil", tc.errContains)
				}
				if !strings.Contains(err.Error(), tc.errContains) {
					t.Fatalf("want error containing %q, got %q", tc.errContains, err.Error())
				}
				return
			}
			if err != nil {
				t.Fatalf("want no error, got %v", err)
			}
			if len(got) != len(tc.wantOrigins) {
				t.Fatalf("want origins %v, got %v", tc.wantOrigins, got)
			}
			for i := range got {
				if got[i] != tc.wantOrigins[i] {
					t.Fatalf("origin[%d]: want %q, got %q", i, tc.wantOrigins[i], got[i])
				}
			}
		})
	}
}
