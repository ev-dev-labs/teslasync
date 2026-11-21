package smartreadinesssvc

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

func TestServiceCasePreviewContainsOnlySelectedUnredactedFields(t *testing.T) {
	now := time.Date(2026, 11, 20, 7, 45, 0, 0, time.UTC)
	current := domain.ServiceCase{ID: 8, Title: "private-case-name", Evidence: []domain.ServiceCaseEvidence{
		{ID: 1, ObservedAt: now, Kind: domain.ServiceCaseWork, Detail: "Synthetic work: checked rear latch"},
		{ID: 2, ObservedAt: now.Add(-time.Hour), Kind: domain.ServiceCaseWarning, Detail: "Synthetic warning code"},
		{ID: 3, ObservedAt: now.Add(-2 * time.Hour), Kind: domain.ServiceCaseFirmware, Detail: "Unselected firmware"},
	}}
	choices := []domain.ServiceCaseSelection{
		{ID: 1, IncludeDetail: true},
		{ID: 2, IncludeTime: true},
	}
	result, err := buildServiceCasePreview(current, choices)
	if err != nil || len(result.Evidence) != 2 || result.Evidence[0].Kind != domain.ServiceCaseWarning ||
		result.Evidence[0].ObservedAt == nil || result.Evidence[0].Detail != nil ||
		result.Evidence[1].Detail == nil || result.Evidence[1].ObservedAt != nil {
		t.Fatalf("preview did not respect selection, redaction and chronology: %+v, %v", result, err)
	}
	output, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"private-case-name", "Unselected firmware", "Synthetic warning code", `"id"`} {
		if strings.Contains(string(output), private) {
			t.Errorf("preview leaked %q: %s", private, output)
		}
	}
	for _, bad := range [][]domain.ServiceCaseSelection{
		nil, {{ID: 5, IncludeDetail: true}}, {{ID: 1}}, {{ID: 1, IncludeTime: true}, {ID: 1, IncludeDetail: true}},
	} {
		if packet, err := buildServiceCasePreview(current, bad); err == nil || len(packet.Evidence) != 0 {
			t.Errorf("invalid evidence selection produced output: %+v, %v", packet, err)
		}
	}
}

func TestServiceCaseEvidenceRejectsUnknownKindAndUnrelatedTime(t *testing.T) {
	opened := time.Date(2026, 11, 20, 7, 45, 0, 0, time.UTC)
	now := opened.Add(time.Hour)
	for _, test := range []struct {
		name string
		kind domain.ServiceCaseKind
		time time.Time
		want bool
	}{
		{"observed firmware", domain.ServiceCaseFirmware, opened.Add(-time.Hour), true},
		{"recorded follow-up work", domain.ServiceCaseWork, opened.Add(time.Minute), true},
		{"unrelated earlier evidence", domain.ServiceCaseWarning, opened.Add(-15 * 24 * time.Hour), false},
		{"future event", domain.ServiceCaseCondition, now.Add(time.Second), false},
		{"unknown evidence type", "diagnosis", opened, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			entry := domain.ServiceCaseEvidence{ID: 1, Kind: test.kind, ObservedAt: test.time, Detail: " Synthetic observation "}
			got, valid := validateServiceCaseEvidence(entry, opened, now)
			if valid != test.want || (valid && (got.Detail != "Synthetic observation" || got.ID != 0)) {
				t.Fatalf("unexpected evidence eligibility: %+v, %v", got, valid)
			}
		})
	}
}
