package ops

import (
	"io/fs"
	"regexp"
	"strconv"
	"strings"
)

// RetentionPolicyPath is the canonical storage-retention contract.
const RetentionPolicyPath = "ops/retention/policy.yaml"

// RetentionPolicy ties the bounded default to every surface that enforces it.
type RetentionPolicy struct {
	Version            int              `yaml:"version"`
	MaximumDefaultDays int              `yaml:"maximum_default_days"`
	Store              RetentionStore   `yaml:"store"`
	Sources            RetentionSources `yaml:"sources"`
}

// RetentionStore identifies the active telemetry store and its configuration.
type RetentionStore struct {
	ID                                 string `yaml:"id"`
	Table                              string `yaml:"table"`
	TimestampColumn                    string `yaml:"timestamp_column"`
	EnvironmentVariable                string `yaml:"environment_variable"`
	ConfigField                        string `yaml:"config_field"`
	HelmValue                          string `yaml:"helm_value"`
	AcknowledgementEnvironmentVariable string `yaml:"acknowledgement_environment_variable"`
	AcknowledgementConfigField         string `yaml:"acknowledgement_config_field"`
	HelmAcknowledgementValue           string `yaml:"helm_acknowledgement_value"`
	DefaultDays                        int    `yaml:"default_days"`
	CleanupMethod                      string `yaml:"cleanup_method"`
	SchedulerMethod                    string `yaml:"scheduler_method"`
}

// RetentionSources are the implementation and deployment files the gate checks.
type RetentionSources struct {
	GoConfig     string `yaml:"go_config"`
	Compose      string `yaml:"compose"`
	HelmValues   string `yaml:"helm_values"`
	HelmTemplate string `yaml:"helm_template"`
	Cleanup      string `yaml:"cleanup"`
	Scheduler    string `yaml:"scheduler"`
}

var retentionIdentifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_-]*$`)

// LoadRetentionPolicy reads the declarative retention contract.
func LoadRetentionPolicy(fsys fs.FS, path string) (*RetentionPolicy, error) {
	var policy RetentionPolicy
	if err := loadYAML(fsys, path, &policy); err != nil {
		return nil, err
	}
	return &policy, nil
}

// ValidateRetention proves that the shipped retention window is bounded but
// destructive cleanup remains disabled until an operator explicitly
// acknowledges a recoverable backup.
func ValidateRetention(fsys fs.FS, policy *RetentionPolicy) []Finding {
	const check = "retention"
	var out []Finding

	if policy.Version != 1 {
		out = append(out, errf(check, RetentionPolicyPath, "unsupported version %d (want 1)", policy.Version))
	}
	if policy.MaximumDefaultDays <= 0 {
		out = append(out, errf(check, "maximum_default_days", "must be positive"))
	}
	if policy.Store.DefaultDays <= 0 {
		out = append(out, errf(check, "store.default_days", "must be positive; zero disables cleanup and permits unbounded growth"))
	} else if policy.MaximumDefaultDays > 0 && policy.Store.DefaultDays > policy.MaximumDefaultDays {
		out = append(out, errf(check, "store.default_days", "%d exceeds maximum_default_days %d", policy.Store.DefaultDays, policy.MaximumDefaultDays))
	}

	identifiers := map[string]string{
		"store.id":                                   policy.Store.ID,
		"store.table":                                policy.Store.Table,
		"store.timestamp_column":                     policy.Store.TimestampColumn,
		"store.environment_variable":                 policy.Store.EnvironmentVariable,
		"store.config_field":                         policy.Store.ConfigField,
		"store.helm_value":                           policy.Store.HelmValue,
		"store.acknowledgement_environment_variable": policy.Store.AcknowledgementEnvironmentVariable,
		"store.acknowledgement_config_field":         policy.Store.AcknowledgementConfigField,
		"store.helm_acknowledgement_value":           policy.Store.HelmAcknowledgementValue,
		"store.cleanup_method":                       policy.Store.CleanupMethod,
		"store.scheduler_method":                     policy.Store.SchedulerMethod,
	}
	for subject, value := range identifiers {
		if !retentionIdentifier.MatchString(value) {
			out = append(out, errf(check, subject, "%q is not a valid identifier", value))
		}
	}

	sourcePaths := map[string]string{
		"sources.go_config":     policy.Sources.GoConfig,
		"sources.compose":       policy.Sources.Compose,
		"sources.helm_values":   policy.Sources.HelmValues,
		"sources.helm_template": policy.Sources.HelmTemplate,
		"sources.cleanup":       policy.Sources.Cleanup,
		"sources.scheduler":     policy.Sources.Scheduler,
	}
	source := make(map[string]string, len(sourcePaths))
	for subject, path := range sourcePaths {
		if path == "" {
			out = append(out, errf(check, subject, "path is required"))
			continue
		}
		raw, err := fs.ReadFile(fsys, path)
		if err != nil {
			out = append(out, errf(check, subject, "read %s: %v", path, err))
			continue
		}
		source[subject] = string(raw)
	}
	if len(out) > 0 {
		return out
	}

	expectedDays := policy.Store.DefaultDays
	configPattern := regexp.MustCompile(
		regexp.QuoteMeta(policy.Store.ConfigField) + `\s*:\s*envInt\(\s*"` +
			regexp.QuoteMeta(policy.Store.EnvironmentVariable) + `"\s*,\s*([0-9]+)\s*\)`,
	)
	out = appendDefaultMismatch(out, policy.Sources.GoConfig, source["sources.go_config"], configPattern, expectedDays)
	goAcknowledgementPattern := regexp.MustCompile(
		regexp.QuoteMeta(policy.Store.AcknowledgementConfigField) + `\s*:\s*envBool\(\s*"` +
			regexp.QuoteMeta(policy.Store.AcknowledgementEnvironmentVariable) + `"\s*,\s*(true|false)\s*\)`,
	)
	out = appendAcknowledgementDefault(out, policy.Sources.GoConfig, source["sources.go_config"], goAcknowledgementPattern)

	composePattern := regexp.MustCompile(
		`(?m)^\s*-\s*` + regexp.QuoteMeta(policy.Store.EnvironmentVariable) +
			`=\$\{` + regexp.QuoteMeta(policy.Store.EnvironmentVariable) + `:-([0-9]+)\}\s*$`,
	)
	out = appendDefaultMismatch(out, policy.Sources.Compose, source["sources.compose"], composePattern, expectedDays)
	composeAcknowledgementPattern := regexp.MustCompile(
		`(?m)^\s*-\s*` + regexp.QuoteMeta(policy.Store.AcknowledgementEnvironmentVariable) +
			`=\$\{` + regexp.QuoteMeta(policy.Store.AcknowledgementEnvironmentVariable) + `:-(true|false)\}\s*$`,
	)
	out = appendAcknowledgementDefault(out, policy.Sources.Compose, source["sources.compose"], composeAcknowledgementPattern)

	helmValuePattern := regexp.MustCompile(
		`(?m)^\s{2}` + regexp.QuoteMeta(policy.Store.HelmValue) + `:\s*([0-9]+)\s*(?:#.*)?$`,
	)
	out = appendDefaultMismatch(out, policy.Sources.HelmValues, source["sources.helm_values"], helmValuePattern, expectedDays)
	helmAcknowledgementPattern := regexp.MustCompile(
		`(?m)^\s{2}` + regexp.QuoteMeta(policy.Store.HelmAcknowledgementValue) + `:\s*(true|false)\s*(?:#.*)?$`,
	)
	out = appendAcknowledgementDefault(out, policy.Sources.HelmValues, source["sources.helm_values"], helmAcknowledgementPattern)

	template := source["sources.helm_template"]
	helmPath := ".Values.retention." + policy.Store.HelmValue
	if !strings.Contains(template, policy.Store.EnvironmentVariable+":") || !strings.Contains(template, helmPath) {
		out = append(out, errf(check, policy.Sources.HelmTemplate,
			"must render %s from %s", policy.Store.EnvironmentVariable, helmPath))
	}
	helmGuard := `if hasKey .Values.retention "` + policy.Store.HelmValue + `"`
	if !strings.Contains(template, helmGuard) {
		out = append(out, errf(check, policy.Sources.HelmTemplate,
			"must use hasKey for %s so an explicit zero override is rendered", policy.Store.HelmValue))
	}
	acknowledgementHelmPath := ".Values.retention." + policy.Store.HelmAcknowledgementValue
	if !strings.Contains(template, policy.Store.AcknowledgementEnvironmentVariable+":") ||
		!strings.Contains(template, acknowledgementHelmPath) {
		out = append(out, errf(check, policy.Sources.HelmTemplate,
			"must render %s from %s", policy.Store.AcknowledgementEnvironmentVariable, acknowledgementHelmPath))
	}
	acknowledgementHelmGuard := `if hasKey .Values.retention "` + policy.Store.HelmAcknowledgementValue + `"`
	if !strings.Contains(template, acknowledgementHelmGuard) {
		out = append(out, errf(check, policy.Sources.HelmTemplate,
			"must use hasKey for %s so the safe false default is rendered", policy.Store.HelmAcknowledgementValue))
	}

	cleanup := source["sources.cleanup"]
	dropChunksCall := "drop_chunks('" + policy.Store.Table + "'"
	if !strings.Contains(cleanup, "func (w *SignalHistoryWriter) "+policy.Store.CleanupMethod+"(") {
		out = append(out, errf(check, policy.Sources.Cleanup, "cleanup method %s is missing", policy.Store.CleanupMethod))
	}
	if !strings.Contains(cleanup, dropChunksCall) {
		out = append(out, errf(check, policy.Sources.Cleanup,
			"cleanup must drop complete TimescaleDB chunks from %s", policy.Store.Table))
	}
	if !strings.Contains(cleanup, "$1::timestamptz") {
		out = append(out, errf(check, policy.Sources.Cleanup, "retention cutoff must be parameterized as $1::timestamptz"))
	}
	if !strings.Contains(cleanup, ".Add(signalRetentionMaxWindowPerRun)") {
		out = append(out, errf(check, policy.Sources.Cleanup, "initial cleanup must bound chunk removal per run"))
	}

	scheduler := source["sources.scheduler"]
	schedulerDeclaration := "func (a *App) " + policy.Store.SchedulerMethod + "("
	schedulerInvocation := "a." + policy.Store.SchedulerMethod + "(ctx)"
	if !strings.Contains(scheduler, schedulerDeclaration) {
		out = append(out, errf(check, policy.Sources.Scheduler, "scheduler method %s is missing", policy.Store.SchedulerMethod))
	}
	if !strings.Contains(scheduler, schedulerInvocation) {
		out = append(out, errf(check, policy.Sources.Scheduler, "startup does not invoke %s", policy.Store.SchedulerMethod))
	}
	if !strings.Contains(scheduler, "Cfg.Retention."+policy.Store.ConfigField) {
		out = append(out, errf(check, policy.Sources.Scheduler, "scheduler does not read Retention.%s", policy.Store.ConfigField))
	}
	if !strings.Contains(scheduler, "!a.Cfg.Retention."+policy.Store.AcknowledgementConfigField) {
		out = append(out, errf(check, policy.Sources.Scheduler,
			"scheduler must require Retention.%s before destructive cleanup", policy.Store.AcknowledgementConfigField))
	}
	if !strings.Contains(scheduler, "writer."+policy.Store.CleanupMethod+"(") {
		out = append(out, errf(check, policy.Sources.Scheduler, "scheduler does not invoke %s", policy.Store.CleanupMethod))
	}

	if !strings.Contains(scheduler, "time.NewTicker(24 * time.Hour)") {
		out = append(out, errf(check, policy.Sources.Scheduler, "cleanup must have a bounded recurring schedule"))
	}

	return out
}

func appendAcknowledgementDefault(out []Finding, path, source string, pattern *regexp.Regexp) []Finding {
	match := pattern.FindStringSubmatch(source)
	if len(match) != 2 {
		return append(out, errf("retention", path, "retention acknowledgement default is missing"))
	}
	if match[1] != "false" {
		return append(out, errf("retention", path,
			"retention acknowledgement default is %s, want false for upgrade safety", match[1]))
	}
	return out
}

func appendDefaultMismatch(out []Finding, path, source string, pattern *regexp.Regexp, expected int) []Finding {
	match := pattern.FindStringSubmatch(source)
	if len(match) != 2 {
		return append(out, errf("retention", path, "retention default is missing"))
	}
	got, err := strconv.Atoi(match[1])
	if err != nil {
		return append(out, errf("retention", path, "parse retention default %q: %v", match[1], err))
	}
	if got != expected {
		return append(out, errf("retention", path, "retention default is %d, want policy value %d", got, expected))
	}
	return out
}

// CheckRetention loads and validates the repository retention contract.
func CheckRetention(fsys fs.FS) []Finding {
	policy, err := LoadRetentionPolicy(fsys, RetentionPolicyPath)
	if err != nil {
		return []Finding{errf("retention", RetentionPolicyPath, "%v", err)}
	}
	return ValidateRetention(fsys, policy)
}
