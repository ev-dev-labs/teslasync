package ops

import (
	"strings"
	"testing"
	"testing/fstest"
)

func validRetentionFS() fstest.MapFS {
	return fstest.MapFS{
		RetentionPolicyPath: &fstest.MapFile{Data: []byte(`
version: 1
maximum_default_days: 3650
store:
  id: signal-log
  table: signal_log
  timestamp_column: ts
  environment_variable: SIGNAL_HISTORY_RETENTION_DAYS
  config_field: SignalHistoryRetentionDays
  helm_value: signalHistoryDays
  acknowledgement_environment_variable: SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED
  acknowledgement_config_field: SignalHistoryRetentionAcknowledged
  helm_acknowledgement_value: signalHistoryAcknowledged
  default_days: 365
  cleanup_method: Cleanup
  scheduler_method: initSignalHistoryCleanup
sources:
  go_config: config.go
  compose: compose.yaml
  helm_values: values.yaml
  helm_template: configmap.yaml
  cleanup: cleanup.go
  scheduler: scheduler.go
`)},
		"config.go": &fstest.MapFile{Data: []byte(`
Retention: RetentionConfig{
	SignalHistoryRetentionDays: envInt("SIGNAL_HISTORY_RETENTION_DAYS", 365),
	SignalHistoryRetentionAcknowledged: envBool("SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED", false),
}`)},
		"compose.yaml": &fstest.MapFile{Data: []byte(`
services:
  api:
    environment:
      - SIGNAL_HISTORY_RETENTION_DAYS=${SIGNAL_HISTORY_RETENTION_DAYS:-365}
      - SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED=${SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED:-false}
`)},
		"values.yaml": &fstest.MapFile{Data: []byte(`
retention:
  signalHistoryDays: 365
  signalHistoryAcknowledged: false
`)},
		"configmap.yaml": &fstest.MapFile{Data: []byte(`
  {{- if hasKey .Values.retention "signalHistoryDays" }}
  SIGNAL_HISTORY_RETENTION_DAYS: {{ .Values.retention.signalHistoryDays | quote }}
  {{- end }}
  {{- if hasKey .Values.retention "signalHistoryAcknowledged" }}
  SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED: {{ .Values.retention.signalHistoryAcknowledged | quote }}
  {{- end }}
`)},
		"cleanup.go": &fstest.MapFile{Data: []byte(`
const signalRetentionMaxWindowPerRun = 56 * 24 * time.Hour
func (w *SignalHistoryWriter) Cleanup(ctx context.Context, retentionDays int) {
	_ = time.Now().Add(signalRetentionMaxWindowPerRun)
	_, _ = w.db.Pool.Query(ctx, "SELECT drop_chunks('signal_log', older_than => $1::timestamptz)", retentionDays)
}
`)},
		"scheduler.go": &fstest.MapFile{Data: []byte(`
func start(a *App, ctx context.Context) {
	a.initSignalHistoryCleanup(ctx)
}
func (a *App) initSignalHistoryCleanup(ctx context.Context) {
days := a.Cfg.Retention.SignalHistoryRetentionDays
if !a.Cfg.Retention.SignalHistoryRetentionAcknowledged { return }
time.NewTicker(24 * time.Hour)
writer.Cleanup(ctx, days)
}
`)},
	}
}

func loadRetentionForTest(t *testing.T, fsys fstest.MapFS) *RetentionPolicy {
	t.Helper()
	policy, err := LoadRetentionPolicy(fsys, RetentionPolicyPath)
	if err != nil {
		t.Fatalf("LoadRetentionPolicy() error = %v", err)
	}
	return policy
}

func TestValidateRetention_AcceptsBoundedAlignedPolicy(t *testing.T) {
	fsys := validRetentionFS()
	if findings := ValidateRetention(fsys, loadRetentionForTest(t, fsys)); len(findings) != 0 {
		t.Fatalf("unexpected findings: %+v", findings)
	}
}

func TestValidateRetention_RejectsUnboundedOrDriftedSurfaces(t *testing.T) {
	tests := []struct {
		name string
		path string
		old  string
		new  string
		want string
	}{
		{
			name: "zero policy default", path: RetentionPolicyPath,
			old: "  default_days: 365", new: "  default_days: 0",
			want: "zero disables cleanup",
		},
		{
			name: "Go default drift", path: "config.go",
			old:  `envInt("SIGNAL_HISTORY_RETENTION_DAYS", 365)`,
			new:  `envInt("SIGNAL_HISTORY_RETENTION_DAYS", 30)`,
			want: "retention default is 30",
		},
		{
			name: "Compose default missing", path: "compose.yaml",
			old:  "SIGNAL_HISTORY_RETENTION_DAYS=${SIGNAL_HISTORY_RETENTION_DAYS:-365}",
			new:  "OTHER=value",
			want: "retention default is missing",
		},
		{
			name: "Go acknowledgement unsafe", path: "config.go",
			old:  `envBool("SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED", false)`,
			new:  `envBool("SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED", true)`,
			want: "acknowledgement default is true",
		},
		{
			name: "Compose acknowledgement missing", path: "compose.yaml",
			old:  "SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED=${SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED:-false}",
			new:  "OTHER_ACKNOWLEDGEMENT=false",
			want: "acknowledgement default is missing",
		},
		{
			name: "Helm acknowledgement unsafe", path: "values.yaml",
			old:  "signalHistoryAcknowledged: false",
			new:  "signalHistoryAcknowledged: true",
			want: "acknowledgement default is true",
		},
		{
			name: "Helm default drift", path: "values.yaml",
			old: "signalHistoryDays: 365", new: "signalHistoryDays: 90",
			want: "retention default is 90",
		},
		{
			name: "Helm rendering missing", path: "configmap.yaml",
			old: "SIGNAL_HISTORY_RETENTION_DAYS", new: "OTHER_RETENTION_DAYS",
			want: "must render SIGNAL_HISTORY_RETENTION_DAYS",
		},
		{
			name: "Helm zero override guard missing", path: "configmap.yaml",
			old: `if hasKey .Values.retention "signalHistoryDays"`, new: "if .Values.retention.signalHistoryDays",
			want: "must use hasKey",
		},
		{
			name: "Helm acknowledgement rendering missing", path: "configmap.yaml",
			old: "SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED", new: "OTHER_ACKNOWLEDGEMENT",
			want: "must render SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED",
		},
		{
			name: "wrong cleanup table", path: "cleanup.go",
			old: "drop_chunks('signal_log'", new: "drop_chunks('old_log'",
			want: "cleanup must drop complete TimescaleDB chunks from signal_log",
		},
		{
			name: "unparameterized cleanup", path: "cleanup.go",
			old: "$1::timestamptz", new: "'2026-01-01'::timestamptz",
			want: "must be parameterized",
		},
		{
			name: "unbounded initial cleanup", path: "cleanup.go",
			old: ".Add(signalRetentionMaxWindowPerRun)", new: ".Add(unboundedRetentionWindow)",
			want: "must bound chunk removal",
		},
		{
			name: "scheduler missing", path: "scheduler.go",
			old: "writer.Cleanup(ctx, days)", new: "writer.Noop(ctx, days)",
			want: "does not invoke Cleanup",
		},
		{
			name: "startup wiring missing", path: "scheduler.go",
			old: "a.initSignalHistoryCleanup(ctx)", new: "a.initOtherWorker(ctx)",
			want: "startup does not invoke initSignalHistoryCleanup",
		},
		{
			name: "acknowledgement gate missing", path: "scheduler.go",
			old:  "!a.Cfg.Retention.SignalHistoryRetentionAcknowledged",
			new:  "a.Cfg.Retention.SignalHistoryRetentionAcknowledged",
			want: "must require Retention.SignalHistoryRetentionAcknowledged",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fsys := validRetentionFS()
			file := fsys[tt.path]
			file.Data = []byte(strings.Replace(string(file.Data), tt.old, tt.new, 1))
			findings := ValidateRetention(fsys, loadRetentionForTest(t, fsys))
			if !hasMessage(findings, tt.want) {
				t.Fatalf("want finding containing %q, got %+v", tt.want, findings)
			}
		})
	}
}
