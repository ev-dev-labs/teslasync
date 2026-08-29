package signalinspect

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestTransportAgreementOverLimitRangeIsNotTruncated pins the API contract the
// Signal Log viewer now honours client-side: a submitted history window wider
// than the agreement cap is REJECTED, never silently narrowed. Truncating it
// server-side would answer a question the caller did not ask and would let a
// 30/90-day report claim coverage it never had.
func TestTransportAgreementOverLimitRangeIsNotTruncated(t *testing.T) {
	t.Parallel()

	to := time.Date(2026, 8, 27, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		days int
	}{
		{name: "just over the cap", days: 8},
		{name: "thirty day preset", days: 30},
		{name: "ninety day preset", days: 90},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeTransportAgreementReader{}
			handler := &Handler{transportAgreement: repo}
			from := to.AddDate(0, 0, -tc.days)
			req := signalRequestWithVehicleID(
				t,
				http.MethodGet,
				"/signals/7/transport-agreement?from="+from.Format(time.RFC3339)+"&to="+to.Format(time.RFC3339),
				"7",
			)
			recorder := httptest.NewRecorder()

			handler.TransportAgreement(recorder, req)

			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 for a %d-day window", recorder.Code, tc.days)
			}
			if repo.limit != 0 {
				t.Fatalf("evidence repository was queried for an out-of-range window (limit=%d)", repo.limit)
			}
			var body map[string]string
			if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
				t.Fatalf("decode error body: %v", err)
			}
			if !strings.Contains(body["error"], "168 hours") {
				t.Fatalf("error = %q, want the explicit hour cap", body["error"])
			}
		})
	}
}

// TestTransportAgreementAcceptsExactlySevenDays pins the inclusive boundary the
// frontend gate mirrors, so the two limits cannot drift apart silently.
func TestTransportAgreementAcceptsExactlySevenDays(t *testing.T) {
	t.Parallel()

	repo := &fakeTransportAgreementReader{}
	handler := &Handler{transportAgreement: repo}
	to := time.Date(2026, 8, 27, 0, 0, 0, 0, time.UTC)
	from := to.Add(-transportAgreementMaxHours * time.Hour)
	req := signalRequestWithVehicleID(
		t,
		http.MethodGet,
		"/signals/7/transport-agreement?from="+from.Format(time.RFC3339)+"&to="+to.Format(time.RFC3339),
		"7",
	)
	recorder := httptest.NewRecorder()

	handler.TransportAgreement(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 at exactly %d hours; body=%s",
			recorder.Code, transportAgreementMaxHours, recorder.Body.String())
	}
	if !repo.from.Equal(from) || !repo.to.Equal(to) {
		t.Fatalf("repo window = %s..%s, want the submitted %s..%s (no truncation)",
			repo.from, repo.to, from, to)
	}
}
