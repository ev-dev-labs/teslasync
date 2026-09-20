package tesla

import (
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

func TestCommandProxyVerifiesTrustAndHostname(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	file, err := os.CreateTemp(".", ".proxy-ca-test-*.pem")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(file.Name())
	if err := pem.Encode(file, &pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name, ca, url string
		wantError     bool
	}{
		{"untrusted", "", server.URL, true},
		{"trusted", file.Name(), server.URL, false},
		{"wrong hostname", file.Name(), strings.Replace(server.URL, "127.0.0.1", "localhost", 1), true},
		{"missing CA", file.Name() + ".missing", server.URL, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := NewClient(config.TeslaConfig{CommandProxyCAFile: tc.ca, Timeout: 5 * time.Second})
			response, err := client.proxyClient.Get(tc.url)
			if response != nil {
				response.Body.Close()
			}
			if (err != nil) != tc.wantError {
				t.Fatalf("TLS request error = %v; want error %v", err, tc.wantError)
			}
		})
	}
}
