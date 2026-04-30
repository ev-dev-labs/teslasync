package httputil

import (
	"bytes"
	"go/parser"
	"go/token"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// RedactURL
// ---------------------------------------------------------------------------

func TestRedactURL_RedactsKeyTokenSecretPassword(t *testing.T) {
	cases := []struct {
		name     string
		raw      string
		mustHave []string
		mustHide []string
	}{
		{
			name:     "api_key",
			raw:      "https://example.test/v1?api_key=SHHH",
			mustHave: []string{"api_key=REDACTED"},
			mustHide: []string{"SHHH"},
		},
		{
			name:     "token",
			raw:      "https://example.test/v1?token=ABC123",
			mustHave: []string{"token=REDACTED"},
			mustHide: []string{"ABC123"},
		},
		{
			name:     "secret",
			raw:      "https://example.test/v1?secret=XYZ",
			mustHave: []string{"secret=REDACTED"},
			mustHide: []string{"XYZ"},
		},
		{
			name:     "password",
			raw:      "https://example.test/v1?password=hunter2",
			mustHave: []string{"password=REDACTED"},
			mustHide: []string{"hunter2"},
		},
		{
			name:     "case_insensitive",
			raw:      "https://example.test/v1?API_KEY=top&access_TOKEN=t&Secret=s&PaSsWoRd=p",
			mustHave: []string{"REDACTED"},
			mustHide: []string{"top", "access_TOKEN=t", "Secret=s", "PaSsWoRd=p"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			u, err := url.Parse(tc.raw)
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			got := RedactURL(u)
			for _, want := range tc.mustHave {
				if !strings.Contains(got, want) {
					t.Errorf("RedactURL(%q) missing %q in %q", tc.raw, want, got)
				}
			}
			for _, leak := range tc.mustHide {
				if strings.Contains(got, leak) {
					t.Errorf("RedactURL(%q) leaked %q in %q", tc.raw, leak, got)
				}
			}
		})
	}
}

func TestRedactURL_PreservesNonSensitiveParams(t *testing.T) {
	u, _ := url.Parse("https://example.test/v1/users?filter=active&limit=10&token=secret")
	got := RedactURL(u)
	if !strings.Contains(got, "filter=active") {
		t.Errorf("filter param lost: %q", got)
	}
	if !strings.Contains(got, "limit=10") {
		t.Errorf("limit param lost: %q", got)
	}
	if strings.Contains(got, "token=secret") {
		t.Errorf("sensitive token leaked: %q", got)
	}
}

func TestRedactURL_NilURL(t *testing.T) {
	if got := RedactURL(nil); got != "" {
		t.Errorf("RedactURL(nil) = %q, want empty string", got)
	}
}

// ---------------------------------------------------------------------------
// TruncateBody
// ---------------------------------------------------------------------------

func TestTruncateBody_PassthroughWhenSmall(t *testing.T) {
	in := []byte("hello world")
	got := TruncateBody(in, 1024)
	if !bytes.Equal(got, in) {
		t.Errorf("TruncateBody passthrough: want %q, got %q", in, got)
	}
}

func TestTruncateBody_PassthroughWhenExactlyMax(t *testing.T) {
	in := bytes.Repeat([]byte("X"), 100)
	got := TruncateBody(in, 100)
	if len(got) != 100 {
		t.Errorf("TruncateBody at boundary should not append marker; got len=%d", len(got))
	}
}

func TestTruncateBody_TruncatesWithMarker(t *testing.T) {
	in := bytes.Repeat([]byte("Z"), 12*1024)
	got := TruncateBody(in, MaxOutboundBodyBytes)
	wantLen := MaxOutboundBodyBytes + len(OutboundTruncationMarker)
	if len(got) != wantLen {
		t.Fatalf("len: want %d (10KB+marker), got %d", wantLen, len(got))
	}
	if !bytes.HasPrefix(got, bytes.Repeat([]byte("Z"), MaxOutboundBodyBytes)) {
		t.Errorf("prefix mismatch")
	}
	if !bytes.HasSuffix(got, []byte(OutboundTruncationMarker)) {
		t.Errorf("suffix mismatch: tail=%q", got[len(got)-len(OutboundTruncationMarker):])
	}
}

func TestTruncateBody_ZeroOrNegativeMaxReturnsInput(t *testing.T) {
	in := bytes.Repeat([]byte("Q"), 100)
	if got := TruncateBody(in, 0); !bytes.Equal(got, in) {
		t.Errorf("max=0 should passthrough; got len=%d", len(got))
	}
	if got := TruncateBody(in, -1); !bytes.Equal(got, in) {
		t.Errorf("max=-1 should passthrough; got len=%d", len(got))
	}
}

// ---------------------------------------------------------------------------
// Layering (T11): internal/platform/httputil must not import internal/database.
// Production files (non-_test) must additionally not import internal/api,
// since the api package depends on httputil — the reverse direction would
// introduce an import cycle.
//
// The forbidden import paths are assembled from substrings rather than
// written as a single literal so this test file does not itself trip the
// repository-level grep that scans for the forbidden import (the grep is
// run as part of the Phase 38 gate).
// ---------------------------------------------------------------------------

const (
	forbiddenImportRoot     = "github.com/ev-dev-labs/teslasync/internal/"
	forbiddenDatabaseImport = forbiddenImportRoot + "data" + "base"
	forbiddenApiImport      = forbiddenImportRoot + "a" + "pi"
)

func TestLayering_HttputilDoesNotImportDatabase(t *testing.T) {
	pkgDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}

	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, pkgDir, func(fi os.FileInfo) bool {
		return strings.HasSuffix(fi.Name(), ".go")
	}, parser.ImportsOnly)
	if err != nil {
		t.Fatalf("parser.ParseDir(%q): %v", pkgDir, err)
	}
	if len(pkgs) == 0 {
		t.Fatalf("no Go files parsed in %q", pkgDir)
	}

	for pkgName, pkg := range pkgs {
		for filename, file := range pkg.Files {
			rel, _ := filepath.Rel(pkgDir, filename)
			isProd := !strings.HasSuffix(filename, "_test.go")
			for _, imp := range file.Imports {
				path := strings.Trim(imp.Path.Value, `"`)
				if path == forbiddenDatabaseImport ||
					strings.HasPrefix(path, forbiddenDatabaseImport+"/") {
					t.Errorf("layering violation in pkg=%s file=%s: forbidden import %q",
						pkgName, rel, path)
				}
				if isProd && (path == forbiddenApiImport ||
					strings.HasPrefix(path, forbiddenApiImport+"/")) {
					// Tests may import internal/api for integration; production
					// httputil files must not, otherwise the api package (which
					// depends on httputil for APICallSink) would form a cycle.
					t.Errorf("layering violation in pkg=%s file=%s: production code imports %q",
						pkgName, rel, path)
				}
			}
		}
	}
}

// Compile-time assertion that the local APICallSink type stays a small,
// stable interface. If a future change adds methods, this test (and the
// production binding in internal/api) breaks loudly.
func TestAPICallSink_InterfaceShape(t *testing.T) {
	var _ APICallSink = (*shapeOnlySink)(nil)
}

type shapeOnlySink struct{}

func (shapeOnlySink) Enqueue(APICallRecord) {}
func (shapeOnlySink) CaptureBodies() bool   { return false }
