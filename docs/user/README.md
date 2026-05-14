# TeslaSync User Documentation

This directory holds the user-facing help corpus that the in-app
help chatbot indexes for retrieval-augmented generation (RAG).

## Status

Phase-50 / F7 ships the embedding pipeline (`internal/ai/rag/`) and
the documentation indexer (`rag.IndexDocs`). Actual ingestion is
gated behind the per-feature `app-help-rag` toggle, which is
registered by Phase-50 / N6 (RAG help chatbot). Until N6 lands,
this directory is intentionally minimal — the indexer is wired but
not invoked.

## What goes here

- Markdown (`*.md`) only — the indexer skips every other extension.
- One file per feature page (charging, drives, alerts, settings, …).
- Front matter is allowed but not required; the indexer treats the
  file as plain text.
- Files prefixed with `_` (VitePress partials) and hidden files
  (`.foo.md`) are skipped.

## How indexing works

1. The indexer walks this directory at boot (when N6 enables it).
2. Each Markdown file becomes one source under `source_type='docs'`.
3. The file's slash-normalised path-relative-to-`docs/user/` is the
   `source_id` (so `charging/quickstart.md` survives a Windows ↔
   Unix host swap).
4. Re-indexing is idempotent — content hashes prevent re-embed of
   unchanged files.

See `internal/ai/rag/docs_indexer.go` for the implementation and
`.github/prompts/db-refactor/phase-50-ai-adoption/0008-F7-embeddings-pgvector.prompt.md`
for the slice contract.
