// Package comfort preconditions the cabin ahead of calendar events: each
// armed vehicle polls a user-provided ICS subscription, finds the next
// offsite event inside the lead window, and starts climate + sets temps
// so the car is comfortable at departure. Runs are idempotent per event
// UID; generic cron-based preconditioning stays in the automation engine.
package comfort

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// fetchTimeout bounds the ICS subscription fetch (project rule: external
// HTTP calls wrap with context.WithTimeout). maxICSBytes caps the feed.
const (
	fetchTimeout = 10 * time.Second
	maxICSBytes  = 1 << 20
)

// Event is one parsed VEVENT with the fields comfort needs.
type Event struct {
	UID      string    `json:"uid"`
	Title    string    `json:"title"`
	Location string    `json:"location"`
	StartsAt time.Time `json:"starts_at"`
	AllDay   bool      `json:"all_day"`
}

// Fetcher downloads ICS feeds. HTTPClient is overridable for tests.
// Safe for concurrent use.
type Fetcher struct {
	HTTPClient *http.Client
}

// lookupICSHost resolves feed hosts. Overridable in tests so validation
// never needs live DNS.
var lookupICSHost = net.LookupIP

// NewFetcher wires a production fetcher that refuses loopback / link-local
// / metadata redirects (homelab RFC1918 calendars remain allowed).
func NewFetcher() *Fetcher {
	return &Fetcher{HTTPClient: &http.Client{
		Timeout: fetchTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return fmt.Errorf("comfort: too many ICS redirects")
			}
			if req.URL == nil {
				return fmt.Errorf("comfort: ICS redirect missing url")
			}
			return validateICSURL(req.URL.String())
		},
	}}
}

// validateICSURL rejects non-http(s) schemes, loopback, link-local, and
// cloud-metadata addresses. Empty URLs are handled by the caller.
func validateICSURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return fmt.Errorf("comfort: invalid ICS url")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return fmt.Errorf("comfort: ICS url must be http or https")
	}
	host := strings.ToLower(u.Hostname())
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return fmt.Errorf("comfort: ICS url host not allowed")
	}
	if ip := net.ParseIP(host); ip != nil {
		if forbiddenICSIP(ip) {
			return fmt.Errorf("comfort: ICS url host not allowed")
		}
		return nil
	}
	ips, err := lookupICSHost(host)
	if err != nil {
		return fmt.Errorf("comfort: ICS url host lookup failed: %w", err)
	}
	if len(ips) == 0 {
		return fmt.Errorf("comfort: ICS url host not allowed")
	}
	for _, ip := range ips {
		if forbiddenICSIP(ip) {
			return fmt.Errorf("comfort: ICS url host not allowed")
		}
	}
	return nil
}

func forbiddenICSIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return true
	}
	return ip.Equal(net.ParseIP("169.254.169.254"))
}

// Fetch downloads and parses the ICS feed at feedURL.
func (f *Fetcher) Fetch(ctx context.Context, feedURL string) ([]Event, error) {
	if feedURL == "" {
		return nil, fmt.Errorf("comfort: empty ICS url")
	}
	if err := validateICSURL(feedURL); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, fmt.Errorf("comfort: build ICS request: %w", err)
	}
	req.Header.Set("User-Agent", "TeslaSync/1.0")
	client := f.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	callCtx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	resp, err := client.Do(req.WithContext(callCtx))
	if err != nil {
		return nil, fmt.Errorf("comfort: ICS fetch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("comfort: ICS status %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxICSBytes+1))
	if err != nil {
		return nil, fmt.Errorf("comfort: ICS read: %w", err)
	}
	if len(raw) > maxICSBytes {
		return nil, fmt.Errorf("comfort: ICS feed exceeds %d bytes", maxICSBytes)
	}
	return ParseICS(string(raw))
}

// ParseICS parses a minimal VEVENT subset (UID/DTSTART/SUMMARY/LOCATION)
// with RFC 5545 line unfolding. Pure: no I/O. Supported DTSTART forms:
// UTC ("...Z"), TZID-parameterized (IANA zone, UTC fallback), floating
// local (interpreted as UTC — feeds that care emit TZID or Z), and
// date-only (all-day, midnight UTC). Malformed events are skipped, never
// fatal: one bad VEVENT must not kill the whole feed.
func ParseICS(raw string) ([]Event, error) {
	lines := unfoldLines(raw)
	var events []Event
	var cur *Event
	inEvent := false
	for _, ln := range lines {
		switch {
		case ln == "BEGIN:VEVENT":
			inEvent = true
			cur = &Event{}
		case ln == "END:VEVENT":
			if inEvent && cur != nil && cur.UID != "" && !cur.StartsAt.IsZero() {
				events = append(events, *cur)
			}
			inEvent = false
			cur = nil
		case inEvent && cur != nil:
			applyICSLine(cur, ln)
		}
	}
	return events, nil
}

// unfoldLines joins RFC 5545 folded lines (continuations start with a
// space or tab, which is dropped).
func unfoldLines(raw string) []string {
	var out []string
	sc := bufio.NewScanner(strings.NewReader(raw))
	sc.Buffer(make([]byte, 64*1024), 64*1024)
	for sc.Scan() {
		ln := strings.TrimSuffix(sc.Text(), "\r")
		if (strings.HasPrefix(ln, " ") || strings.HasPrefix(ln, "\t")) && len(out) > 0 {
			out[len(out)-1] += strings.TrimPrefix(strings.TrimPrefix(ln, " "), "\t")
			continue
		}
		out = append(out, ln)
	}
	return out
}

func applyICSLine(e *Event, ln string) {
	name, value := splitICSProperty(ln)
	switch {
	case name == "UID":
		e.UID = value
	case name == "SUMMARY":
		e.Title = unescapeICS(value)
	case name == "LOCATION":
		e.Location = unescapeICS(value)
	case name == "DTSTART" || strings.HasPrefix(name, "DTSTART;"):
		if ts, allDay, ok := parseICSDate(name, value); ok {
			e.StartsAt, e.AllDay = ts, allDay
		}
	}
}

// splitICSProperty splits "NAME;PARAM=..:value" into the NAME part (base
// property uppercased, parameters case-preserved — TZIDs are
// case-sensitive) and the value. Returns "","" when malformed.
func splitICSProperty(ln string) (string, string) {
	// Feeds in practice never quote parameter values, so the value starts
	// after the first colon.
	idx := strings.Index(ln, ":")
	if idx < 0 {
		return "", ""
	}
	head := ln[:idx]
	if i := strings.Index(head, ";"); i >= 0 {
		head = strings.ToUpper(head[:i]) + head[i:]
	} else {
		head = strings.ToUpper(head)
	}
	return head, ln[idx+1:]
}

func parseICSDate(name, value string) (time.Time, bool, bool) {
	if strings.HasSuffix(strings.ToUpper(name), "VALUE=DATE") || (len(value) == 8 && !strings.Contains(value, "T")) {
		ts, err := time.Parse("20060102", value)
		if err != nil {
			return time.Time{}, false, false
		}
		return ts.UTC(), true, true
	}
	if strings.HasSuffix(value, "Z") {
		for _, layout := range []string{"20060102T150405Z", "20060102T1504Z"} {
			if ts, err := time.Parse(layout, value); err == nil {
				return ts.UTC(), false, true
			}
		}
		return time.Time{}, false, false
	}
	if tz := tzidParam(name); tz != "" {
		if loc, err := time.LoadLocation(tz); err == nil {
			for _, layout := range []string{"20060102T150405", "20060102T1504"} {
				if ts, err := time.ParseInLocation(layout, value, loc); err == nil {
					return ts.UTC(), false, true
				}
			}
		}
	}
	// Floating local: interpret as UTC (documented).
	for _, layout := range []string{"20060102T150405", "20060102T1504"} {
		if ts, err := time.Parse(layout, value); err == nil {
			return ts.UTC(), false, true
		}
	}
	return time.Time{}, false, false
}

// tzidParam extracts TZID from a "DTSTART;TZID=..." name part,
// matching the parameter name case-insensitively while preserving the
// zone value's case.
func tzidParam(name string) string {
	for _, part := range strings.Split(name, ";") {
		if len(part) > 5 && strings.EqualFold(part[:5], "TZID=") {
			return part[5:]
		}
	}
	return ""
}

func unescapeICS(s string) string {
	r := strings.NewReplacer(`\n`, "\n", `\N`, "\n", `\,`, ",", `\;`, ";", `\\`, `\`)
	return r.Replace(s)
}

// NextOffsite returns the earliest upcoming event with a non-empty
// location starting within (now, now+lead]. All-day events never match
// (no departure time). Pure: no I/O.
func NextOffsite(events []Event, now time.Time, lead time.Duration) *Event {
	var best *Event
	for i := range events {
		e := &events[i]
		if e.AllDay || e.Location == "" || e.StartsAt.IsZero() {
			continue
		}
		dt := e.StartsAt.Sub(now)
		if dt <= 0 || dt > lead {
			continue
		}
		if best == nil || e.StartsAt.Before(best.StartsAt) {
			best = e
		}
	}
	return best
}
