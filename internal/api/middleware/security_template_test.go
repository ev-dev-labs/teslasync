package middleware

import (
	"crypto/sha256"
	"encoding/base64"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

func repositoryRoot(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test source path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", ".."))
}

func TestProductionHeaderTemplatesContainRequiredControls(t *testing.T) {
	root := repositoryRoot(t)
	for _, templatePath := range []string{
		filepath.Join(root, "web", "nginx.conf"),
		filepath.Join(root, "helm", "teslasync", "templates", "configmap-nginx.yaml"),
	} {
		t.Run(filepath.Base(templatePath), func(t *testing.T) {
			contents, err := os.ReadFile(templatePath)
			if err != nil {
				t.Fatalf("read template: %v", err)
			}
			for _, needle := range []string{
				"Content-Security-Policy",
				"frame-ancestors 'none'",
				"script-src 'self' 'sha256-",
				"https://fonts.googleapis.com",
				"style-src-elem 'self' https://fonts.googleapis.com",
				"https://fonts.gstatic.com",
				"media-src 'self' blob:",
				"X-Frame-Options \"DENY\"",
				"X-Content-Type-Options \"nosniff\"",
				"Referrer-Policy",
				"Permissions-Policy",
				"proxy_set_header Host $http_host",
				"proxy_set_header X-Forwarded-For $remote_addr",
				"proxy_set_header True-Client-IP \"\"",
				"proxy_set_header X-Forwarded-Host \"\"",
			} {
				if !strings.Contains(string(contents), needle) {
					t.Errorf("template missing %q", needle)
				}
			}
			if strings.Contains(string(contents), "script-src 'self' 'unsafe-inline'") {
				t.Error("template weakens script CSP with unsafe-inline")
			}
		})
	}

	traefikContents, err := os.ReadFile(filepath.Join(root, "helm", "teslasync", "templates", "middleware-security-headers.yaml"))
	if err != nil {
		t.Fatalf("read Traefik security template: %v", err)
	}
	for _, needle := range []string{
		"contentSecurityPolicy",
		"frameDeny",
		"contentTypeNosniff",
		"referrerPolicy",
		"permissionsPolicy",
		"stsSeconds",
		"script-src 'self' 'sha256-",
		"https://fonts.googleapis.com",
		"style-src-elem 'self' https://fonts.googleapis.com",
		"https://fonts.gstatic.com",
		"media-src 'self' blob:",
	} {
		if !strings.Contains(string(traefikContents), needle) {
			t.Errorf("Traefik template missing %q", needle)
		}
	}
	if strings.Contains(string(traefikContents), "script-src 'self' 'unsafe-inline'") {
		t.Error("Traefik template weakens script CSP with unsafe-inline")
	}

	configMapContents, err := os.ReadFile(filepath.Join(root, "helm", "teslasync", "templates", "configmap.yaml"))
	if err != nil {
		t.Fatalf("read ConfigMap template: %v", err)
	}
	for _, needle := range []string{"derivedOrigins", `printf "https://%s"`, "ingressRoute TLS is enabled"} {
		if !strings.Contains(string(configMapContents), needle) {
			t.Errorf("ConfigMap template missing trusted-origin contract %q", needle)
		}
	}

	ingressContents, err := os.ReadFile(filepath.Join(root, "helm", "teslasync", "templates", "ingress.yaml"))
	if err != nil {
		t.Fatalf("read ingress template: %v", err)
	}
	if strings.Contains(string(ingressContents), "hsts") {
		t.Error("standard ingress must not emit inert ingress-nginx HSTS annotations")
	}
	if !strings.Contains(string(ingressContents), "if .Values.ingress.tls") {
		t.Error("standard ingress must make SSL redirects conditional on ingress TLS")
	}

	runbook, err := os.ReadFile(filepath.Join(root, "docs", "runbooks", "security-boundary-hardening.md"))
	if err != nil {
		t.Fatalf("read security runbook: %v", err)
	}
	for _, needle := range []string{"controller ConfigMap", "hsts-max-age", "hsts-include-subdomains", "CORS_ORIGINS", "ingress.tls[].hosts"} {
		if !strings.Contains(string(runbook), needle) {
			t.Errorf("security runbook missing ingress-nginx HSTS guidance %q", needle)
		}
	}
}

func TestProductionCSPHashesMatchInlineBootstrap(t *testing.T) {
	html, err := os.ReadFile(filepath.Join(repositoryRoot(t), "web", "index.html"))
	if err != nil {
		t.Fatalf("read index.html: %v", err)
	}

	expected := map[string]string{
		"script": "sha256-ue3mo3bS289RnivI3dUkb2fS/Z4Y2IXWPEYuKHmUdY0=",
		"style":  "sha256-eC/LYFbFX0VPdH107k2WfWKmpi4owBWgEs9oH9HVTeI=",
	}
	for tag, want := range expected {
		pattern := regexp.MustCompile(`(?s)<` + tag + `[^>]*>(.*?)</` + tag + `>`)
		match := pattern.FindSubmatch(html)
		if len(match) != 2 {
			t.Fatalf("find inline %s block", tag)
		}
		sum := sha256.Sum256(match[1])
		got := "sha256-" + base64.StdEncoding.EncodeToString(sum[:])
		if got != want {
			t.Errorf("%s CSP hash = %q, want %q", tag, got, want)
		}
	}
}
