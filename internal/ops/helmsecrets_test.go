package ops

import (
	"strings"
	"testing"
	"testing/fstest"
)

func validHelmSecretsFS() fstest.MapFS {
	return fstest.MapFS{
		helmValuesPath: &fstest.MapFile{Data: []byte(`
secrets:
  create: false
  existingSecret: ""
externalSecrets:
  enabled: false
  secretStoreRef: {name: "", kind: ClusterSecretStore}
  target: {name: "", creationPolicy: Owner}
  data: []
  dataFrom: []
postgresql:
  auth:
    password: ""
grafana:
  adminPassword: ""
`)},
		helmHelpersPath: &fstest.MapFile{Data: []byte(`
{{ define "teslasync.validateSecretConfiguration" }}
secrets.existingSecret and externalSecrets.enabled are mutually exclusive
secrets.create cannot be combined with secrets.existingSecret or externalSecrets.enabled
an explicit PostgreSQL password is required when secrets.create=true
refusing known weak PostgreSQL password
.Values.externalSecrets.target.name
{{ end }}
`)},
		helmSecretPath: &fstest.MapFile{Data: []byte(`
include "teslasync.validateSecretConfiguration"
.Values.secrets.create
include "teslasync.postgresql.password"
.Values.grafana.adminPassword
`)},
		helmExternalSecretPath: &fstest.MapFile{Data: []byte(`
apiVersion: external-secrets.io/v1
kind: ExternalSecret
secretStoreRef:
include "teslasync.secretName"
.Values.externalSecrets.data
.Values.externalSecrets.dataFrom
`)},
		helmConfigMapPath: &fstest.MapFile{Data: []byte(`.Values.secrets.create`)},
		helmPostgresPath:  &fstest.MapFile{Data: []byte(`secretKeyRef: include "teslasync.secretName"`)},
		helmGrafanaPath:   &fstest.MapFile{Data: []byte(`secretKeyRef: include "teslasync.secretName"`)},
		helmDatabaseTestPath: &fstest.MapFile{Data: []byte(`
secretKeyRef: include "teslasync.secretName"
`)},
		helmUnitDriftPath: &fstest.MapFile{Data: []byte(`
and .Values.secrets.create
include "teslasync.secretName"
TESLASYNC_OPERATOR_TOKEN
`)},
		secretManagementDocPath: &fstest.MapFile{Data: []byte(`
## Chart-managed Secret
## Existing Kubernetes Secret
## External Secrets Operator
offline workflows must use an existing Secret or External Secrets Operator
Vault AWS Secrets Manager Azure Key Vault Google Secret Manager
`)},
	}
}

func TestCheckHelmSecrets_AcceptsCompleteContract(t *testing.T) {
	if findings := CheckHelmSecrets(validHelmSecretsFS()); len(findings) != 0 {
		t.Fatalf("unexpected findings: %+v", findings)
	}
}

func TestCheckHelmSecrets_RejectsStaticPasswordAndBrokenExternalWiring(t *testing.T) {
	tests := []struct {
		name string
		path string
		old  string
		new  string
		want string
	}{
		{
			name: "static database password", path: helmValuesPath,
			old: `password: ""`, new: `password: "teslasync"`,
			want: "postgresql.auth.password must be blank",
		},
		{
			name: "chart Secret not skipped", path: helmSecretPath,
			old: ".Values.secrets.create", new: ".Values.secrets.render",
			want: `missing secret contract token ".Values.secrets.create"`,
		},
		{
			name: "offline random generation", path: helmHelpersPath,
			old: `.Values.externalSecrets.target.name`, new: `.Values.externalSecrets.target.name randAlphaNum 48`,
			want: "offline renders must not contain credential generator",
		},
		{
			name: "unit drift bypasses secret mode", path: helmUnitDriftPath,
			old: "and .Values.secrets.create", new: "and .Values.operator.token",
			want: `missing secret contract token "and .Values.secrets.create"`,
		},
		{
			name: "workload bypasses selected Secret", path: helmPostgresPath,
			old: `include "teslasync.secretName"`, new: `name: {{ include "teslasync.fullname" . }}`,
			want: "bypasses teslasync.secretName",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fsys := validHelmSecretsFS()
			file := fsys[tt.path]
			file.Data = []byte(strings.Replace(string(file.Data), tt.old, tt.new, 1))
			findings := CheckHelmSecrets(fsys)
			if !hasMessage(findings, tt.want) {
				t.Fatalf("want finding containing %q, got %+v", tt.want, findings)
			}
		})
	}
}
