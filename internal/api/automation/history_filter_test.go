package automation

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestParseHistoryFilter(t *testing.T) {
	tests := []struct {
		name   string
		query  string
		since  time.Time
		before time.Time
		err    bool
	}{
		{
			name:   "inclusive end date",
			query:  "since=2026-04-01&until=2026-04-30&status=failed",
			since:  time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC),
			before: time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
		},
		{
			name:   "exclusive end instant",
			query:  "since=2026-04-01T12:00:00Z&until=2026-04-02T12:00:00Z",
			since:  time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC),
			before: time.Date(2026, 4, 2, 12, 0, 0, 0, time.UTC),
		},
		{name: "unbounded", query: ""},
		{name: "invalid start", query: "since=tomorrow", err: true},
		{name: "invalid end", query: "until=tomorrow", err: true},
		{name: "reversed dates", query: "since=2026-05-01&until=2026-04-01", err: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/automations/history?"+tt.query, nil)
			got, err := parseHistoryFilter(request)
			if (err != nil) != tt.err {
				t.Fatalf("parseHistoryFilter error = %v, want error %v", err, tt.err)
			}
			if err != nil {
				return
			}
			if !got.Since.Equal(tt.since) || !got.Before.Equal(tt.before) {
				t.Errorf("range = [%v, %v), want [%v, %v)", got.Since, got.Before, tt.since, tt.before)
			}
		})
	}
}
