package automation

import (
	"encoding/json"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

func TestAutomationListUnknownAndMeasuredZero(t *testing.T) {
	zero := int64(0)
	for _, tc := range []struct {
		name  string
		count *int64
		want  string
	}{
		{"unavailable", nil, "null"},
		{"measured zero", &zero, "0"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := newAutomationResponse(&models.Automation{ID: 1, Enabled: true})
			response.ExecutionCount = tc.count
			body, err := json.Marshal(response)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(body, &fields); err != nil {
				t.Fatal(err)
			}
			if string(fields["execution_count"]) != tc.want {
				t.Fatalf("execution_count = %s, want %s", fields["execution_count"], tc.want)
			}
			for _, key := range []string{"failure_count", "auto_disabled", "last_triggered_at"} {
				if string(fields[key]) != "null" {
					t.Fatalf("%s = %s, want null", key, fields[key])
				}
			}
		})
	}
}
