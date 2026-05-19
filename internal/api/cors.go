package api

import (
	"fmt"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// resolveCORSOrigins parses cfg.CORSOrigins into the allowlist passed
// to chi-cors and enforces the production fail-closed contract:
//
//   - dev: empty -> ["*"], wildcard allowed (credentials disabled by
//     Fetch spec), comma-separated explicit list is honoured.
//   - production / prod: empty or explicit "*" returns an error so the
//     process refuses to start. Operators MUST set CORS_ORIGINS to a
//     hostname allowlist before deploying.
//
// Multiple origins may be configured by comma-separating them — useful
// when running canary + stable hostnames behind the same chart.
func resolveCORSOrigins(cfg *config.Config) ([]string, error) {
	isProd := strings.EqualFold(cfg.Environment, "production") ||
		strings.EqualFold(cfg.Environment, "prod")

	var origins []string
	if cfg.CORSOrigins == "" {
		if isProd {
			return nil, fmt.Errorf("CORS_ORIGINS must be set when TESLASYNC_ENVIRONMENT=%s", cfg.Environment)
		}
		return []string{"*"}, nil
	}
	for _, raw := range strings.Split(cfg.CORSOrigins, ",") {
		origin := strings.TrimSpace(raw)
		if origin == "" {
			continue
		}
		origins = append(origins, origin)
	}
	if isProd {
		if len(origins) == 0 {
			return nil, fmt.Errorf("CORS_ORIGINS must be set when TESLASYNC_ENVIRONMENT=%s (got whitespace-only value)", cfg.Environment)
		}
		for _, o := range origins {
			if o == "*" {
				return nil, fmt.Errorf("CORS_ORIGINS=%q is forbidden when TESLASYNC_ENVIRONMENT=%s; set an explicit hostname allowlist", o, cfg.Environment)
			}
		}
	}
	if len(origins) == 0 {
		// Pure whitespace input in dev — degrade to wildcard so the
		// dev loop doesn't break on a malformed env var.
		return []string{"*"}, nil
	}
	return origins, nil
}
