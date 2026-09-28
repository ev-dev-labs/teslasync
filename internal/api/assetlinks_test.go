package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

const testAssetLinks = `[{"relation":["delegate_permission/common.handle_all_urls"],` +
	`"target":{"namespace":"android_app","package_name":"com.example.teslasync",` +
	`"sha256_cert_fingerprints":["AA:BB:CC:DD"]}}]`

func TestServeAssetLinks(t *testing.T) {
	t.Parallel()

	t.Run("unconfigured returns 404", func(t *testing.T) {
		t.Parallel()
		for _, raw := range []string{"", "   "} {
			req := httptest.NewRequest(http.MethodGet, "/.well-known/assetlinks.json", nil)
			rec := httptest.NewRecorder()
			ServeAssetLinks(raw)(rec, req)
			if rec.Code != http.StatusNotFound {
				t.Fatalf("raw %q: got status %d, want 404", raw, rec.Code)
			}
		}
	})

	t.Run("malformed JSON fails closed with 500", func(t *testing.T) {
		t.Parallel()
		for _, raw := range []string{"not-json", `{"relation":[]}`, `[123`, `null`} {
			req := httptest.NewRequest(http.MethodGet, "/.well-known/assetlinks.json", nil)
			rec := httptest.NewRecorder()
			ServeAssetLinks(raw)(rec, req)
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("raw %q: got status %d, want 500", raw, rec.Code)
			}
		}
	})

	t.Run("valid statement list is served as JSON", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(http.MethodGet, "/.well-known/assetlinks.json", nil)
		rec := httptest.NewRecorder()
		ServeAssetLinks(testAssetLinks)(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("got status %d, want 200", rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
			t.Fatalf("got Content-Type %q, want application/json", ct)
		}
		var statements []struct {
			Relation []string `json:"relation"`
			Target   struct {
				Namespace string   `json:"namespace"`
				Package   string   `json:"package_name"`
				Prints    []string `json:"sha256_cert_fingerprints"`
			} `json:"target"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &statements); err != nil {
			t.Fatalf("response is not valid JSON: %v", err)
		}
		if len(statements) != 1 || statements[0].Target.Package != "com.example.teslasync" {
			t.Fatalf("round-trip mismatch: %+v", statements)
		}
	})

	t.Run("non-GET is rejected", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(http.MethodPost, "/.well-known/assetlinks.json", nil)
		rec := httptest.NewRecorder()
		ServeAssetLinks(testAssetLinks)(rec, req)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("got status %d, want 405", rec.Code)
		}
	})
}
