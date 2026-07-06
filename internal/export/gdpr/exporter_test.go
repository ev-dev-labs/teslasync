package gdpr

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ── Compile-time guarantee ─────────────────────────────────────────────────
// fakeExtractor MUST keep satisfying the DomainExtractor port so the fixtures
// below exercise the real interface the Exporter consumes.
var _ DomainExtractor = (*fakeExtractor)(nil)

var errBoom = errors.New("boom")

// ── Fakes ──────────────────────────────────────────────────────────────────

// fakeExtractor is a white-box DomainExtractor fake. It yields the configured
// rows in order, can inject an error at a chosen row index, records how many
// times Close was called, and captures the last context passed to Next.
type fakeExtractor struct {
	domain   string
	rows     [][]byte
	nextErr  error // returned instead of a row when idx == errAt
	errAt    int   // row index at which nextErr fires; use -1 for "never"
	closeErr error

	idx        int
	closeCalls int
	lastCtx    context.Context
}

func newFake(domain string, rows ...string) *fakeExtractor {
	b := make([][]byte, len(rows))
	for i, r := range rows {
		b[i] = []byte(r)
	}
	return &fakeExtractor{domain: domain, rows: b, errAt: -1}
}

func (f *fakeExtractor) Domain() string { return f.domain }

func (f *fakeExtractor) Next(ctx context.Context) ([]byte, error) {
	f.lastCtx = ctx
	if f.nextErr != nil && f.idx == f.errAt {
		return nil, f.nextErr
	}
	if f.idx >= len(f.rows) {
		return nil, io.EOF
	}
	row := f.rows[f.idx]
	f.idx++
	return row, nil
}

func (f *fakeExtractor) Close() error {
	f.closeCalls++
	return f.closeErr
}

// ── Bundle reader helper ───────────────────────────────────────────────────

// readBundle decompresses + untars the produced archive, verifying that each
// tar header's declared Size matches the real entry length. It returns the
// entry names in archive order and a name→bytes map.
func readBundle(t *testing.T, path string) ([]string, map[string][]byte) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read bundle: %v", err)
	}
	gz, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("gzip reader: %v", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	order := []string{}
	files := map[string][]byte{}
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatalf("tar next: %v", err)
		}
		body, err := io.ReadAll(tr)
		if err != nil {
			t.Fatalf("tar read %s: %v", hdr.Name, err)
		}
		if int64(len(body)) != hdr.Size {
			t.Errorf("entry %s: header size %d != body len %d", hdr.Name, hdr.Size, len(body))
		}
		if hdr.Mode != 0o600 {
			t.Errorf("entry %s: mode %o, want 600", hdr.Name, hdr.Mode)
		}
		order = append(order, hdr.Name)
		files[hdr.Name] = body
	}
	return order, files
}

type manifestDoc struct {
	JobID     string       `json:"job_id"`
	CreatedAt time.Time    `json:"created_at"`
	Schema    string       `json:"schema"`
	Domains   []DomainStat `json:"domains"`
}

// ── NewExporter ────────────────────────────────────────────────────────────

func TestNewExporter(t *testing.T) {
	base := t.TempDir()

	tests := []struct {
		name    string
		outDir  string
		wantErr bool
		errHas  string
	}{
		{name: "existing dir", outDir: base},
		{name: "nested dir created", outDir: filepath.Join(base, "a", "b", "c")},
		{name: "empty rejected", outDir: "", wantErr: true, errHas: "outDir is required"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			e, err := NewExporter(tc.outDir)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (exporter=%v)", e)
				}
				if e != nil {
					t.Errorf("expected nil exporter on error, got %v", e)
				}
				if tc.errHas != "" && !strings.Contains(err.Error(), tc.errHas) {
					t.Errorf("error %q missing %q", err.Error(), tc.errHas)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if e == nil || e.outDir != tc.outDir {
				t.Fatalf("exporter outDir = %v, want %q", e, tc.outDir)
			}
			if fi, err := os.Stat(tc.outDir); err != nil || !fi.IsDir() {
				t.Errorf("outDir not created as dir: err=%v", err)
			}
		})
	}
}

func TestNewExporter_MkdirFails(t *testing.T) {
	// Create a regular file, then try to use it as a parent directory. MkdirAll
	// must fail because a path component is not a directory.
	base := t.TempDir()
	filePath := filepath.Join(base, "iamafile")
	if err := os.WriteFile(filePath, []byte("x"), 0o600); err != nil {
		t.Fatalf("seed file: %v", err)
	}

	e, err := NewExporter(filepath.Join(filePath, "child"))
	if err == nil {
		t.Fatalf("expected mkdir error, got nil (exporter=%v)", e)
	}
	if e != nil {
		t.Errorf("expected nil exporter on error, got %v", e)
	}
	if !strings.Contains(err.Error(), "mkdir") {
		t.Errorf("error %q missing %q", err.Error(), "mkdir")
	}
}

// ── validateJobID / isSafeSegment ──────────────────────────────────────────

func TestValidateJobID(t *testing.T) {
	tests := []struct {
		name    string
		jobID   string
		wantErr bool
		errHas  string
	}{
		{name: "uuid-like", jobID: "3f2a9c1e-0b7d-4e5a-9f21-abc123def456"},
		{name: "ulid-like", jobID: "01HZX8Q9M4KJ7Z2N3P5R6T7V8W"},
		{name: "simple", jobID: "job42"},
		{name: "empty", jobID: "", wantErr: true, errHas: "jobID is required"},
		{name: "dot", jobID: ".", wantErr: true, errHas: "single path segment"},
		{name: "dotdot", jobID: "..", wantErr: true, errHas: "single path segment"},
		{name: "parent traversal", jobID: "../secret", wantErr: true, errHas: "single path segment"},
		{name: "nested traversal", jobID: "../../etc/cron.d/x", wantErr: true, errHas: "single path segment"},
		{name: "forward slash", jobID: "a/b", wantErr: true, errHas: "single path segment"},
		{name: "back slash", jobID: `a\b`, wantErr: true, errHas: "single path segment"},
		{name: "leading slash", jobID: "/abs", wantErr: true, errHas: "single path segment"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateJobID(tc.jobID)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for %q, got nil", tc.jobID)
				}
				if tc.errHas != "" && !strings.Contains(err.Error(), tc.errHas) {
					t.Errorf("error %q missing %q", err.Error(), tc.errHas)
				}
				return
			}
			if err != nil {
				t.Errorf("unexpected error for %q: %v", tc.jobID, err)
			}
		})
	}
}

func TestIsSafeSegment(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"drives", true},
		{"signal_log", true},
		{"charging-2024", true},
		{"", false},
		{".", false},
		{"..", false},
		{"a/b", false},
		{`a\b`, false},
		{"../x", false},
		{"/x", false},
	}
	for _, tc := range tests {
		if got := isSafeSegment(tc.in); got != tc.want {
			t.Errorf("isSafeSegment(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

// ── Export: validation / error paths ───────────────────────────────────────

func TestExport_NilReceiver(t *testing.T) {
	var e *Exporter
	res, err := e.Export(context.Background(), "job1", []DomainExtractor{newFake("drives", "{}")})
	if err == nil {
		t.Fatalf("expected error on nil receiver, got res=%v", res)
	}
	if !strings.Contains(err.Error(), "nil exporter") {
		t.Errorf("error %q missing %q", err.Error(), "nil exporter")
	}
}

func TestExport_ValidationErrors(t *testing.T) {
	tests := []struct {
		name       string
		jobID      string
		extractors []DomainExtractor
		errHas     string
	}{
		{name: "empty jobID", jobID: "", extractors: []DomainExtractor{newFake("d", "{}")}, errHas: "jobID is required"},
		{name: "traversal jobID", jobID: "../evil", extractors: []DomainExtractor{newFake("d", "{}")}, errHas: "single path segment"},
		{name: "no extractors", jobID: "job1", extractors: nil, errHas: "at least one extractor required"},
		{name: "empty extractor slice", jobID: "job1", extractors: []DomainExtractor{}, errHas: "at least one extractor required"},
		{name: "nil extractor in slice", jobID: "job1", extractors: []DomainExtractor{newFake("d", "{}"), nil}, errHas: "extractor 1 is nil"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			outDir := t.TempDir()
			e, err := NewExporter(outDir)
			if err != nil {
				t.Fatalf("NewExporter: %v", err)
			}
			res, err := e.Export(context.Background(), tc.jobID, tc.extractors)
			if err == nil {
				t.Fatalf("expected error, got res=%v", res)
			}
			if res != nil {
				t.Errorf("expected nil result on error, got %v", res)
			}
			if !strings.Contains(err.Error(), tc.errHas) {
				t.Errorf("error %q missing %q", err.Error(), tc.errHas)
			}
			// A rejected export must not leave a bundle behind.
			if entries, _ := filepath.Glob(filepath.Join(outDir, "*.tar.gz")); len(entries) != 0 {
				t.Errorf("expected no bundle written, found %v", entries)
			}
		})
	}
}

func TestExport_TraversalDoesNotEscapeOutDir(t *testing.T) {
	base := t.TempDir()
	outDir := filepath.Join(base, "bundles")
	e, err := NewExporter(outDir)
	if err != nil {
		t.Fatalf("NewExporter: %v", err)
	}
	if _, err := e.Export(context.Background(), "../pwned", []DomainExtractor{newFake("d", "{}")}); err == nil {
		t.Fatal("expected traversal jobID to be rejected")
	}
	// The sibling path the traversal targeted must not exist.
	if _, err := os.Stat(filepath.Join(base, "pwned.tar.gz")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("traversal wrote outside outDir: stat err = %v", err)
	}
}

func TestExport_InvalidDomainName(t *testing.T) {
	outDir := t.TempDir()
	e, _ := NewExporter(outDir)
	bad := newFake("../escape", "{}")

	res, err := e.Export(context.Background(), "job1", []DomainExtractor{bad})
	if err == nil {
		t.Fatalf("expected error for unsafe domain, got res=%v", res)
	}
	if !strings.Contains(err.Error(), "invalid domain name") {
		t.Errorf("error %q missing %q", err.Error(), "invalid domain name")
	}
	if bad.closeCalls != 1 {
		t.Errorf("extractor Close called %d times, want 1", bad.closeCalls)
	}
	// Partial file is intentionally left in place for diagnosis.
	if _, err := os.Stat(filepath.Join(outDir, "job1.tar.gz")); err != nil {
		t.Errorf("expected partial bundle to remain, stat err = %v", err)
	}
}

func TestExport_ExtractorNextError(t *testing.T) {
	outDir := t.TempDir()
	e, _ := NewExporter(outDir)

	// First domain succeeds; second errors on its second row.
	d1 := newFake("drives", `{"id":1}`, `{"id":2}`)
	d2 := newFake("charging", `{"id":10}`, `{"id":11}`)
	d2.nextErr = errBoom
	d2.errAt = 1
	d3 := newFake("settings", `{"k":"v"}`)

	res, err := e.Export(context.Background(), "job-err", []DomainExtractor{d1, d2, d3})
	if err == nil {
		t.Fatalf("expected error, got res=%v", res)
	}
	if !errors.Is(err, errBoom) {
		t.Errorf("error %v does not wrap errBoom", err)
	}
	if !strings.Contains(err.Error(), "domain charging") {
		t.Errorf("error %q missing failing domain context", err.Error())
	}
	// Every extractor must be closed exactly once, including the ones after the
	// failing domain that were never reached (regression: resource leak).
	for name, f := range map[string]*fakeExtractor{"d1": d1, "d2": d2, "d3": d3} {
		if f.closeCalls != 1 {
			t.Errorf("%s Close called %d times, want 1", name, f.closeCalls)
		}
	}
}

func TestExport_ContextCanceled(t *testing.T) {
	outDir := t.TempDir()
	e, _ := NewExporter(outDir)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	d := newFake("drives", `{"id":1}`, `{"id":2}`)
	res, err := e.Export(ctx, "job-ctx", []DomainExtractor{d})
	if err == nil {
		t.Fatalf("expected context error, got res=%v", res)
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("error %v does not wrap context.Canceled", err)
	}
	if d.closeCalls != 1 {
		t.Errorf("extractor Close called %d times, want 1", d.closeCalls)
	}
}

func TestExport_FileOpenError(t *testing.T) {
	outDir := t.TempDir()
	e, _ := NewExporter(outDir)

	// Occupy the bundle path with a directory so os.OpenFile(O_WRONLY) fails.
	if err := os.Mkdir(filepath.Join(outDir, "collide.tar.gz"), 0o755); err != nil {
		t.Fatalf("seed dir: %v", err)
	}

	d := newFake("drives", `{"id":1}`)
	res, err := e.Export(context.Background(), "collide", []DomainExtractor{d})
	if err == nil {
		t.Fatalf("expected open error, got res=%v", res)
	}
	if !strings.Contains(err.Error(), "gdpr: open") {
		t.Errorf("error %q missing %q", err.Error(), "gdpr: open")
	}
	// Even when the file never opened, the extractor we accepted must be closed.
	if d.closeCalls != 1 {
		t.Errorf("extractor Close called %d times, want 1", d.closeCalls)
	}
}

// ── Export: success round-trips ────────────────────────────────────────────

func TestExport_Success(t *testing.T) {
	tests := []struct {
		name      string
		jobID     string
		domains   map[string][]string // domain -> rows (insertion order below)
		order     []string
		wantRows  int64
		wantEmpty []string // domains expected to have zero rows
	}{
		{
			name:     "single domain",
			jobID:    "job-single",
			order:    []string{"drives"},
			domains:  map[string][]string{"drives": {`{"id":1}`, `{"id":2}`, `{"id":3}`}},
			wantRows: 3,
		},
		{
			name:  "multiple domains",
			jobID: "job-multi",
			order: []string{"vehicle", "drives", "charging", "signal_log"},
			domains: map[string][]string{
				"vehicle":    {`{"vin":"5YJ"}`},
				"drives":     {`{"id":1}`, `{"id":2}`},
				"charging":   {`{"id":9}`},
				"signal_log": {`{"s":"soc","v":80}`, `{"s":"soc","v":81}`, `{"s":"soc","v":82}`},
			},
			wantRows: 7,
		},
		{
			name:      "empty domain still emits entry",
			jobID:     "job-empty-domain",
			order:     []string{"drives", "charging"},
			domains:   map[string][]string{"drives": {`{"id":1}`}, "charging": {}},
			wantRows:  1,
			wantEmpty: []string{"charging"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			outDir := t.TempDir()
			e, err := NewExporter(outDir)
			if err != nil {
				t.Fatalf("NewExporter: %v", err)
			}

			extractors := make([]DomainExtractor, 0, len(tc.order))
			fakes := map[string]*fakeExtractor{}
			for _, d := range tc.order {
				f := newFake(d, tc.domains[d]...)
				fakes[d] = f
				extractors = append(extractors, f)
			}

			before := time.Now().Add(-time.Second)
			res, err := e.Export(context.Background(), tc.jobID, extractors)
			after := time.Now().Add(time.Second)
			if err != nil {
				t.Fatalf("Export: %v", err)
			}
			if res == nil {
				t.Fatal("expected non-nil result")
			}

			// Path + CreatedAt sanity.
			wantPath := filepath.Join(outDir, tc.jobID+".tar.gz")
			if res.Path != wantPath {
				t.Errorf("Path = %q, want %q", res.Path, wantPath)
			}
			if res.CreatedAt.Before(before) || res.CreatedAt.After(after) {
				t.Errorf("CreatedAt %v outside [%v,%v]", res.CreatedAt, before, after)
			}
			if res.RowCount != tc.wantRows {
				t.Errorf("RowCount = %d, want %d", res.RowCount, tc.wantRows)
			}

			// Every extractor closed exactly once.
			for d, f := range fakes {
				if f.closeCalls != 1 {
					t.Errorf("domain %s Close called %d times, want 1", d, f.closeCalls)
				}
			}

			// sha256 + byte count are the ground truth of the file on disk.
			rawBytes, err := os.ReadFile(res.Path)
			if err != nil {
				t.Fatalf("read bundle: %v", err)
			}
			sum := sha256.Sum256(rawBytes)
			if res.SHA256 != hex.EncodeToString(sum[:]) {
				t.Errorf("SHA256 = %s, want %s", res.SHA256, hex.EncodeToString(sum[:]))
			}
			if res.ByteCount != int64(len(rawBytes)) {
				t.Errorf("ByteCount = %d, want %d", res.ByteCount, len(rawBytes))
			}

			// Decompress + untar and verify entry order and content.
			gotOrder, files := readBundle(t, res.Path)
			wantOrder := make([]string, 0, len(tc.order)+1)
			for _, d := range tc.order {
				wantOrder = append(wantOrder, d+".jsonl")
			}
			wantOrder = append(wantOrder, "manifest.json")
			if strings.Join(gotOrder, ",") != strings.Join(wantOrder, ",") {
				t.Errorf("entry order = %v, want %v", gotOrder, wantOrder)
			}

			for _, d := range tc.order {
				var want bytes.Buffer
				for _, r := range tc.domains[d] {
					want.WriteString(r)
					want.WriteByte('\n')
				}
				if got := files[d+".jsonl"]; !bytes.Equal(got, want.Bytes()) {
					t.Errorf("domain %s content = %q, want %q", d, got, want.Bytes())
				}
			}

			// Per-domain stats in the result (data domains + a trailing manifest).
			if len(res.Domains) != len(tc.order)+1 {
				t.Fatalf("result Domains len = %d, want %d", len(res.Domains), len(tc.order)+1)
			}
			for i, d := range tc.order {
				st := res.Domains[i]
				if st.Domain != d {
					t.Errorf("Domains[%d].Domain = %q, want %q", i, st.Domain, d)
				}
				if st.RowCount != int64(len(tc.domains[d])) {
					t.Errorf("domain %s RowCount = %d, want %d", d, st.RowCount, len(tc.domains[d]))
				}
				if st.ByteCount != int64(len(files[d+".jsonl"])) {
					t.Errorf("domain %s ByteCount = %d, want %d", d, st.ByteCount, len(files[d+".jsonl"]))
				}
			}
			mStat := res.Domains[len(res.Domains)-1]
			if mStat.Domain != "manifest" || mStat.RowCount != 1 {
				t.Errorf("manifest stat = %+v, want domain=manifest rowCount=1", mStat)
			}

			// Verify empty domains produced a truly empty jsonl file.
			for _, d := range tc.wantEmpty {
				if len(files[d+".jsonl"]) != 0 {
					t.Errorf("expected empty jsonl for %s, got %d bytes", d, len(files[d+".jsonl"]))
				}
			}

			// Parse + validate the embedded manifest.json.
			var m manifestDoc
			if err := json.Unmarshal(files["manifest.json"], &m); err != nil {
				t.Fatalf("manifest unmarshal: %v", err)
			}
			if m.JobID != tc.jobID {
				t.Errorf("manifest job_id = %q, want %q", m.JobID, tc.jobID)
			}
			if m.Schema != "https://teslasync/schema/gdpr-bundle/v1" {
				t.Errorf("manifest schema = %q", m.Schema)
			}
			// The embedded manifest lists only data domains (not itself).
			if len(m.Domains) != len(tc.order) {
				t.Errorf("manifest domains len = %d, want %d", len(m.Domains), len(tc.order))
			}
			for i, d := range tc.order {
				if m.Domains[i].Domain != d {
					t.Errorf("manifest domain[%d] = %q, want %q", i, m.Domains[i].Domain, d)
				}
			}
		})
	}
}

func TestExport_NilContextDefaultsToBackground(t *testing.T) {
	outDir := t.TempDir()
	e, _ := NewExporter(outDir)
	d := newFake("drives", `{"id":1}`)

	//nolint:staticcheck // deliberately passing a nil context to verify the guard.
	res, err := e.Export(nil, "job-nilctx", []DomainExtractor{d})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res == nil || res.RowCount != 1 {
		t.Fatalf("unexpected result: %+v", res)
	}
	if d.lastCtx == nil {
		t.Error("expected Next to receive a non-nil context")
	}
}

func TestExport_OverwritesExistingBundle(t *testing.T) {
	outDir := t.TempDir()
	e, _ := NewExporter(outDir)
	path := filepath.Join(outDir, "reuse.tar.gz")

	// Pre-seed a stale file that O_TRUNC must replace.
	if err := os.WriteFile(path, bytes.Repeat([]byte("STALE"), 1024), 0o600); err != nil {
		t.Fatalf("seed: %v", err)
	}

	res, err := e.Export(context.Background(), "reuse", []DomainExtractor{newFake("drives", `{"id":1}`)})
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	raw, err := os.ReadFile(res.Path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if bytes.Contains(raw, []byte("STALE")) {
		t.Error("stale content survived overwrite")
	}
	if res.ByteCount != int64(len(raw)) {
		t.Errorf("ByteCount = %d, want %d", res.ByteCount, len(raw))
	}
}

// ── countingWriter ─────────────────────────────────────────────────────────

type erroringWriter struct {
	writeN int   // bytes to report as written before erroring
	err    error // error to return
}

func (w erroringWriter) Write(p []byte) (int, error) {
	return w.writeN, w.err
}

func TestCountingWriter(t *testing.T) {
	var buf bytes.Buffer
	cw := &countingWriter{w: &buf}

	n1, err := cw.Write([]byte("hello"))
	if err != nil || n1 != 5 {
		t.Fatalf("first write = (%d,%v), want (5,nil)", n1, err)
	}
	n2, err := cw.Write([]byte(" world"))
	if err != nil || n2 != 6 {
		t.Fatalf("second write = (%d,%v), want (6,nil)", n2, err)
	}
	if cw.n != 11 {
		t.Errorf("accumulated n = %d, want 11", cw.n)
	}
	if buf.String() != "hello world" {
		t.Errorf("buffer = %q, want %q", buf.String(), "hello world")
	}
}

func TestCountingWriter_PropagatesError(t *testing.T) {
	// A short write that also errors: the counter must add the bytes actually
	// written (2) and surface the underlying error unchanged.
	cw := &countingWriter{w: erroringWriter{writeN: 2, err: errBoom}}
	n, err := cw.Write([]byte("hello"))
	if !errors.Is(err, errBoom) {
		t.Errorf("err = %v, want errBoom", err)
	}
	if n != 2 {
		t.Errorf("returned n = %d, want 2", n)
	}
	if cw.n != 2 {
		t.Errorf("accumulated n = %d, want 2", cw.n)
	}
}
