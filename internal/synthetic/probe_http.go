package synthetic

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	platformhttp "github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// HTTPProbe asserts an HTTP endpoint returns a status in the
// configured allowed set within the runner's per-probe timeout.
// Default allowed set is {200} — pass StatusAllowed to widen.
type HTTPProbe struct {
	ProbeName      string
	URL            string
	Method         string
	Client         *http.Client
	StatusAllowed  []int
	ExpectBodyHas  string // optional: probe fails if non-empty and the body does not contain this substring
	MaxBodyReadKiB int    // safety cap on body bytes read; default 64
}

// NewHTTPProbe wires a default GET probe against url. Client defaults
// to a 10s-timeout net/http.Client.
func NewHTTPProbe(name, url string) *HTTPProbe {
	return &HTTPProbe{
		ProbeName: name,
		URL:       url,
		Method:    http.MethodGet,
		Client: platformhttp.NewClient(platformhttp.ClientConfig{
			Name:    "synthetic-http-probe",
			Timeout: 10 * time.Second,
		}),
		StatusAllowed:  []int{200},
		MaxBodyReadKiB: 64,
	}
}

// Name returns the probe name surfaced in the runner snapshot + metrics.
func (p *HTTPProbe) Name() string { return p.ProbeName }

// Run executes one probe iteration.
func (p *HTTPProbe) Run(ctx context.Context) error {
	if p == nil {
		return errors.New("nil probe")
	}
	if p.URL == "" {
		return errors.New("empty url")
	}
	method := p.Method
	if method == "" {
		method = http.MethodGet
	}
	req, err := http.NewRequestWithContext(ctx, method, p.URL, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	client := p.Client
	if client == nil {
		client = platformhttp.NewClient(platformhttp.ClientConfig{
			Name:    "synthetic-http-probe",
			Timeout: 10 * time.Second,
		})
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("do: %w", err)
	}
	defer resp.Body.Close()
	if !statusAllowed(resp.StatusCode, p.StatusAllowed) {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64*1024))
		return fmt.Errorf("unexpected status %d for %s %s", resp.StatusCode, method, p.URL)
	}
	readMax := p.MaxBodyReadKiB
	if readMax <= 0 {
		readMax = 64
	}
	if p.ExpectBodyHas != "" {
		body, err := io.ReadAll(io.LimitReader(resp.Body, int64(readMax)*1024))
		if err != nil {
			return fmt.Errorf("read body: %w", err)
		}
		if !containsString(string(body), p.ExpectBodyHas) {
			return fmt.Errorf("body did not contain %q (first %d bytes shown above)", p.ExpectBodyHas, len(body))
		}
	} else if _, err := io.Copy(io.Discard, io.LimitReader(resp.Body, int64(readMax)*1024)); err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	return nil
}

func statusAllowed(got int, allowed []int) bool {
	if len(allowed) == 0 {
		return got >= 200 && got < 300
	}
	for _, s := range allowed {
		if s == got {
			return true
		}
	}
	return false
}

func containsString(haystack, needle string) bool {
	if needle == "" {
		return true
	}
	hl, nl := len(haystack), len(needle)
	if nl > hl {
		return false
	}
	for i := 0; i+nl <= hl; i++ {
		if haystack[i:i+nl] == needle {
			return true
		}
	}
	return false
}
