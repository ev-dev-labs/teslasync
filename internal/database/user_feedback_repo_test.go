package database

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateFeedbackCategory(t *testing.T) {
	tests := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"bug", "bug", false},
		{" Feature ", "feature", false},
		{"OTHER", "other", false},
		{"", "", true},
		{"spam", "", true},
	}
	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			got, err := ValidateFeedbackCategory(tc.in)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err: got %v, wantErr %v", err, tc.wantErr)
			}
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
			if tc.wantErr && err != nil && !errors.Is(err, ErrFeedbackInvalidCategory) {
				t.Fatalf("err not wrapped: %v", err)
			}
		})
	}
}

func TestValidateFeedbackStatus(t *testing.T) {
	tests := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"new", "new", false},
		{" Triaged ", "triaged", false},
		{"CLOSED", "closed", false},
		{"", "", true},
		{"weird", "", true},
	}
	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			got, err := ValidateFeedbackStatus(tc.in)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err: got %v, wantErr %v", err, tc.wantErr)
			}
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
			if tc.wantErr && err != nil && !errors.Is(err, ErrFeedbackInvalidStatus) {
				t.Fatalf("err not wrapped: %v", err)
			}
		})
	}
}

func TestNormalizeFeedbackInputAccepted(t *testing.T) {
	in := FeedbackInsert{
		Category: "BUG",
		Title:    "  short title that meets minimum  ",
		Body:     strings.Repeat("a", 50),
	}
	clean, err := NormalizeFeedbackInput(in)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if clean.Category != "bug" {
		t.Fatalf("category not normalised: %q", clean.Category)
	}
	if clean.Title != "short title that meets minimum" {
		t.Fatalf("title not trimmed: %q", clean.Title)
	}
}

func TestNormalizeFeedbackInputTitleTooShort(t *testing.T) {
	in := FeedbackInsert{
		Category: "bug",
		Title:    "hi",
		Body:     strings.Repeat("a", 50),
	}
	_, err := NormalizeFeedbackInput(in)
	if !errors.Is(err, ErrFeedbackTitleTooShort) {
		t.Fatalf("want title-too-short, got %v", err)
	}
}

func TestNormalizeFeedbackInputBodyTooShort(t *testing.T) {
	in := FeedbackInsert{
		Category: "bug",
		Title:    "valid title here",
		Body:     "too short",
	}
	_, err := NormalizeFeedbackInput(in)
	if !errors.Is(err, ErrFeedbackBodyTooShort) {
		t.Fatalf("want body-too-short, got %v", err)
	}
}

func TestNormalizeFeedbackInputTitleTruncated(t *testing.T) {
	in := FeedbackInsert{
		Category: "bug",
		Title:    strings.Repeat("x", FeedbackTitleMaxLen+50),
		Body:     strings.Repeat("a", 50),
	}
	clean, err := NormalizeFeedbackInput(in)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len([]rune(clean.Title)) != FeedbackTitleMaxLen {
		t.Fatalf("title not truncated to %d: got %d", FeedbackTitleMaxLen, len([]rune(clean.Title)))
	}
}

func TestNormalizeFeedbackInputBodyTruncated(t *testing.T) {
	in := FeedbackInsert{
		Category: "bug",
		Title:    "valid title here",
		Body:     strings.Repeat("y", FeedbackBodyMaxLen+1000),
	}
	clean, err := NormalizeFeedbackInput(in)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len([]rune(clean.Body)) != FeedbackBodyMaxLen {
		t.Fatalf("body not truncated to %d: got %d", FeedbackBodyMaxLen, len([]rune(clean.Body)))
	}
}

func TestNormalizeFeedbackInputDropsInvalidJSONErrors(t *testing.T) {
	in := FeedbackInsert{
		Category:     "bug",
		Title:        "valid title here",
		Body:         strings.Repeat("a", 50),
		RecentErrors: []byte(`{not valid json`),
	}
	clean, err := NormalizeFeedbackInput(in)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(clean.RecentErrors) != 0 {
		t.Fatalf("invalid recent_errors should be dropped, got %s", string(clean.RecentErrors))
	}
}

func TestNormalizeFeedbackInputDropsOversizedRecentErrors(t *testing.T) {
	// Build a valid-JSON payload that exceeds the byte cap.
	big := `["` + strings.Repeat("x", FeedbackRecentErrorsMaxBytes+1) + `"]`
	in := FeedbackInsert{
		Category:     "bug",
		Title:        "valid title here",
		Body:         strings.Repeat("a", 50),
		RecentErrors: []byte(big),
	}
	clean, err := NormalizeFeedbackInput(in)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(clean.RecentErrors) != 0 {
		t.Fatalf("oversized recent_errors should be dropped")
	}
}

func TestNormalizeFeedbackInputKeepsValidJSONErrors(t *testing.T) {
	payload := []byte(`[{"name":"TypeError","message":"x is not defined","route":"/dash"}]`)
	in := FeedbackInsert{
		Category:     "bug",
		Title:        "valid title here",
		Body:         strings.Repeat("a", 50),
		RecentErrors: payload,
	}
	clean, err := NormalizeFeedbackInput(in)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if string(clean.RecentErrors) != string(payload) {
		t.Fatalf("recent_errors mutated: %s", string(clean.RecentErrors))
	}
}

func TestNormalizeFeedbackInputTruncatesUserAgent(t *testing.T) {
	in := FeedbackInsert{
		Category:  "bug",
		Title:     "valid title here",
		Body:      strings.Repeat("a", 50),
		UserAgent: strings.Repeat("u", FeedbackUserAgentMaxLen+200),
	}
	clean, err := NormalizeFeedbackInput(in)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len([]rune(clean.UserAgent)) != FeedbackUserAgentMaxLen {
		t.Fatalf("ua not truncated: got %d", len([]rune(clean.UserAgent)))
	}
}

func TestTruncateRunesEdges(t *testing.T) {
	if truncateRunes("", 5) != "" {
		t.Fatal("empty in -> empty out")
	}
	if truncateRunes("abc", 0) != "" {
		t.Fatal("n=0 returns empty")
	}
	if truncateRunes("abc", 5) != "abc" {
		t.Fatal("under cap -> unchanged")
	}
	if truncateRunes("abcdef", 3) != "abc" {
		t.Fatalf("over cap -> truncated, got %q", truncateRunes("abcdef", 3))
	}
}
