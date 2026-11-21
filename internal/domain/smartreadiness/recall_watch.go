package smartreadiness

import "time"

const RecallVerificationURL = "https://service.tesla.com/en-US/vin-recall-search"

func RecallSourceURL(campaign string) string {
	return "https://www.nhtsa.gov/recalls?nhtsaId=" + campaign
}

type RecallWatchSetup struct {
	Model     string `json:"model"`
	ModelYear int    `json:"model_year"`
}

type RecallCampaignMatch struct {
	Campaign     string    `json:"campaign"`
	Component    string    `json:"component"`
	Remedy       string    `json:"remedy"`
	SourceURL    string    `json:"source_url"`
	Model        string    `json:"model"`
	ModelYear    int       `json:"model_year"`
	ReportedAt   time.Time `json:"reported_at"`
	CheckedAt    time.Time `json:"checked_at"`
	FreshUntil   time.Time `json:"fresh_until"`
	VerifyVINURL string    `json:"verify_vin_url"`
}

type RecallWatch struct {
	ID          int64                 `json:"id"`
	Setup       RecallWatchSetup      `json:"setup"`
	LastSuccess *time.Time            `json:"last_success"`
	LastFailed  bool                  `json:"last_failed"`
	Matches     []RecallCampaignMatch `json:"matches"`
}

type RecallWatchOutcome string

const (
	RecallWatchMatched     RecallWatchOutcome = "model_year_match"
	RecallWatchNoMatch     RecallWatchOutcome = "no_current_match"
	RecallWatchUnavailable RecallWatchOutcome = "source_unavailable"
	RecallWatchChanged     RecallWatchOutcome = "consent_changed"
)
