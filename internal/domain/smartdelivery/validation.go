package smartdelivery

import (
	"net/url"
	"strings"
)

func ValidSubscriptionEndpoint(endpoint string) bool {
	if endpoint == "" || len(endpoint) > 2048 || strings.TrimSpace(endpoint) != endpoint {
		return false
	}
	u, err := url.Parse(endpoint)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil &&
		u.Fragment == "" && u.Opaque == "" && (u.Port() == "" || u.Port() == "443")
}
