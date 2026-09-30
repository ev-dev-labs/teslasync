package httputil

import (
	"net/http"
	"regexp"
	"strings"
)

const AppInstallationHeader = "X-Teslasync-App"

var appInstallationPattern = regexp.MustCompile(`^(?:windows|macos|linux|desktop|android|ios|mobile):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// SafeHeaders keeps diagnostic metadata while withholding credentials and
// application-specific header values. Never persist arbitrary header values.
func SafeHeaders(h http.Header) map[string]string {
	if len(h) == 0 {
		return nil
	}
	out := make(map[string]string, min(len(h), 64))
	for name, values := range h {
		if len(out) == 64 {
			break
		}
		key := http.CanonicalHeaderKey(name)
		value := "REDACTED"
		switch strings.ToLower(key) {
		case strings.ToLower(AppInstallationHeader):
			if len(values) == 1 && appInstallationPattern.MatchString(values[0]) {
				value = values[0]
			}
		case "accept", "accept-encoding", "content-type", "content-encoding",
			"cache-control", "vary", "retry-after":
			if len(values) > 0 {
				value = values[0]
				if len(value) > 512 {
					value = value[:512] + "... [truncated]"
				}
			}
		}
		out[key] = value
	}
	return out
}
