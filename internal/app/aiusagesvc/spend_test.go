package aiusagesvc

import (
	"testing"
	"time"
)

func TestAnalyze(t *testing.T) {
	now := time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC)
	today := now.Truncate(24 * time.Hour)
	prior := []DailyRow{
		{Day: today.AddDate(0, 0, -1), FeatureID: "chatbot-llm", Model: "small", Calls: 2, CostMicroCents: 70_000},
		{Day: today.AddDate(0, 0, -2), FeatureID: "chatbot-llm", Model: "small", Calls: 2, CostMicroCents: 70_000},
		{Day: today.AddDate(0, 0, -3), FeatureID: "chatbot-llm", Model: "small", Calls: 2, CostMicroCents: 70_000},
	}
	cases := []struct {
		name      string
		rows      []DailyRow
		at        time.Time
		status    string
		projected bool
	}{
		{"empty", nil, now, "no_spend_today", false},
		{"new spend without baseline", []DailyRow{{Day: today, Calls: 3, CostMicroCents: 120_000}}, now, "insufficient_history", false},
		{"fast expensive model", append(append([]DailyRow{}, prior...), DailyRow{Day: today, FeatureID: "chatbot-llm", Model: "large", Calls: 5, CostMicroCents: 100_000}), now, "unusual_pace", true},
		{"new paid usage after free calls", []DailyRow{
			{Day: today.AddDate(0, 0, -1), Calls: 3},
			{Day: today.AddDate(0, 0, -2), Calls: 3},
			{Day: today.AddDate(0, 0, -3), Calls: 3},
			{Day: today, Calls: 5, CostMicroCents: 100_000},
		}, now, "new_paid_spend", true},
		{"normal pace", append(append([]DailyRow{}, prior...), DailyRow{Day: today, FeatureID: "chatbot-llm", Model: "small", Calls: 5, CostMicroCents: 10_000}), now, "normal", true},
		{"wait for enough calls", append(append([]DailyRow{}, prior...), DailyRow{Day: today, Calls: 1, CostMicroCents: 100_000}), now, "normal", false},
		{"no early projection", append(append([]DailyRow{}, prior...), DailyRow{Day: today, Calls: 5, CostMicroCents: 100_000}), today.Add(20 * time.Minute), "normal", false},
		{"ignore old and future rows", append(append([]DailyRow{}, prior...), DailyRow{Day: today.AddDate(0, 0, -8), Calls: 3, CostMicroCents: 900_000}, DailyRow{Day: today.AddDate(0, 0, 1), Calls: 3, CostMicroCents: 900_000}), now, "no_spend_today", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out := Analyze(tc.rows, tc.at)
			if out.Status != tc.status {
				t.Errorf("status = %q, want %q", out.Status, tc.status)
			}
			if (out.ProjectedTodayMicroCents != nil) != tc.projected {
				t.Errorf("projected = %v, want presence %v", out.ProjectedTodayMicroCents, tc.projected)
			}
		})
	}
}

func TestAnalyzeDriverAttribution(t *testing.T) {
	now := time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC)
	rows := []DailyRow{
		{Day: now, FeatureID: "drive-coaching", Provider: "azure", Model: "expensive", Calls: 3, CostMicroCents: 200_000},
		{Day: now, FeatureID: "chatbot-llm", Provider: "ollama", Model: "local", Calls: 10},
		{Day: now.AddDate(0, 0, -1), FeatureID: "drive-coaching", Provider: "azure", Model: "expensive", Calls: 2, CostMicroCents: 70_000},
	}
	out := Analyze(rows, now)
	if len(out.Drivers) != 2 || out.Drivers[0].FeatureID != "drive-coaching" || out.Drivers[0].PriorDailyAvgMicroCents != 10_000 {
		t.Fatalf("attribution = %+v", out.Drivers)
	}
	if out.PriorActiveDays != 1 || out.PriorDailyAvgMicroCents != 10_000 {
		t.Fatalf("prior history = %+v", out)
	}
}
