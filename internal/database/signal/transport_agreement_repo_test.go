package signal

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestTransportAgreementEvidenceSQLIsBoundedAndTrusted(t *testing.T) {
	t.Parallel()
	required := []string{
		"FROM signal_transport_evidence",
		"vehicle_id = $1",
		"source_emitted_at >= $2",
		"source_emitted_at <= $3",
		"normalization_version >= 1",
		"ORDER BY source_emitted_at ASC, field ASC",
		"LIMIT $4",
	}
	for _, fragment := range required {
		if !strings.Contains(transportAgreementEvidenceSQL, fragment) {
			t.Errorf("transport agreement query missing %q", fragment)
		}
	}
}

func TestTransportAgreementRepoRejectsInvalidCalls(t *testing.T) {
	t.Parallel()
	repo := &TransportAgreementRepo{}
	now := time.Now().UTC()
	if _, _, err := repo.AgreementEvidence(context.Background(), 1, now.Add(-time.Hour), now, 100); err == nil {
		t.Fatal("nil query boundary returned no error")
	}
}
