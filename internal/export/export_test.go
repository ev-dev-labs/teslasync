package export

import (
	"context"
	"testing"
)

func TestJobStatusConstants(t *testing.T) {
	tests := []struct {
		status JobStatus
		want   string
	}{
		{StatusQueued, "queued"},
		{StatusProcessing, "processing"},
		{StatusReady, "ready"},
		{StatusFailed, "failed"},
	}
	for _, tt := range tests {
		if string(tt.status) != tt.want {
			t.Errorf("JobStatus %v = %q, want %q", tt.status, string(tt.status), tt.want)
		}
	}
}

func TestJobTypeConstants(t *testing.T) {
	tests := []struct {
		jobType JobType
		want    string
	}{
		{TypeDrives, "drives"},
		{TypeCharging, "charging"},
		{TypeBackup, "backup"},
		{TypeAnalytics, "analytics"},
		{TypeImportDrives, "import_drives"},
		{TypeImportCharging, "import_charging"},
	}
	for _, tt := range tests {
		if string(tt.jobType) != tt.want {
			t.Errorf("JobType %v = %q, want %q", tt.jobType, string(tt.jobType), tt.want)
		}
	}
}

func TestTopicConstants(t *testing.T) {
	if InternalTopic != "teslasync/internal/exports" {
		t.Errorf("InternalTopic = %q, want %q", InternalTopic, "teslasync/internal/exports")
	}
	if StatusTopic != "teslasync/events/export.status" {
		t.Errorf("StatusTopic = %q, want %q", StatusTopic, "teslasync/events/export.status")
	}
}

func TestComputeStats_Empty(t *testing.T) {
	result := computeStats(nil)
	if result["count"].(int) != 0 {
		t.Errorf("computeStats(nil) count = %d, want 0", result["count"])
	}
}

func TestComputeStats_Values(t *testing.T) {
	vals := []float64{10, 20, 30, 40, 50, 60, 70, 80, 90, 100}
	result := computeStats(vals)

	if result["count"].(int) != 10 {
		t.Errorf("count = %d, want 10", result["count"])
	}
	if result["min"].(float64) != 10.0 {
		t.Errorf("min = %f, want 10", result["min"])
	}
	if result["max"].(float64) != 100.0 {
		t.Errorf("max = %f, want 100", result["max"])
	}
	avg := result["avg"].(float64)
	if avg != 55.0 {
		t.Errorf("avg = %f, want 55", avg)
	}
}

func TestComputeStats_SingleValue(t *testing.T) {
	result := computeStats([]float64{42.5})
	if result["count"].(int) != 1 {
		t.Errorf("count = %d, want 1", result["count"])
	}
	if result["min"].(float64) != 42.5 {
		t.Errorf("min = %f, want 42.5", result["min"])
	}
}

func TestMapToSlice(t *testing.T) {
	m := map[string]int{"Home/AC": 10, "Supercharger": 5, "CCS": 3}
	result := mapToSlice(m, "type", "count")

	if len(result) != 3 {
		t.Fatalf("len = %d, want 3", len(result))
	}
	// Should be sorted by count descending
	if result[0]["count"].(int) != 10 {
		t.Errorf("first entry count = %d, want 10", result[0]["count"])
	}
}

func TestMapToSlice_Empty(t *testing.T) {
	result := mapToSlice(map[string]int{}, "key", "val")
	if len(result) != 0 {
		t.Errorf("len = %d, want 0", len(result))
	}
}

func TestPublish_NilClient(t *testing.T) {
	err := Publish(nil, nil)
	if err == nil {
		t.Error("expected error for nil MQTT client, got nil")
	}
}

func TestNewWorker_NilDB(t *testing.T) {
	// Should not panic with nil db
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("NewWorker panicked with nil db: %v", r)
		}
	}()
	_ = NewWorker(nil)
}

func TestWorker_Start_NilClient(t *testing.T) {
	// Start with nil MQTT client should return immediately
	w := &Worker{}
	w.Start(context.TODO(), nil)
	// No panic = success
}
