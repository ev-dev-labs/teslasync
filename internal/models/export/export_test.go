package export

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"
	"time"
)

// These DTOs are a wire contract: the async-export handler serialises them to
// the SPA and the export worker deserialises the request envelope from MQTT.
// A silent JSON-tag drift (rename, dropped omitempty, snake_case slip) breaks
// that contract without a compile error — exactly the class of bug this repo
// has been bitten by. The tests below pin the contract: exact key sets,
// omitempty semantics, round-trip fidelity, cross-DTO parity, and the SI
// unit-suffix ban from the active Phase-48 migration.

// ---- fixtures ----

var (
	refStart   = time.Date(2024, 3, 1, 0, 0, 0, 0, time.UTC)
	refEnd     = time.Date(2024, 3, 31, 23, 59, 59, 0, time.UTC)
	refCreated = time.Date(2024, 4, 1, 12, 30, 0, 0, time.UTC)
	refUpdated = time.Date(2024, 4, 1, 12, 35, 0, 0, time.UTC)
	refDone    = time.Date(2024, 4, 1, 12, 40, 15, 0, time.UTC)
)

func int64Ptr(v int64) *int64        { return &v }
func strPtr(v string) *string        { return &v }
func float64Ptr(v float64) *float64  { return &v }
func timePtr(v time.Time) *time.Time { return &v }

func ptrEq[T comparable](a, b *T) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func timePtrEq(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

// keySet marshals v and returns the set of top-level JSON object keys.
func keySet(t *testing.T, v any) map[string]json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal(%T) error: %v", v, err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("json.Unmarshal(%T) into map error: %v; raw=%s", v, err, b)
	}
	return m
}

func sortedKeys(m map[string]json.RawMessage) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func assertKeys(t *testing.T, v any, want []string) {
	t.Helper()
	got := sortedKeys(keySet(t, v))
	w := append([]string(nil), want...)
	sort.Strings(w)
	if strings.Join(got, ",") != strings.Join(w, ",") {
		t.Fatalf("JSON key set mismatch for %T:\n got:  %v\n want: %v", v, got, w)
	}
}

// ---- ExportJob: key contract ----

func TestExportJob_KeyContract(t *testing.T) {
	required := []string{"id", "type", "format", "status", "file_size", "record_count", "created_at", "updated_at"}
	optional := []string{"vehicle_id", "start_date", "end_date", "file_name", "error_message", "completed_at"}

	tests := []struct {
		name string
		job  ExportJob
		want []string
	}{
		{
			name: "zero value emits only required keys",
			job:  ExportJob{},
			want: required,
		},
		{
			name: "fully populated emits required + all optional keys",
			job: ExportJob{
				ID:           "exp-1",
				Type:         "drives",
				Format:       "csv",
				Status:       "ready",
				VehicleID:    int64Ptr(7),
				StartDate:    timePtr(refStart),
				EndDate:      timePtr(refEnd),
				FileName:     strPtr("teslasync-drives.csv"),
				FileSize:     2048,
				RecordCount:  120,
				ErrorMessage: strPtr(""),
				CreatedAt:    refCreated,
				UpdatedAt:    refUpdated,
				CompletedAt:  timePtr(refDone),
			},
			want: append(append([]string{}, required...), optional...),
		},
		{
			name: "partial optionals only surface the set ones",
			job: ExportJob{
				ID:        "exp-2",
				Type:      "charging",
				Format:    "json",
				Status:    "queued",
				VehicleID: int64Ptr(3),
				CreatedAt: refCreated,
				UpdatedAt: refUpdated,
			},
			want: append(append([]string{}, required...), "vehicle_id"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assertKeys(t, tt.job, tt.want)
		})
	}
}

// TestExportJob_OmitEmpty pins per-field omitempty behaviour: each optional
// pointer key must vanish when nil and appear when set. Non-omitempty scalar
// keys (file_size, record_count) must persist even at their zero value.
func TestExportJob_OmitEmpty(t *testing.T) {
	tests := []struct {
		name    string
		key     string
		set     func(*ExportJob)
		omitted bool // true => key absent when the field is left at zero/nil
	}{
		{"vehicle_id omitted when nil", "vehicle_id", func(j *ExportJob) { j.VehicleID = int64Ptr(1) }, true},
		{"start_date omitted when nil", "start_date", func(j *ExportJob) { j.StartDate = timePtr(refStart) }, true},
		{"end_date omitted when nil", "end_date", func(j *ExportJob) { j.EndDate = timePtr(refEnd) }, true},
		{"file_name omitted when nil", "file_name", func(j *ExportJob) { j.FileName = strPtr("f.csv") }, true},
		{"error_message omitted when nil", "error_message", func(j *ExportJob) { j.ErrorMessage = strPtr("boom") }, true},
		{"completed_at omitted when nil", "completed_at", func(j *ExportJob) { j.CompletedAt = timePtr(refDone) }, true},
		{"file_size present at zero", "file_size", func(j *ExportJob) { j.FileSize = 99 }, false},
		{"record_count present at zero", "record_count", func(j *ExportJob) { j.RecordCount = 5 }, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Absent/present at the zero value.
			base := keySet(t, ExportJob{})
			if _, ok := base[tt.key]; ok == tt.omitted {
				if tt.omitted {
					t.Fatalf("key %q must be omitted at zero value but was present", tt.key)
				}
				t.Fatalf("key %q must be present at zero value but was omitted", tt.key)
			}
			// Always present once explicitly set.
			var j ExportJob
			tt.set(&j)
			if _, ok := keySet(t, j)[tt.key]; !ok {
				t.Fatalf("key %q must be present once set", tt.key)
			}
		})
	}
}

func TestExportJob_RoundTrip(t *testing.T) {
	tests := []struct {
		name string
		job  ExportJob
	}{
		{"empty", ExportJob{}},
		{
			name: "full",
			job: ExportJob{
				ID:           "exp-full",
				Type:         "analytics",
				Format:       "json",
				Status:       "ready",
				VehicleID:    int64Ptr(42),
				StartDate:    timePtr(refStart),
				EndDate:      timePtr(refEnd),
				FileName:     strPtr("out.json"),
				FileSize:     1 << 40,
				RecordCount:  1000000,
				ErrorMessage: strPtr("partial failure: 3 rows skipped"),
				CreatedAt:    refCreated,
				UpdatedAt:    refUpdated,
				CompletedAt:  timePtr(refDone),
			},
		},
		{
			name: "boundary and unicode",
			job: ExportJob{
				ID:          "exp-⚡-Ünïcödé",
				Type:        "backup",
				Format:      "zip",
				Status:      "failed",
				VehicleID:   int64Ptr(-1),
				FileSize:    -1,
				RecordCount: 0,
				CreatedAt:   refCreated,
				UpdatedAt:   refUpdated,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b, err := json.Marshal(tt.job)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var got ExportJob
			if err := json.Unmarshal(b, &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if field, ok := exportJobEqual(tt.job, got); !ok {
				t.Fatalf("field %s not preserved through round-trip\n in:  %+v\n out: %+v", field, tt.job, got)
			}
			// Re-marshalling the decoded value must be byte-stable — proves no
			// field is silently lost or reshaped by the round-trip.
			b2, err := json.Marshal(got)
			if err != nil {
				t.Fatalf("re-marshal: %v", err)
			}
			if string(b) != string(b2) {
				t.Fatalf("round-trip not byte-stable:\n first:  %s\n second: %s", b, b2)
			}
		})
	}
}

func exportJobEqual(a, b ExportJob) (string, bool) {
	switch {
	case a.ID != b.ID:
		return "ID", false
	case a.Type != b.Type:
		return "Type", false
	case a.Format != b.Format:
		return "Format", false
	case a.Status != b.Status:
		return "Status", false
	case !ptrEq(a.VehicleID, b.VehicleID):
		return "VehicleID", false
	case !timePtrEq(a.StartDate, b.StartDate):
		return "StartDate", false
	case !timePtrEq(a.EndDate, b.EndDate):
		return "EndDate", false
	case !ptrEq(a.FileName, b.FileName):
		return "FileName", false
	case a.FileSize != b.FileSize:
		return "FileSize", false
	case a.RecordCount != b.RecordCount:
		return "RecordCount", false
	case !ptrEq(a.ErrorMessage, b.ErrorMessage):
		return "ErrorMessage", false
	case !a.CreatedAt.Equal(b.CreatedAt):
		return "CreatedAt", false
	case !a.UpdatedAt.Equal(b.UpdatedAt):
		return "UpdatedAt", false
	case !timePtrEq(a.CompletedAt, b.CompletedAt):
		return "CompletedAt", false
	}
	return "", true
}

// ---- ExportJobSummary: key contract ----

func TestExportJobSummary_KeyContract(t *testing.T) {
	required := []string{"id", "type", "format", "status", "file_size", "record_count", "created_at"}
	optional := []string{"vehicle_id", "file_name", "error_message", "duration_ms", "completed_at"}

	tests := []struct {
		name    string
		summary ExportJobSummary
		want    []string
	}{
		{
			name:    "zero value emits only required keys",
			summary: ExportJobSummary{},
			want:    required,
		},
		{
			name: "fully populated emits required + all optional keys",
			summary: ExportJobSummary{
				ID:           "exp-1",
				Type:         "drives",
				Format:       "csv",
				Status:       "ready",
				VehicleID:    int64Ptr(7),
				FileName:     strPtr("out.csv"),
				FileSize:     2048,
				RecordCount:  120,
				ErrorMessage: strPtr("warn"),
				DurationMs:   float64Ptr(1523.4),
				CreatedAt:    refCreated,
				CompletedAt:  timePtr(refDone),
			},
			want: append(append([]string{}, required...), optional...),
		},
		{
			name: "duration_ms omitted while running",
			summary: ExportJobSummary{
				ID:        "exp-run",
				Type:      "trips",
				Format:    "csv",
				Status:    "processing",
				CreatedAt: refCreated,
			},
			want: required,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assertKeys(t, tt.summary, tt.want)
		})
	}
}

func TestExportJobSummary_OmitEmpty(t *testing.T) {
	tests := []struct {
		name string
		key  string
		set  func(*ExportJobSummary)
	}{
		{"vehicle_id", "vehicle_id", func(s *ExportJobSummary) { s.VehicleID = int64Ptr(1) }},
		{"file_name", "file_name", func(s *ExportJobSummary) { s.FileName = strPtr("f.csv") }},
		{"error_message", "error_message", func(s *ExportJobSummary) { s.ErrorMessage = strPtr("e") }},
		{"duration_ms", "duration_ms", func(s *ExportJobSummary) { s.DurationMs = float64Ptr(1.5) }},
		{"completed_at", "completed_at", func(s *ExportJobSummary) { s.CompletedAt = timePtr(refDone) }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, ok := keySet(t, ExportJobSummary{})[tt.key]; ok {
				t.Fatalf("optional key %q must be omitted at zero value", tt.key)
			}
			var s ExportJobSummary
			tt.set(&s)
			if _, ok := keySet(t, s)[tt.key]; !ok {
				t.Fatalf("optional key %q must be present once set", tt.key)
			}
		})
	}
}

// TestExportJobSummary_DurationMsZeroSerialised guards a subtle omitempty edge:
// a *float64 pointing at 0.0 is non-nil, so duration_ms must serialise as 0
// (a job that completed instantly) rather than being dropped.
func TestExportJobSummary_DurationMsZeroSerialised(t *testing.T) {
	s := ExportJobSummary{DurationMs: float64Ptr(0)}
	m := keySet(t, s)
	raw, ok := m["duration_ms"]
	if !ok {
		t.Fatal("duration_ms must be present when the pointer is non-nil, even at 0.0")
	}
	if string(raw) != "0" {
		t.Fatalf("duration_ms = %s, want 0", raw)
	}
}

func TestExportJobSummary_RoundTrip(t *testing.T) {
	tests := []struct {
		name    string
		summary ExportJobSummary
	}{
		{"empty", ExportJobSummary{}},
		{
			name: "full",
			summary: ExportJobSummary{
				ID:           "sum-full",
				Type:         "charging",
				Format:       "json",
				Status:       "ready",
				VehicleID:    int64Ptr(9),
				FileName:     strPtr("c.json"),
				FileSize:     4096,
				RecordCount:  77,
				ErrorMessage: strPtr("none"),
				DurationMs:   float64Ptr(42.125),
				CreatedAt:    refCreated,
				CompletedAt:  timePtr(refDone),
			},
		},
		{
			name: "running job without completion or duration",
			summary: ExportJobSummary{
				ID:        "sum-run",
				Type:      "backup",
				Format:    "json",
				Status:    "processing",
				CreatedAt: refCreated,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b, err := json.Marshal(tt.summary)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var got ExportJobSummary
			if err := json.Unmarshal(b, &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if field, ok := exportSummaryEqual(tt.summary, got); !ok {
				t.Fatalf("field %s not preserved\n in:  %+v\n out: %+v", field, tt.summary, got)
			}
			b2, err := json.Marshal(got)
			if err != nil {
				t.Fatalf("re-marshal: %v", err)
			}
			if string(b) != string(b2) {
				t.Fatalf("round-trip not byte-stable:\n first:  %s\n second: %s", b, b2)
			}
		})
	}
}

func exportSummaryEqual(a, b ExportJobSummary) (string, bool) {
	switch {
	case a.ID != b.ID:
		return "ID", false
	case a.Type != b.Type:
		return "Type", false
	case a.Format != b.Format:
		return "Format", false
	case a.Status != b.Status:
		return "Status", false
	case !ptrEq(a.VehicleID, b.VehicleID):
		return "VehicleID", false
	case !ptrEq(a.FileName, b.FileName):
		return "FileName", false
	case a.FileSize != b.FileSize:
		return "FileSize", false
	case a.RecordCount != b.RecordCount:
		return "RecordCount", false
	case !ptrEq(a.ErrorMessage, b.ErrorMessage):
		return "ErrorMessage", false
	case !ptrEq(a.DurationMs, b.DurationMs):
		return "DurationMs", false
	case !a.CreatedAt.Equal(b.CreatedAt):
		return "CreatedAt", false
	case !timePtrEq(a.CompletedAt, b.CompletedAt):
		return "CompletedAt", false
	}
	return "", true
}

// ---- ExportJobRequest: key contract ----

func TestExportJobRequest_KeyContract(t *testing.T) {
	required := []string{"job_id", "type", "format"}
	optional := []string{"vehicle_id", "start_date", "end_date"}

	tests := []struct {
		name string
		req  ExportJobRequest
		want []string
	}{
		{
			name: "minimal envelope emits only required keys",
			req: ExportJobRequest{
				JobID:  "exp-1",
				Type:   "drives",
				Format: "csv",
			},
			want: required,
		},
		{
			name: "scoped envelope carries vehicle and date range",
			req: ExportJobRequest{
				JobID:     "exp-2",
				Type:      "charging",
				Format:    "csv",
				VehicleID: int64Ptr(5),
				StartDate: timePtr(refStart),
				EndDate:   timePtr(refEnd),
			},
			want: append(append([]string{}, required...), optional...),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assertKeys(t, tt.req, tt.want)
		})
	}
}

// TestExportJobRequest_UsesJobIDNotID pins that the MQTT envelope keys the job
// on "job_id" (not "id" like the persisted ExportJob). The worker deserialises
// against this exact key; a slip to "id" would silently drop the job id.
func TestExportJobRequest_UsesJobIDNotID(t *testing.T) {
	m := keySet(t, ExportJobRequest{JobID: "exp-1", Type: "drives", Format: "csv"})
	if _, ok := m["job_id"]; !ok {
		t.Fatal("request envelope must expose job_id")
	}
	if _, ok := m["id"]; ok {
		t.Fatal("request envelope must NOT expose id (persistence-only key)")
	}
}

func TestExportJobRequest_RoundTrip(t *testing.T) {
	tests := []struct {
		name string
		req  ExportJobRequest
	}{
		{"minimal", ExportJobRequest{JobID: "r1", Type: "drives", Format: "csv"}},
		{
			name: "scoped",
			req: ExportJobRequest{
				JobID:     "r2",
				Type:      "account",
				Format:    "zip",
				VehicleID: int64Ptr(11),
				StartDate: timePtr(refStart),
				EndDate:   timePtr(refEnd),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b, err := json.Marshal(tt.req)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var got ExportJobRequest
			if err := json.Unmarshal(b, &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			switch {
			case got.JobID != tt.req.JobID:
				t.Errorf("JobID = %q, want %q", got.JobID, tt.req.JobID)
			case got.Type != tt.req.Type:
				t.Errorf("Type = %q, want %q", got.Type, tt.req.Type)
			case got.Format != tt.req.Format:
				t.Errorf("Format = %q, want %q", got.Format, tt.req.Format)
			case !ptrEq(got.VehicleID, tt.req.VehicleID):
				t.Errorf("VehicleID = %v, want %v", got.VehicleID, tt.req.VehicleID)
			case !timePtrEq(got.StartDate, tt.req.StartDate):
				t.Errorf("StartDate = %v, want %v", got.StartDate, tt.req.StartDate)
			case !timePtrEq(got.EndDate, tt.req.EndDate):
				t.Errorf("EndDate = %v, want %v", got.EndDate, tt.req.EndDate)
			}
		})
	}
}

// TestExportJobRequest_DecodeFromWorkerPayload proves the worker can decode a
// realistic MQTT payload (snake_case, RFC3339 dates) into the envelope. This is
// the actual ingress path from export.PublishCtx → worker subscriber.
func TestExportJobRequest_DecodeFromWorkerPayload(t *testing.T) {
	payload := `{
		"job_id": "exp-1700000000",
		"type": "drives",
		"format": "csv",
		"vehicle_id": 3,
		"start_date": "2024-03-01T00:00:00Z",
		"end_date": "2024-03-31T23:59:59Z"
	}`

	var req ExportJobRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		t.Fatalf("unmarshal worker payload: %v", err)
	}
	if req.JobID != "exp-1700000000" {
		t.Errorf("JobID = %q, want exp-1700000000", req.JobID)
	}
	if req.VehicleID == nil || *req.VehicleID != 3 {
		t.Errorf("VehicleID = %v, want 3", req.VehicleID)
	}
	if req.StartDate == nil || !req.StartDate.Equal(refStart) {
		t.Errorf("StartDate = %v, want %v", req.StartDate, refStart)
	}
	if req.EndDate == nil || !req.EndDate.Equal(refEnd) {
		t.Errorf("EndDate = %v, want %v", req.EndDate, refEnd)
	}
}

// ---- cross-DTO invariants ----

// TestExport_SummaryProjectionParity pins that every field the GetJob handler
// projects from ExportJob into ExportJobSummary uses an identical JSON key on
// both structs. If a tag drifts on one but not the other, the SPA sees two
// different shapes for the same job depending on the endpoint.
func TestExport_SummaryProjectionParity(t *testing.T) {
	shared := []string{
		"id", "type", "format", "status", "vehicle_id",
		"file_name", "file_size", "record_count", "error_message",
		"created_at", "completed_at",
	}

	job := ExportJob{
		ID: "x", Type: "t", Format: "f", Status: "s",
		VehicleID: int64Ptr(1), FileName: strPtr("n"), FileSize: 1,
		RecordCount: 1, ErrorMessage: strPtr("e"),
		CreatedAt: refCreated, CompletedAt: timePtr(refDone),
	}
	summary := ExportJobSummary{
		ID: "x", Type: "t", Format: "f", Status: "s",
		VehicleID: int64Ptr(1), FileName: strPtr("n"), FileSize: 1,
		RecordCount: 1, ErrorMessage: strPtr("e"),
		CreatedAt: refCreated, CompletedAt: timePtr(refDone),
	}

	jobKeys := keySet(t, job)
	sumKeys := keySet(t, summary)
	for _, k := range shared {
		if _, ok := jobKeys[k]; !ok {
			t.Errorf("ExportJob missing shared key %q", k)
		}
		if _, ok := sumKeys[k]; !ok {
			t.Errorf("ExportJobSummary missing shared key %q", k)
		}
	}
}

// TestExport_NoBannedUnitSuffix guards the Phase-48 SI-canonical migration: no
// JSON key on any export DTO may end in a legacy imperial/derived unit suffix.
// duration_ms (milliseconds) is intentionally allowed — it is not one of the
// banned suffixes and measures job wall-clock, not a vehicle signal.
func TestExport_NoBannedUnitSuffix(t *testing.T) {
	banned := []string{"_mi", "_min", "_mph", "_kwh", "_kw", "_psi"}

	dtos := []any{
		ExportJob{
			VehicleID: int64Ptr(1), StartDate: timePtr(refStart), EndDate: timePtr(refEnd),
			FileName: strPtr("f"), ErrorMessage: strPtr("e"), CompletedAt: timePtr(refDone),
		},
		ExportJobSummary{
			VehicleID: int64Ptr(1), FileName: strPtr("f"), ErrorMessage: strPtr("e"),
			DurationMs: float64Ptr(1), CompletedAt: timePtr(refDone),
		},
		ExportJobRequest{
			VehicleID: int64Ptr(1), StartDate: timePtr(refStart), EndDate: timePtr(refEnd),
		},
	}

	for _, dto := range dtos {
		for key := range keySet(t, dto) {
			for _, suf := range banned {
				if strings.HasSuffix(key, suf) {
					t.Errorf("%T exposes JSON key %q with banned unit suffix %q", dto, key, suf)
				}
			}
		}
	}
}
