package rag

import (
	"testing"
	"time"
)

func TestExpiresAt_KnownSourceTypes(t *testing.T) {
	t.Parallel()
	now := time.Date(2025, 1, 15, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		sourceType string
		want       time.Duration
	}{
		{SourceDriveSummary, 90 * 24 * time.Hour},
		{SourceChargeSession, 90 * 24 * time.Hour},
		{SourceAlertHistory, 30 * 24 * time.Hour},
		{SourceAutomationRun, 30 * 24 * time.Hour},
		{SourceUserNote, 365 * 24 * time.Hour},
	}
	for _, c := range cases {
		t.Run(c.sourceType, func(t *testing.T) {
			got := ExpiresAt(c.sourceType, now)
			want := now.Add(c.want)
			if !got.Equal(want) {
				t.Fatalf("ExpiresAt(%s): got %v want %v", c.sourceType, got, want)
			}
			if IsNeverExpires(got) {
				t.Fatalf("ExpiresAt(%s): unexpectedly returned never-expires sentinel", c.sourceType)
			}
		})
	}
}

func TestExpiresAt_DocsNeverExpires(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	got := ExpiresAt(SourceDocs, now)
	if !IsNeverExpires(got) {
		t.Fatalf("docs: want never-expires sentinel, got %v", got)
	}
	// The sentinel must be in the far future so a routine
	// `WHERE expires_at < now()` cron leaves the row alone.
	if got.Before(now.AddDate(100, 0, 0)) {
		t.Fatalf("docs sentinel %v is not far enough in the future", got)
	}
}

func TestExpiresAt_UnknownSourceFallsBack(t *testing.T) {
	t.Parallel()
	now := time.Date(2025, 1, 15, 12, 0, 0, 0, time.UTC)
	got := ExpiresAt("custom-source-not-registered", now)
	want := now.Add(defaultTTL)
	if !got.Equal(want) {
		t.Fatalf("unknown source: got %v want %v", got, want)
	}
	if IsNeverExpires(got) {
		t.Fatal("unknown source: should not be never-expires")
	}
}

func TestTTLPolicy_AllSourceConstantsRegistered(t *testing.T) {
	t.Parallel()
	// Every Source* constant in rag.go MUST appear in TTLPolicy so
	// a typo or rename forces an explicit lifetime decision.
	required := []string{
		SourceDocs,
		SourceDriveSummary,
		SourceChargeSession,
		SourceAlertHistory,
		SourceAutomationRun,
		SourceUserNote,
	}
	for _, s := range required {
		if _, ok := TTLPolicy[s]; !ok {
			t.Errorf("source %q has no entry in TTLPolicy", s)
		}
	}
}

func TestIsNeverExpires(t *testing.T) {
	t.Parallel()
	if !IsNeverExpires(neverExpiresFrom) {
		t.Fatal("sentinel: want true")
	}
	if IsNeverExpires(time.Now()) {
		t.Fatal("now: want false")
	}
	if IsNeverExpires(time.Time{}) {
		t.Fatal("zero: want false")
	}
}
