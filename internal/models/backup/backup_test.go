package backup

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// strptr / i64ptr are small helpers so table rows can express optional
// pointer fields inline without a named local per case.
func strptr(s string) *string { return &s }
func i64ptr(v int64) *int64   { return &v }

func TestIsValidBackupType(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want bool
	}{
		{"full", BackupTypeFull, true},
		{"incremental", BackupTypeIncremental, true},
		{"empty", "", false},
		{"unknown", "differential", false},
		{"case sensitive", "Full", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsValidBackupType(tt.in); got != tt.want {
				t.Errorf("IsValidBackupType(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestIsValidProvider(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want bool
	}{
		{"local", ProviderLocal, true},
		{"s3", ProviderS3, true},
		{"azure", ProviderAzure, true},
		{"gcs", ProviderGCS, true},
		{"onedrive", ProviderOneDrive, true},
		{"empty", "", false},
		{"unknown", "dropbox", false},
		{"case sensitive", "S3", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsValidProvider(tt.in); got != tt.want {
				t.Errorf("IsValidProvider(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestIsValidRunType(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{RunTypeBackup, true},
		{RunTypeRestore, true},
		{"", false},
		{"snapshot", false},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			if got := IsValidRunType(tt.in); got != tt.want {
				t.Errorf("IsValidRunType(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestIsValidStatus(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{StatusQueued, true},
		{StatusRunning, true},
		{StatusCompleted, true},
		{StatusPartial, true},
		{StatusFailed, true},
		{StatusVerifyFailed, true},
		{StatusCancelled, true},
		{"", false},
		{"success", false}, // the literal that the LatestSuccessful bug used
		{"done", false},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			if got := IsValidStatus(tt.in); got != tt.want {
				t.Errorf("IsValidStatus(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestBackupConfig_Validate(t *testing.T) {
	base := func() *BackupConfig {
		return &BackupConfig{
			Name:          "Nightly",
			BackupType:    BackupTypeFull,
			Provider:      ProviderLocal,
			FrequencyDays: 1,
			MaxRetention:  5,
		}
	}
	tests := []struct {
		name    string
		mutate  func(*BackupConfig)
		wantErr bool
		errHas  string
	}{
		{"valid full/local", func(*BackupConfig) {}, false, ""},
		{"valid incremental/s3", func(c *BackupConfig) {
			c.BackupType = BackupTypeIncremental
			c.Provider = ProviderS3
		}, false, ""},
		{"valid boundary freq 30 retention 1", func(c *BackupConfig) {
			c.FrequencyDays = 30
			c.MaxRetention = 1
		}, false, ""},
		{"empty name", func(c *BackupConfig) { c.Name = "" }, true, "name"},
		{"whitespace name", func(c *BackupConfig) { c.Name = "   " }, true, "name"},
		{"unknown backup_type", func(c *BackupConfig) { c.BackupType = "diff" }, true, "backup_type"},
		{"empty backup_type", func(c *BackupConfig) { c.BackupType = "" }, true, "backup_type"},
		{"unknown provider", func(c *BackupConfig) { c.Provider = "dropbox" }, true, "provider"},
		{"freq below min", func(c *BackupConfig) { c.FrequencyDays = 0 }, true, "frequency_days"},
		{"freq negative", func(c *BackupConfig) { c.FrequencyDays = -3 }, true, "frequency_days"},
		{"freq above max", func(c *BackupConfig) { c.FrequencyDays = 31 }, true, "frequency_days"},
		{"retention below min", func(c *BackupConfig) { c.MaxRetention = 0 }, true, "max_retention"},
		{"retention negative", func(c *BackupConfig) { c.MaxRetention = -1 }, true, "max_retention"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := base()
			tt.mutate(c)
			err := c.Validate()
			if tt.wantErr && err == nil {
				t.Fatalf("Validate() = nil, want error containing %q", tt.errHas)
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("Validate() = %v, want nil", err)
			}
			if tt.wantErr && !strings.Contains(err.Error(), tt.errHas) {
				t.Errorf("Validate() error = %q, want substring %q", err.Error(), tt.errHas)
			}
		})
	}
}

func TestBackupConfig_Validate_NilReceiver(t *testing.T) {
	var c *BackupConfig
	if err := c.Validate(); err == nil {
		t.Fatal("Validate() on nil receiver = nil, want error")
	}
}

func TestBackupConfig_Normalize(t *testing.T) {
	tests := []struct {
		name          string
		freqIn        int
		freqWant      int
		retentionIn   int
		retentionWant int
	}{
		{"freq below min clamps up", 0, 1, 10, 10},
		{"freq negative clamps up", -7, 1, 10, 10},
		{"freq above max clamps down", 31, 30, 10, 10},
		{"freq in range unchanged", 15, 15, 10, 10},
		{"retention below min uses default", 5, 5, 0, DefaultRetention},
		{"retention negative uses default", 5, 5, -4, DefaultRetention},
		{"retention above max clamps down", 5, 5, 101, MaxRetentionLimit},
		{"retention in range unchanged", 5, 5, 50, 50},
		{"both out of range", 99, 30, 999, MaxRetentionLimit},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &BackupConfig{FrequencyDays: tt.freqIn, MaxRetention: tt.retentionIn}
			c.Normalize()
			if c.FrequencyDays != tt.freqWant {
				t.Errorf("FrequencyDays = %d, want %d", c.FrequencyDays, tt.freqWant)
			}
			if c.MaxRetention != tt.retentionWant {
				t.Errorf("MaxRetention = %d, want %d", c.MaxRetention, tt.retentionWant)
			}
		})
	}
}

// TestBackupConfig_Normalize_ThenValidate pins the contract that a config
// with any numeric bounds survives Normalize into a state Validate accepts,
// provided the string fields are already well-formed.
func TestBackupConfig_Normalize_ThenValidate(t *testing.T) {
	for _, freq := range []int{-5, 0, 1, 15, 30, 44} {
		for _, ret := range []int{-2, 0, 1, 50, 100, 250} {
			c := &BackupConfig{
				Name:          "x",
				BackupType:    BackupTypeFull,
				Provider:      ProviderLocal,
				FrequencyDays: freq,
				MaxRetention:  ret,
			}
			c.Normalize()
			if err := c.Validate(); err != nil {
				t.Errorf("after Normalize(freq=%d,ret=%d): Validate() = %v", freq, ret, err)
			}
		}
	}
}

func TestBackupConfig_Normalize_NilReceiver(t *testing.T) {
	var c *BackupConfig
	c.Normalize() // must not panic
}

func TestBackupConfig_ApplyDefaults(t *testing.T) {
	tests := []struct {
		name        string
		in          BackupConfig
		wantType    string
		wantProv    string
		wantCfgJSON string
	}{
		{
			name:        "all empty gets defaults",
			in:          BackupConfig{},
			wantType:    BackupTypeFull,
			wantProv:    ProviderLocal,
			wantCfgJSON: `{}`,
		},
		{
			name:        "nil provider config becomes empty object",
			in:          BackupConfig{BackupType: BackupTypeIncremental, Provider: ProviderS3},
			wantType:    BackupTypeIncremental,
			wantProv:    ProviderS3,
			wantCfgJSON: `{}`,
		},
		{
			name:        "empty (non-nil) provider config becomes empty object",
			in:          BackupConfig{ProviderConfig: json.RawMessage{}},
			wantType:    BackupTypeFull,
			wantProv:    ProviderLocal,
			wantCfgJSON: `{}`,
		},
		{
			name:        "existing values preserved",
			in:          BackupConfig{BackupType: BackupTypeIncremental, Provider: ProviderAzure, ProviderConfig: json.RawMessage(`{"a":1}`)},
			wantType:    BackupTypeIncremental,
			wantProv:    ProviderAzure,
			wantCfgJSON: `{"a":1}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := tt.in
			c.ApplyDefaults()
			if c.BackupType != tt.wantType {
				t.Errorf("BackupType = %q, want %q", c.BackupType, tt.wantType)
			}
			if c.Provider != tt.wantProv {
				t.Errorf("Provider = %q, want %q", c.Provider, tt.wantProv)
			}
			if string(c.ProviderConfig) != tt.wantCfgJSON {
				t.Errorf("ProviderConfig = %q, want %q", string(c.ProviderConfig), tt.wantCfgJSON)
			}
		})
	}
}

func TestBackupConfig_ApplyDefaults_NilReceiver(t *testing.T) {
	var c *BackupConfig
	c.ApplyDefaults() // must not panic
}

func TestBackupConfig_EffectiveTables(t *testing.T) {
	defaults := []string{"vehicles", "drives"}
	tests := []struct {
		name string
		cfg  *BackupConfig
		want []string
	}{
		{"nil include uses defaults", &BackupConfig{}, defaults},
		{"empty include uses defaults", &BackupConfig{IncludeTables: []string{}}, defaults},
		{"explicit include wins", &BackupConfig{IncludeTables: []string{"charging_sessions"}}, []string{"charging_sessions"}},
		{"nil receiver uses defaults", nil, defaults},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.cfg.EffectiveTables(defaults)
			if len(got) != len(tt.want) {
				t.Fatalf("EffectiveTables() len = %d, want %d (%v)", len(got), len(tt.want), got)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("EffectiveTables()[%d] = %q, want %q", i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestBackupRun_TypePredicates(t *testing.T) {
	tests := []struct {
		name       string
		run        *BackupRun
		wantBackup bool
		wantRestor bool
	}{
		{"backup", &BackupRun{RunType: RunTypeBackup}, true, false},
		{"restore", &BackupRun{RunType: RunTypeRestore}, false, true},
		{"unknown", &BackupRun{RunType: "sync"}, false, false},
		{"empty", &BackupRun{}, false, false},
		{"nil", nil, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.run.IsBackup(); got != tt.wantBackup {
				t.Errorf("IsBackup() = %v, want %v", got, tt.wantBackup)
			}
			if got := tt.run.IsRestore(); got != tt.wantRestor {
				t.Errorf("IsRestore() = %v, want %v", got, tt.wantRestor)
			}
		})
	}
}

func TestBackupRun_StatusPredicates(t *testing.T) {
	tests := []struct {
		status       string
		wantActive   bool
		wantTerminal bool
		wantSuccess  bool
	}{
		{StatusQueued, true, false, false},
		{StatusRunning, true, false, false},
		{StatusCompleted, false, true, true},
		{StatusPartial, false, true, false},
		{StatusFailed, false, true, false},
		{StatusVerifyFailed, false, true, false},
		{StatusCancelled, false, true, false},
		{"garbage", false, false, false}, // unknown: neither active nor terminal
		{"", false, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			r := &BackupRun{Status: tt.status}
			if got := r.IsActive(); got != tt.wantActive {
				t.Errorf("IsActive(%q) = %v, want %v", tt.status, got, tt.wantActive)
			}
			if got := r.IsTerminal(); got != tt.wantTerminal {
				t.Errorf("IsTerminal(%q) = %v, want %v", tt.status, got, tt.wantTerminal)
			}
			if got := r.IsSuccessful(); got != tt.wantSuccess {
				t.Errorf("IsSuccessful(%q) = %v, want %v", tt.status, got, tt.wantSuccess)
			}
		})
	}
}

func TestBackupRun_StatusPredicates_NilReceiver(t *testing.T) {
	var r *BackupRun
	if r.IsActive() {
		t.Error("IsActive() on nil = true, want false")
	}
	if r.IsTerminal() {
		t.Error("IsTerminal() on nil = true, want false")
	}
	if r.IsSuccessful() {
		t.Error("IsSuccessful() on nil = true, want false")
	}
}

func TestBackupRun_HasArtifact(t *testing.T) {
	tests := []struct {
		name string
		run  *BackupRun
		want bool
	}{
		{"nil file path", &BackupRun{}, false},
		{"empty file path", &BackupRun{FilePath: strptr("")}, false},
		{"set file path", &BackupRun{FilePath: strptr("backups/x.json")}, true},
		{"nil receiver", nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.run.HasArtifact(); got != tt.want {
				t.Errorf("HasArtifact() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestBackupRun_CanVerify(t *testing.T) {
	tests := []struct {
		name string
		run  *BackupRun
		want bool
	}{
		{"path and checksum", &BackupRun{FilePath: strptr("p"), Checksum: strptr("abc")}, true},
		{"path but no checksum", &BackupRun{FilePath: strptr("p")}, false},
		{"path but empty checksum", &BackupRun{FilePath: strptr("p"), Checksum: strptr("")}, false},
		{"checksum but no path", &BackupRun{Checksum: strptr("abc")}, false},
		{"empty path with checksum", &BackupRun{FilePath: strptr(""), Checksum: strptr("abc")}, false},
		{"neither", &BackupRun{}, false},
		{"nil receiver", nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.run.CanVerify(); got != tt.want {
				t.Errorf("CanVerify() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestBackupRun_Duration(t *testing.T) {
	tests := []struct {
		name string
		run  *BackupRun
		want time.Duration
	}{
		{"zero", &BackupRun{DurationMs: 0}, 0},
		{"negative clamps to zero", &BackupRun{DurationMs: -100}, 0},
		{"one second", &BackupRun{DurationMs: 1000}, time.Second},
		{"five and a half seconds", &BackupRun{DurationMs: 5500}, 5500 * time.Millisecond},
		{"nil receiver", nil, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.run.Duration(); got != tt.want {
				t.Errorf("Duration() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestBackupConfig_JSONContract pins the wire shape that the frontend and
// pgx column mapping both depend on: snake_case keys, and omitempty behaviour
// for the optional scheduling/timestamp fields.
func TestBackupConfig_JSONContract(t *testing.T) {
	full := BackupConfig{
		ID:             7,
		Name:           "Nightly",
		Enabled:        true,
		BackupType:     BackupTypeFull,
		FrequencyDays:  3,
		MaxRetention:   10,
		Provider:       ProviderS3,
		ProviderConfig: json.RawMessage(`{"bucket":"b"}`),
		IncludeTables:  []string{"vehicles"},
	}
	raw, err := json.Marshal(full)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("Unmarshal to map: %v", err)
	}
	for _, key := range []string{
		"id", "name", "enabled", "backup_type", "frequency_days", "max_retention",
		"provider", "provider_config", "include_tables", "compress", "encrypt",
		"created_at", "updated_at",
	} {
		if _, ok := m[key]; !ok {
			t.Errorf("marshaled JSON missing expected key %q; got %s", key, raw)
		}
	}
	// Optional pointer fields must be omitted when unset.
	for _, key := range []string{"last_run_at", "next_run_at"} {
		if _, ok := m[key]; ok {
			t.Errorf("expected %q to be omitted when unset; got %s", key, raw)
		}
	}
	// A camelCase leak would break the snake_case contract the repo relies on.
	if _, ok := m["backupType"]; ok {
		t.Errorf("unexpected camelCase key backupType in %s", raw)
	}

	// Round-trip must preserve values.
	var back BackupConfig
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("round-trip Unmarshal: %v", err)
	}
	if back.ID != full.ID || back.Name != full.Name || back.Provider != full.Provider {
		t.Errorf("round-trip scalar mismatch: got %+v", back)
	}
	if back.BackupType != full.BackupType || back.FrequencyDays != full.FrequencyDays {
		t.Errorf("round-trip config mismatch: got %+v", back)
	}
	if string(back.ProviderConfig) != string(full.ProviderConfig) {
		t.Errorf("round-trip ProviderConfig = %s, want %s", back.ProviderConfig, full.ProviderConfig)
	}
	if len(back.IncludeTables) != 1 || back.IncludeTables[0] != "vehicles" {
		t.Errorf("round-trip IncludeTables = %v, want [vehicles]", back.IncludeTables)
	}
}

func TestBackupConfig_JSONContract_OmitsIncludeTablesWhenEmpty(t *testing.T) {
	raw, err := json.Marshal(BackupConfig{Name: "x"})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if _, ok := m["include_tables"]; ok {
		t.Errorf("include_tables should be omitted when nil; got %s", raw)
	}
}

// TestBackupRun_JSONContract pins the BackupRun wire shape: snake_case keys,
// omitempty for the nullable columns, and a lossless round-trip.
func TestBackupRun_JSONContract(t *testing.T) {
	run := BackupRun{
		ID:          42,
		ConfigID:    i64ptr(7),
		RunType:     RunTypeBackup,
		BackupType:  BackupTypeFull,
		Status:      StatusCompleted,
		Provider:    ProviderLocal,
		FileName:    strptr("teslasync-backup.json.gz"),
		FilePath:    strptr("backups/teslasync-backup.json.gz"),
		FileSize:    2048,
		RecordCount: 900,
		TableCount:  12,
		Checksum:    strptr("deadbeef"),
		DurationMs:  5000,
		Metadata:    json.RawMessage(`{"trigger":"manual"}`),
	}
	raw, err := json.Marshal(run)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("Unmarshal to map: %v", err)
	}
	for _, key := range []string{
		"id", "config_id", "run_type", "backup_type", "status", "provider",
		"file_name", "file_path", "file_size", "record_count", "table_count",
		"checksum", "duration_ms", "metadata", "created_at",
	} {
		if _, ok := m[key]; !ok {
			t.Errorf("marshaled JSON missing expected key %q; got %s", key, raw)
		}
	}

	var back BackupRun
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("round-trip Unmarshal: %v", err)
	}
	if back.ID != run.ID || back.Status != run.Status || back.Provider != run.Provider {
		t.Errorf("round-trip scalar mismatch: got %+v", back)
	}
	if back.ConfigID == nil || *back.ConfigID != 7 {
		t.Errorf("round-trip ConfigID = %v, want 7", back.ConfigID)
	}
	if back.Checksum == nil || *back.Checksum != "deadbeef" {
		t.Errorf("round-trip Checksum = %v, want deadbeef", back.Checksum)
	}
	// The round-tripped run must still classify identically.
	if !back.IsSuccessful() || !back.HasArtifact() || !back.CanVerify() {
		t.Errorf("round-trip predicates changed: success=%v artifact=%v canVerify=%v",
			back.IsSuccessful(), back.HasArtifact(), back.CanVerify())
	}
	if back.Duration() != 5*time.Second {
		t.Errorf("round-trip Duration() = %v, want 5s", back.Duration())
	}
}

func TestBackupRun_JSONContract_OmitsNullableFields(t *testing.T) {
	// A freshly-queued run has no artifact, checksum, timings, or config.
	raw, err := json.Marshal(BackupRun{RunType: RunTypeBackup, Status: StatusQueued})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	for _, key := range []string{
		"config_id", "file_name", "file_path", "checksum", "error_message",
		"metadata", "started_at", "completed_at",
	} {
		if _, ok := m[key]; ok {
			t.Errorf("expected %q to be omitted when unset; got %s", key, raw)
		}
	}
	// Non-omitempty numeric/status columns must still be present.
	for _, key := range []string{"status", "run_type", "file_size", "duration_ms"} {
		if _, ok := m[key]; !ok {
			t.Errorf("expected %q to be present; got %s", key, raw)
		}
	}
}
