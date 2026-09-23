package httputil

import (
	"net/http"
	"strings"
)

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
