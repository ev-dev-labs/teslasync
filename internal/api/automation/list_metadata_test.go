package automation

import (
	"encoding/json"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

func TestAutomationResponseUnknownMetadata(t *testing.T) {
	response := newAutomationResponse(&models.Automation{ID: 1, Name: "Base row", Enabled: true})
	raw, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	var row map[string]json.RawMessage
	if err := json.Unmarshal(raw, &row); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"execution_count", "failure_count", "last_triggered_at", "auto_disabled"} {
		if string(row[key]) != "null" {
			t.Fatalf("%s = %s, want null", key, row[key])
		}
	}
	runs, failures := int64(12), int64(0)
	response.ExecutionCount, response.FailureCount = &runs, &failures
	raw, err = json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &row); err != nil {
		t.Fatal(err)
	}
	if string(row["execution_count"]) != "12" || string(row["failure_count"]) != "0" || string(row["auto_disabled"]) != "null" {
		t.Fatalf("populated metadata changed: %s", raw)
	}
}
