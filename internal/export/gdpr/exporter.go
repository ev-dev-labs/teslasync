// Package gdpr produces GDPR data-subject export bundles.
//
// A bundle is a streamed tar.gz of one JSONL file per data domain
// (vehicle, drives, charging, signal_log, settings). Bytes are
// streamed directly to disk (StorageKindLocalFS) or S3 — NEVER
// buffered in memory and NEVER stored as a BYTEA column.
//
// The exporter is deliberately schema-agnostic: callers register
// DomainExtractor functions that yield rows; the bundle layout is
// fixed by this package. This keeps internal/database from importing
// archive/tar and keeps domain repos focused on their own queries.
package gdpr

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// DomainExtractor yields rows for one data domain. The implementation
// MUST stream — buffering 1M signal_log rows for a 10-year-old
// vehicle would OOM the worker. Each call to Next returns one row as
// JSON-marshallable bytes (or io.EOF when done).
type DomainExtractor interface {
	// Domain returns the domain name (lowercased; used in the bundle
	// filename, e.g. "drives" → "drives.jsonl").
	Domain() string
	// Next yields the next row, io.EOF when exhausted.
	Next(ctx context.Context) ([]byte, error)
	// Close releases any DB cursors / row iterators.
	Close() error
}

// BundleResult is the outcome reported back to the export job manifest.
type BundleResult struct {
	Path      string
	SHA256    string
	ByteCount int64
	RowCount  int64
	CreatedAt time.Time
	Domains   []DomainStat
}

// DomainStat is the per-domain row + byte count, for the bundle manifest.
type DomainStat struct {
	Domain    string `json:"domain"`
	RowCount  int64  `json:"row_count"`
	ByteCount int64  `json:"byte_count"`
}

// Exporter writes the bundle. Each instance is one-shot.
type Exporter struct {
	outDir string
}

// NewExporter constructs an exporter that writes under outDir.
// outDir is created (mkdir -p) if missing.
func NewExporter(outDir string) (*Exporter, error) {
	if outDir == "" {
		return nil, errors.New("gdpr: outDir is required")
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return nil, fmt.Errorf("gdpr: mkdir %s: %w", outDir, err)
	}
	return &Exporter{outDir: outDir}, nil
}

// validateJobID rejects a jobID that is empty or that would let the bundle
// escape outDir. The jobID becomes the bundle filename (<jobID>.tar.gz), so it
// MUST be a single, clean path segment. Without this, a caller-supplied jobID
// like "../../etc/cron.d/x" would traverse out of outDir on Join.
func validateJobID(jobID string) error {
	if jobID == "" {
		return errors.New("gdpr: jobID is required")
	}
	if !isSafeSegment(jobID) {
		return fmt.Errorf("gdpr: invalid jobID %q: must be a single path segment", jobID)
	}
	return nil
}

// isSafeSegment reports whether s is a single, non-escaping path segment safe
// to use as a filename: no path separators, no volume name, and not "." / "..".
func isSafeSegment(s string) bool {
	if s == "" || s == "." || s == ".." {
		return false
	}
	if strings.ContainsAny(s, `/\`) {
		return false
	}
	if filepath.VolumeName(s) != "" {
		return false
	}
	// A clean single segment equals its own Base.
	return filepath.Base(s) == s
}

// Export streams every extractor into a single gzipped tar archive
// at <outDir>/<jobID>.tar.gz, computing sha256 incrementally so we
// don't have to re-read the file at the end.
//
// On error the partial file is left in place for diagnosis — the
// caller decides whether to delete it (the export FSM Failed state
// triggers the cleanup worker).
func (e *Exporter) Export(ctx context.Context, jobID string, extractors []DomainExtractor) (*BundleResult, error) {
	if e == nil {
		return nil, errors.New("gdpr: nil exporter")
	}
	if err := validateJobID(jobID); err != nil {
		return nil, err
	}
	if len(extractors) == 0 {
		return nil, errors.New("gdpr: at least one extractor required")
	}
	for i, ext := range extractors {
		if ext == nil {
			return nil, fmt.Errorf("gdpr: extractor %d is nil", i)
		}
	}
	if ctx == nil {
		ctx = context.Background()
	}

	// Own every extractor from here on: close each exactly once, even if we
	// bail out early. Without this, a failure on domain N would leak the DB
	// cursors held by domains N+1… that were never reached.
	closed := make([]bool, len(extractors))
	defer func() {
		for i, ext := range extractors {
			if !closed[i] {
				_ = ext.Close()
			}
		}
	}()

	path := filepath.Join(e.outDir, jobID+".tar.gz")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return nil, fmt.Errorf("gdpr: open %s: %w", path, err)
	}

	hasher := sha256.New()
	counted := &countingWriter{w: io.MultiWriter(f, hasher)}
	gzw := gzip.NewWriter(counted)
	tarw := tar.NewWriter(gzw)

	res := &BundleResult{
		Path:      path,
		CreatedAt: time.Now().UTC(),
		Domains:   make([]DomainStat, 0, len(extractors)+1),
	}

	closeAll := func(cause error) error {
		if cause == nil {
			if err := tarw.Close(); err != nil {
				cause = fmt.Errorf("gdpr: tar close: %w", err)
			}
			if cause == nil {
				if err := gzw.Close(); err != nil {
					cause = fmt.Errorf("gdpr: gzip close: %w", err)
				}
			}
		} else {
			_ = tarw.Close()
			_ = gzw.Close()
		}
		if err := f.Sync(); err != nil && cause == nil {
			cause = fmt.Errorf("gdpr: fsync: %w", err)
		}
		if err := f.Close(); err != nil && cause == nil {
			cause = fmt.Errorf("gdpr: close: %w", err)
		}
		return cause
	}

	for i, ext := range extractors {
		stat, err := writeDomainEntry(ctx, tarw, ext)
		_ = ext.Close()
		closed[i] = true
		if err != nil {
			return nil, closeAll(fmt.Errorf("gdpr: domain %s: %w", ext.Domain(), err))
		}
		res.Domains = append(res.Domains, stat)
		res.RowCount += stat.RowCount
	}

	// Manifest is the last entry so it can include all per-domain stats.
	manifestStat, err := writeManifestEntry(tarw, jobID, res)
	if err != nil {
		return nil, closeAll(err)
	}
	res.Domains = append(res.Domains, manifestStat)

	if err := closeAll(nil); err != nil {
		return nil, err
	}

	// Stat the file for the final byte count — the counted writer's
	// running total is also valid but stat is the ground truth.
	st, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("gdpr: stat: %w", err)
	}
	res.ByteCount = st.Size()
	res.SHA256 = hex.EncodeToString(hasher.Sum(nil))
	return res, nil
}

// writeDomainEntry writes one JSONL stream into the tar archive. The
// returned DomainStat counts JSONL bytes (not tar overhead).
func writeDomainEntry(ctx context.Context, tarw *tar.Writer, ext DomainExtractor) (DomainStat, error) {
	domain := ext.Domain()
	if !isSafeSegment(domain) {
		return DomainStat{}, fmt.Errorf("invalid domain name %q", domain)
	}
	// Tar format requires the entry size up-front. Since we're
	// streaming we don't know the size, so we use a temp file as
	// a length-prefix buffer. Acceptable because per-domain
	// extracts are bounded by the user's data (typically <100MB
	// for signal_log over many years).
	tmp, err := os.CreateTemp("", "gdpr-domain-*.jsonl")
	if err != nil {
		return DomainStat{}, err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()

	var rowCount, byteCount int64
	for {
		select {
		case <-ctx.Done():
			return DomainStat{}, ctx.Err()
		default:
		}
		row, err := ext.Next(ctx)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return DomainStat{}, err
		}
		if _, err := tmp.Write(row); err != nil {
			return DomainStat{}, err
		}
		if _, err := tmp.Write([]byte("\n")); err != nil {
			return DomainStat{}, err
		}
		rowCount++
		byteCount += int64(len(row)) + 1
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return DomainStat{}, err
	}
	hdr := &tar.Header{
		Name:    domain + ".jsonl",
		Mode:    0o600,
		Size:    byteCount,
		ModTime: time.Now().UTC(),
	}
	if err := tarw.WriteHeader(hdr); err != nil {
		return DomainStat{}, err
	}
	if _, err := io.Copy(tarw, tmp); err != nil {
		return DomainStat{}, err
	}
	return DomainStat{Domain: domain, RowCount: rowCount, ByteCount: byteCount}, nil
}

// writeManifestEntry writes a manifest.json describing the bundle
// contents — operators (and the data subject) can read it to know
// exactly what each .jsonl file contains.
func writeManifestEntry(tarw *tar.Writer, jobID string, res *BundleResult) (DomainStat, error) {
	manifest := struct {
		JobID     string       `json:"job_id"`
		CreatedAt time.Time    `json:"created_at"`
		Schema    string       `json:"schema"`
		Domains   []DomainStat `json:"domains"`
	}{
		JobID:     jobID,
		CreatedAt: res.CreatedAt,
		Schema:    "https://teslasync/schema/gdpr-bundle/v1",
		Domains:   res.Domains,
	}
	body, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return DomainStat{}, fmt.Errorf("gdpr: marshal manifest: %w", err)
	}
	hdr := &tar.Header{
		Name:    "manifest.json",
		Mode:    0o600,
		Size:    int64(len(body)),
		ModTime: time.Now().UTC(),
	}
	if err := tarw.WriteHeader(hdr); err != nil {
		return DomainStat{}, err
	}
	if _, err := tarw.Write(body); err != nil {
		return DomainStat{}, err
	}
	return DomainStat{Domain: "manifest", RowCount: 1, ByteCount: int64(len(body))}, nil
}

// countingWriter tracks bytes written through it. Used to compute the
// running byte count without seeking the underlying file.
type countingWriter struct {
	w io.Writer
	n int64
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.n += int64(n)
	return n, err
}
