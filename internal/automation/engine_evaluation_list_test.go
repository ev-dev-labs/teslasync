package automation

import (
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

func TestCompareConditionSignalList(t *testing.T) {
	tests := []struct {
		name   string
		actual any
		list   string
		want   bool
	}{
		{"numeric member", 31.2928, "10,31.2928,40", true},
		{"integer member", 20, "10,20,30", true},
		{"numeric nonmember", 31.2928, "10,30,40", false},
		{"trimmed numeric", 20.0, "10, 20 ,30", true},
		{"state member", "online", "asleep, online", true},
		{"state nonmember", "offline", "asleep, online", false},
		{"invalid numeric", 20.0, "20,garbage", false},
		{"nonfinite numeric", 20.0, "20,NaN", false},
		{"empty item", 20.0, "20,", false},
		{"empty list", 0.0, "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			condition := &models.AutomationStepConditionSignal{
				Signal: "test", Op: "in", ValueText: &tt.list,
			}
			got, reason := compareConditionSignal(tt.actual, condition)
			if got != tt.want {
				t.Fatalf("got %v, want %v: %s", got, tt.want, reason)
			}
			if reason == "" {
				t.Fatal("missing evaluation reason")
			}
		})
	}
}
