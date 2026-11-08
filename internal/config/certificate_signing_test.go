package config

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCertificateSigningConfigurationAndRedaction(t *testing.T) {
	for _, tc := range []struct{ name, canonical, legacy, want string }{
		{"legacy certificate continuity", "", "legacy-certificate-fixture", "legacy-certificate-fixture"},
		{"canonical overrides legacy", "canonical-certificate-fixture", "legacy-certificate-fixture", "canonical-certificate-fixture"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("TESLASYNC_BATTERY_CERTIFICATE_SIGNING_KEY", tc.canonical)
			t.Setenv("AUTH_JWT_SECRET", tc.legacy)
			cfg, err := Load()
			if err != nil {
				t.Fatal(err)
			}
			if cfg.BatteryCertificateSigningKey != tc.want {
				t.Fatal("certificate signing input was not preserved")
			}
			body, err := json.Marshal(cfg)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(body), tc.want) {
				t.Fatal("certificate signing input leaked into serialized configuration")
			}
		})
	}
}
