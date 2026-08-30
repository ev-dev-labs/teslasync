package ops

import (
	"strings"
	"testing"
	"testing/fstest"
)

const configGoFixture = `
package config

func Load() (*Config, error) {
	return &Config{
		Port:     envInt("TESLASYNC_PORT", 4000),
		LogLevel: envStr("TESLASYNC_LOG_LEVEL", "info"),
		Enabled:  envBool("FEATURE_ENABLED", false),
		Timeout:  envDuration("REQUEST_TIMEOUT", 0),
		Ratio:    envFloat("SAMPLE_RATIO", 1),
		Ratio64:  envFloat64("DAILY_BUDGET", 0.3),
		Secret:   envStr("API_TOKEN", ""),
		// lowercase and non-literal calls must be ignored
		Other: envStr(someVar, ""),
	}, nil
}
`

const composeFixture = `
services:
  teslasync-api:
    image: ghcr.io/example/api
    environment:
      TESLASYNC_PORT: 8080
      TESLASYNC_LOG_LEVEL: ${LOG_LEVEL:-info}
      FEATURE_ENABLED: "true"
      REQUEST_TIMEOUT: 30s
      SAMPLE_RATIO: "1.0"
      API_TOKEN: ${API_TOKEN}
      TYPO_VAR: oops
  notification-worker:
    environment:
      - TESLASYNC_LOG_LEVEL=info
      - WORKER_ONLY=1
  postgres:
    image: timescale/timescaledb
    environment:
      POSTGRES_USER: teslasync
      POSTGRES_PASSWORD: changeme
volumes:
  data: {}
`

const configMapFixture = `
apiVersion: v1
kind: ConfigMap
data:
  TESLASYNC_PORT: {{ .Values.port | quote }}
  TESLASYNC_LOG_LEVEL: {{ .Values.logLevel | quote }}
  FEATURE_ENABLED: "true"
  {{- if .Values.timeout }}
  REQUEST_TIMEOUT: {{ .Values.timeout | quote }}
  {{- end }}
  SAMPLE_RATIO: "1.0"
`

const secretFixture = `
apiVersion: v1
kind: Secret
stringData:
  API_TOKEN: {{ .Values.apiToken | quote }}
`

func parityFS(overrides map[string]string) fstest.MapFS {
	files := map[string]string{
		"internal/config/config.go":               configGoFixture,
		"docker-compose.yml":                      composeFixture,
		"helm/teslasync/templates/configmap.yaml": configMapFixture,
		"helm/teslasync/templates/secret.yaml":    secretFixture,
		"internal/placeholder/placeholder.go":     "package placeholder\n",
	}
	for k, v := range overrides {
		files[k] = v
	}
	out := fstest.MapFS{}
	for name, body := range files {
		out[name] = &fstest.MapFile{Data: []byte(body)}
	}
	return out
}

func parityManifest() *ParityManifest {
	return &ParityManifest{
		Version: 1,
		Sources: ParitySources{
			GoConfig:      "internal/config/config.go",
			Compose:       "docker-compose.yml",
			HelmConfigMap: "helm/teslasync/templates/configmap.yaml",
			HelmSecret:    "helm/teslasync/templates/secret.yaml",
			GoScanDirs:    []string{"internal"},
		},
		ComposeServices: []string{"teslasync-api", "notification-worker"},
		SecretPatterns:  []string{"(^|_)(PASSWORD|SECRET|TOKEN)$"},
	}
}

func TestExtractGoEnvVars(t *testing.T) {
	got := ExtractGoEnvVars(configGoFixture)
	want := []string{"API_TOKEN", "DAILY_BUDGET", "FEATURE_ENABLED", "REQUEST_TIMEOUT", "SAMPLE_RATIO", "TESLASYNC_LOG_LEVEL", "TESLASYNC_PORT"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// TestExtractComposeEnvVars_BothFormsAndServiceScoping pins the two
// things that make this extractor non-trivial: docker-compose accepts
// both a mapping and a `KEY=value` list, and third-party services
// (postgres) must not pollute the comparison.
func TestExtractComposeEnvVars_BothFormsAndServiceScoping(t *testing.T) {
	got := ExtractComposeEnvVars(composeFixture, []string{"teslasync-api", "notification-worker"})
	joined := strings.Join(got, ",")

	for _, want := range []string{"TESLASYNC_PORT", "API_TOKEN", "WORKER_ONLY", "TYPO_VAR"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q from %v", want, got)
		}
	}
	for _, unwanted := range []string{"POSTGRES_USER", "POSTGRES_PASSWORD"} {
		if strings.Contains(joined, unwanted) {
			t.Errorf("third-party service variable %q leaked into the comparison", unwanted)
		}
	}
}

func TestExtractHelmEnvVars_HandlesTemplating(t *testing.T) {
	got := ExtractHelmEnvVars(configMapFixture)
	joined := strings.Join(got, ",")
	for _, want := range []string{"TESLASYNC_PORT", "REQUEST_TIMEOUT", "SAMPLE_RATIO"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q from %v", want, got)
		}
	}
	// `{{- if … }}` guards must not be mistaken for keys.
	for _, unwanted := range []string{"Values", "if"} {
		if strings.Contains(joined, unwanted) {
			t.Errorf("template syntax %q was parsed as a key: %v", unwanted, got)
		}
	}
}

func TestScanGetenvVars(t *testing.T) {
	fsys := fstest.MapFS{
		"internal/crypto/crypto.go": &fstest.MapFile{Data: []byte(`package crypto
func key() string { return os.Getenv("ENCRYPTION_KEY") }
func opt() (string, bool) { return os.LookupEnv("OPTIONAL_THING") }
`)},
		"internal/crypto/crypto_test.go": &fstest.MapFile{Data: []byte(`package crypto
func x() { os.Getenv("TEST_ONLY_VAR") }
`)},
	}
	got, err := ScanGetenvVars(fsys, []string{"internal"})
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	joined := strings.Join(got, ",")
	if !strings.Contains(joined, "ENCRYPTION_KEY") || !strings.Contains(joined, "OPTIONAL_THING") {
		t.Fatalf("got %v", got)
	}
	// Test files must not contribute — a test fixture is not deployment config.
	if strings.Contains(joined, "TEST_ONLY_VAR") {
		t.Fatalf("test-file variable leaked into the known set: %v", got)
	}
}

func TestComputeParityDrift(t *testing.T) {
	m := parityManifest()
	snap, err := m.Snapshot(parityFS(nil))
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	drift := m.ComputeParityDrift(snap)

	// API_TOKEN lives only in the Secret; it must NOT be reported as
	// missing from Helm.
	for _, v := range drift.MissingInHelm {
		if v == "API_TOKEN" {
			t.Error("a variable in the Secret was reported as missing from the chart")
		}
	}
	if !contains(drift.UnknownInCompose, "TYPO_VAR") {
		t.Errorf("typo'd compose variable not detected: %v", drift.UnknownInCompose)
	}
	if !contains(drift.UnknownInCompose, "WORKER_ONLY") {
		t.Errorf("list-form compose variable not detected: %v", drift.UnknownInCompose)
	}
}

// TestValidateParity_NewDriftFails is the core ratchet behaviour.
func TestValidateParity_NewDriftFails(t *testing.T) {
	m := parityManifest()
	// Add a variable to config.go only.
	fsys := parityFS(map[string]string{
		"internal/config/config.go": configGoFixture + "\nvar _ = envStr(\"BRAND_NEW_VAR\", \"\")\n",
	})
	snap, err := m.Snapshot(fsys)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	findings := ValidateParity(m, snap)
	if !hasMessage(findings, "missing from docker-compose.yml") {
		t.Fatalf("new drift was not rejected: %+v", findings)
	}
	if !hasMessage(findings, "missing from the Helm chart") {
		t.Fatalf("new Helm drift was not rejected: %+v", findings)
	}
}

func TestValidateParity_BaselinedDriftIsOnlyAdvisory(t *testing.T) {
	m := parityManifest()
	snap, err := m.Snapshot(parityFS(nil))
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	m.Baseline = m.ComputeParityDrift(snap)

	res := &Result{}
	res.Add(ValidateParity(m, snap)...)
	if !res.OK() {
		t.Fatalf("fully-baselined drift must not fail the gate: %+v", res.Errors())
	}
	if len(res.Advisories()) == 0 {
		t.Fatal("baselined drift must still be reported as advisories so it stays visible")
	}
}

// TestValidateParity_StaleBaselineFails keeps the ratchet tight: once
// drift is fixed, its baseline entry must be deleted.
func TestValidateParity_StaleBaselineFails(t *testing.T) {
	m := parityManifest()
	snap, err := m.Snapshot(parityFS(nil))
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	m.Baseline = m.ComputeParityDrift(snap)
	m.Baseline.MissingInCompose = append(m.Baseline.MissingInCompose, "ALREADY_FIXED_VAR")

	findings := ValidateParity(m, snap)
	if !hasMessage(findings, "stale baseline entry") {
		t.Fatalf("stale baseline entry was not rejected: %+v", findings)
	}
}

// TestValidateParity_SecretInConfigMapAlwaysFails: a credential in a
// non-secret ConfigMap is never excusable, baseline or not.
func TestValidateParity_SecretInConfigMapAlwaysFails(t *testing.T) {
	m := parityManifest()
	fsys := parityFS(map[string]string{
		"helm/teslasync/templates/configmap.yaml": configMapFixture + "  API_TOKEN: {{ .Values.apiToken | quote }}\n",
	})
	snap, err := m.Snapshot(fsys)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	m.Baseline = m.ComputeParityDrift(snap)

	findings := ValidateParity(m, snap)
	if !hasMessage(findings, "secret-classified variable is rendered into the non-secret ConfigMap") {
		t.Fatalf("credential leak was not rejected: %+v", findings)
	}
}

func TestParityManifest_IsSecret(t *testing.T) {
	m := &ParityManifest{
		SecretPatterns:     []string{"(^|_)(PASSWORD|SECRET|TOKEN)$", "_API_KEY$", "PRIVATE_KEY$"},
		NonSecretOverrides: []string{"TESLA_CLIENT_ID", "TESLASYNC_VAPID_PUBLIC_KEY"},
	}
	tests := map[string]bool{
		"DATABASE_PASS":               false,
		"MQTT_PASSWORD":               true,
		"AUTH_JWT_SECRET":             true,
		"GOOGLE_MAPS_API_KEY":         true,
		"TESLASYNC_VAPID_PRIVATE_KEY": true,
		"TESLASYNC_VAPID_PUBLIC_KEY":  false,
		"TESLA_CLIENT_ID":             false,
		"TESLASYNC_PORT":              false,
	}
	for name, want := range tests {
		if got := m.IsSecret(name); got != want {
			t.Errorf("IsSecret(%q) = %v, want %v", name, got, want)
		}
	}
}

// TestRealParityExtractionIsPlausible guards against a silent extractor
// regression: if a refactor moved config.go or changed the env helper
// names, the sets would collapse to zero and the gate would pass
// vacuously.
func TestRealParityExtractionIsPlausible(t *testing.T) {
	fsys := repoFSForTest(t)
	m, err := LoadParityManifest(fsys, ParityManifestPath)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	snap, err := m.Snapshot(fsys)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap.GoVars) < 50 {
		t.Errorf("extracted only %d config.go variables; the extractor or the file changed", len(snap.GoVars))
	}
	if len(snap.ComposeVars) < 20 {
		t.Errorf("extracted only %d compose variables", len(snap.ComposeVars))
	}
	if len(snap.HelmConfigMap) < 20 {
		t.Errorf("extracted only %d ConfigMap keys", len(snap.HelmConfigMap))
	}
	if len(snap.HelmSecret) < 5 {
		t.Errorf("extracted only %d Secret keys", len(snap.HelmSecret))
	}
	if len(snap.GoGetenvVars) < 5 {
		t.Errorf("extracted only %d point-of-use os.Getenv reads", len(snap.GoGetenvVars))
	}
}

// TestNoCredentialRendersIntoTheRealConfigMap is the security assertion
// against the actual chart.
func TestNoCredentialRendersIntoTheRealConfigMap(t *testing.T) {
	fsys := repoFSForTest(t)
	m, err := LoadParityManifest(fsys, ParityManifestPath)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	snap, err := m.Snapshot(fsys)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	for _, v := range snap.HelmConfigMap {
		if m.IsSecret(v) {
			t.Errorf("credential %q is rendered into the non-secret ConfigMap", v)
		}
	}
}

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}
