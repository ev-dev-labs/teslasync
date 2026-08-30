package ops

import (
	"io/fs"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	helmValuesPath          = "helm/teslasync/values.yaml"
	helmHelpersPath         = "helm/teslasync/templates/_helpers.tpl"
	helmSecretPath          = "helm/teslasync/templates/secret.yaml"
	helmExternalSecretPath  = "helm/teslasync/templates/externalsecret.yaml"
	helmConfigMapPath       = "helm/teslasync/templates/configmap.yaml"
	helmPostgresPath        = "helm/teslasync/templates/deployment-postgresql.yaml"
	helmGrafanaPath         = "helm/teslasync/templates/deployment-grafana.yaml"
	helmDatabaseTestPath    = "helm/teslasync/templates/tests/test-database.yaml"
	helmUnitDriftPath       = "helm/teslasync/templates/cronjob-unit-drift-validator.yaml"
	secretManagementDocPath = "docs/operations/secret-management.md"
)

type helmSecretDefaults struct {
	Secrets struct {
		Create         bool   `yaml:"create"`
		ExistingSecret string `yaml:"existingSecret"`
	} `yaml:"secrets"`
	ExternalSecrets struct {
		Enabled        bool           `yaml:"enabled"`
		SecretStoreRef map[string]any `yaml:"secretStoreRef"`
		Target         map[string]any `yaml:"target"`
		Data           []any          `yaml:"data"`
		DataFrom       []any          `yaml:"dataFrom"`
	} `yaml:"externalSecrets"`
	PostgreSQL struct {
		Auth struct {
			Password string `yaml:"password"`
		} `yaml:"auth"`
	} `yaml:"postgresql"`
	Grafana struct {
		AdminPassword string `yaml:"adminPassword"`
	} `yaml:"grafana"`
}

// CheckHelmSecrets verifies that offline renders never generate credentials,
// chart-managed Secrets require explicit values, and every workload consumes
// the selected existing or external Secret consistently.
func CheckHelmSecrets(fsys fs.FS) []Finding {
	const check = "helm-secrets"
	var out []Finding

	valuesRaw, err := fs.ReadFile(fsys, helmValuesPath)
	if err != nil {
		return []Finding{errf(check, helmValuesPath, "read: %v", err)}
	}
	var values helmSecretDefaults
	if err := yaml.Unmarshal(valuesRaw, &values); err != nil {
		return []Finding{errf(check, helmValuesPath, "parse: %v", err)}
	}
	if values.PostgreSQL.Auth.Password != "" {
		out = append(out, errf(check, helmValuesPath, "postgresql.auth.password must be blank so the chart cannot ship a static credential"))
	}
	if values.Grafana.AdminPassword != "" {
		out = append(out, errf(check, helmValuesPath, "grafana.adminPassword must be blank so the chart cannot ship a static credential"))
	}
	if values.Secrets.Create {
		out = append(out, errf(check, helmValuesPath, "secrets.create must be false so offline and GitOps renders use an existing or external Secret"))
	}
	if values.Secrets.ExistingSecret != "" {
		out = append(out, errf(check, helmValuesPath, "secrets.existingSecret must not select an environment-specific Secret by default"))
	}
	if values.ExternalSecrets.Enabled {
		out = append(out, errf(check, helmValuesPath, "externalSecrets.enabled must remain opt-in"))
	}
	if values.ExternalSecrets.SecretStoreRef == nil || values.ExternalSecrets.Target == nil ||
		values.ExternalSecrets.Data == nil || values.ExternalSecrets.DataFrom == nil {
		out = append(out, errf(check, helmValuesPath, "externalSecrets must declare store, target, data, and dataFrom configuration surfaces"))
	}

	paths := []string{
		helmHelpersPath,
		helmSecretPath,
		helmExternalSecretPath,
		helmConfigMapPath,
		helmPostgresPath,
		helmGrafanaPath,
		helmDatabaseTestPath,
		helmUnitDriftPath,
		secretManagementDocPath,
	}
	sources := make(map[string]string, len(paths))
	for _, path := range paths {
		raw, readErr := fs.ReadFile(fsys, path)
		if readErr != nil {
			out = append(out, errf(check, path, "read: %v", readErr))
			continue
		}
		sources[path] = string(raw)
	}
	if len(out) > 0 {
		return out
	}

	requireTokens := func(path string, tokens ...string) {
		for _, token := range tokens {
			if !strings.Contains(sources[path], token) {
				out = append(out, errf(check, path, "missing secret contract token %q", token))
			}
		}
	}

	requireTokens(helmHelpersPath,
		`define "teslasync.validateSecretConfiguration"`,
		`secrets.existingSecret and externalSecrets.enabled are mutually exclusive`,
		`secrets.create cannot be combined with secrets.existingSecret or externalSecrets.enabled`,
		`an explicit PostgreSQL password is required when secrets.create=true`,
		`refusing known weak PostgreSQL password`,
		`.Values.externalSecrets.target.name`,
	)
	for _, forbidden := range []string{`lookup "v1" "Secret"`, `randAlphaNum`} {
		if strings.Contains(sources[helmHelpersPath], forbidden) {
			out = append(out, errf(check, helmHelpersPath,
				"offline renders must not contain credential generator %q", forbidden))
		}
	}
	requireTokens(helmSecretPath,
		`include "teslasync.validateSecretConfiguration"`,
		`.Values.secrets.create`,
		`include "teslasync.postgresql.password"`,
		`.Values.grafana.adminPassword`,
	)
	requireTokens(helmExternalSecretPath,
		`apiVersion: external-secrets.io/v1`,
		`kind: ExternalSecret`,
		`secretStoreRef:`,
		`include "teslasync.secretName"`,
		`.Values.externalSecrets.data`,
		`.Values.externalSecrets.dataFrom`,
	)
	requireTokens(helmConfigMapPath, `.Values.secrets.create`)
	for _, path := range []string{helmPostgresPath, helmGrafanaPath, helmDatabaseTestPath} {
		requireTokens(path, `include "teslasync.secretName"`)
		directSecretRef := regexp.MustCompile(`secretKeyRef:\s+name:\s+\{\{\s*include "teslasync\.fullname" \.\s*\}\}`)
		if directSecretRef.MatchString(sources[path]) {
			out = append(out, errf(check, path, "application secretKeyRef bypasses teslasync.secretName"))
		}
	}
	requireTokens(helmUnitDriftPath,
		`and .Values.secrets.create`,
		`include "teslasync.secretName"`,
		`TESLASYNC_OPERATOR_TOKEN`,
	)
	requireTokens(secretManagementDocPath,
		`## Chart-managed Secret`,
		`## Existing Kubernetes Secret`,
		`## External Secrets Operator`,
		`offline workflows must use an existing Secret or External Secrets Operator`,
		`AWS Secrets Manager`,
		`Azure Key Vault`,
		`Google Secret Manager`,
		`Vault`,
	)

	return out
}
