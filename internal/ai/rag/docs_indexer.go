package rag

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"strings"

	"github.com/rs/zerolog/log"
)

// IndexDocs walks fsys rooted at `root` and indexes every Markdown
// (`*.md` / `*.markdown`) file under [SourceDocs]. Each file becomes
// one source — the file's path-relative-to-root is the source_id.
//
// Non-Markdown files, hidden files, and directories named `_*` (a
// VitePress convention for partials) are skipped silently so a
// future docs reorganisation doesn't accidentally embed
// build artifacts.
//
// Returns the number of files indexed (NOT the number of chunks),
// useful for boot-log lines like "indexed 47 docs".
//
// IndexDocs is a pure library function — it does NOT decide WHEN to
// run. F7 ships only the function; the actual scheduling lives in
// N6's RAG-help slice where the per-feature gate is registered.
// Calling IndexDocs against a [NoopRetriever] is a no-op (every
// Index call returns nil after validation), so a slice can wire it
// behind any feature flag without an off-mode branch here.
//
// The userSubject argument is "" for global docs (matches the
// single-tenant DEFAULT in migration 000206). N6 may pass a real
// subject if it later supports per-user doc corpora.
func IndexDocs(
	ctx context.Context,
	retriever Retriever,
	fsys fs.FS,
	root string,
	userSubject string,
) (int, error) {
	if retriever == nil {
		return 0, fmt.Errorf("rag: IndexDocs called with nil retriever")
	}
	if fsys == nil {
		return 0, fmt.Errorf("rag: IndexDocs called with nil fsys")
	}
	if root == "" {
		root = "."
	}

	indexed := 0
	walkErr := fs.WalkDir(fsys, root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// fs.WalkDir invokes the callback with the open error
			// for unreadable directories. Bail loudly — silently
			// indexing only the readable subset would produce a
			// half-corpus that's worse than no corpus.
			return fmt.Errorf("rag: walk %s: %w", path, err)
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if d.IsDir() {
			// Skip VitePress partial directories.
			name := d.Name()
			if name != "." && name != ".." && strings.HasPrefix(name, "_") {
				return fs.SkipDir
			}
			// Skip hidden directories (.git, .vitepress).
			if strings.HasPrefix(name, ".") && name != "." {
				return fs.SkipDir
			}
			return nil
		}

		// File filter — Markdown only.
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if ext != ".md" && ext != ".markdown" {
			return nil
		}
		if strings.HasPrefix(d.Name(), "_") || strings.HasPrefix(d.Name(), ".") {
			return nil
		}

		body, err := fs.ReadFile(fsys, path)
		if err != nil {
			return fmt.Errorf("rag: read %s: %w", path, err)
		}
		if len(body) == 0 {
			return nil
		}

		chunks := ChunkText(string(body), DefaultChunkBytes)
		if len(chunks) == 0 {
			return nil
		}

		// source_id is the slash-normalised relative path so the
		// same source survives a Windows / Unix host swap.
		sourceID, err := filepath.Rel(root, path)
		if err != nil {
			sourceID = path
		}
		sourceID = filepath.ToSlash(sourceID)

		if err := retriever.Index(ctx, userSubject, SourceDocs, sourceID, chunks); err != nil {
			// Record but keep walking — one bad doc shouldn't
			// abort the whole corpus. A subsequent retry will
			// pick up the file once the upstream issue (provider
			// error, vector-dim mismatch) is fixed.
			log.Warn().Err(err).
				Str("source_id", sourceID).
				Int("chunks", len(chunks)).
				Msg("rag: index doc failed (skipping)")
			return nil
		}
		indexed++
		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, fs.ErrNotExist) {
		return indexed, walkErr
	}
	return indexed, nil
}
