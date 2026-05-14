---
description: "Phase-50 / Prompt 0008 — F7: Embeddings + pgvector RAG"
---

# Phase-50 / Prompt 0008 — F7: Embeddings + pgvector RAG

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | .github/prompts/db-refactor/logs/phase-50-0008-F7-embeddings-pgvector.log |
| Depends-on | See this prompt header and Phase-50 methodology. |
| Allowed files to change | See the **Allowed files** section below; methodology-only edits may change only Phase-50 prompt/ADR artifacts. |

## Honesty Covenant

1. No red-as-green - EXIT != 0 -> STATUS=BLOCKED, no exceptions
2. No scope narrowing - run the exact gate command, no subsets
3. No skip-and-assume - can't run gate -> BLOCKED, never DONE
4. No field resurrection - don't add back deleted fields to "fix" things
5. No stubs - no eturn nil, // TODO, panic("not impl")
6. No delegation - NO sub-agents, NO parallel, NO background tasks
7. No predecessor bypass - verify predecessor STATUS=DONE first
8. No commit on red - commit only the log when BLOCKED
9. No silent drift - git status outside allowed files -> BLOCKED
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on own lines

## Logging Requirements

The slice log MUST include these sections, in order:

| Section | Purpose |
|---|---|
| === PREFLIGHT === | Branch, predecessor logs, and dirty-tree check. |
| === SURVEY === | Files, routes, DTOs, hooks, registry entries, and baseline behavior inspected before edits. |
| === REASONING === | Why the selected design preserves ADR-015 and the Phase-50 methodology. |
| === CHANGES === | Summary of production, test, registry, i18n, prompt, and golden changes. |
| === GATE === | Full command transcripts with EXIT markers. |
| === COMMIT === | git add/commit transcript, or blocked-log-only commit transcript. |
| === AI-OFF CONTRACT === | ADR-015 footer with evidence for every invariant this slice touches. |
| === STATUS === | Final EXIT=<int> and STATUS=<DONE|BLOCKED> markers on their own lines. |

## Problem

This Phase-50 foundation or gate prompt must preserve ADR-015: AI is additive, default-off, and every non-AI baseline remains available. Execute the slice without adding unguarded AI surfaces, duplicate provider logic, raw SQL mutation paths, or hidden egress.

## Action Steps

1. Read ADR-015 and this prompt before making any changes.
2. Verify predecessor logs and branch state in === PREFLIGHT ===.
3. Survey the current code and document the baseline in === SURVEY === before editing.
4. Make only the changes allowed by this prompt and preserve the non-AI baseline.
5. Run every verification command exactly as written and paste raw output into === GATE ===.
6. If any gate fails, stop with STATUS=BLOCKED and commit only the log.

## Gate

The prompt is DONE only if every required verification command exits 0, the log contains EXIT=0 and STATUS=DONE on their own lines, the ADR-015 footer is present with evidence, and git status --short contains only allowed files before commit.

## Commit

Use a conventional commit for this slice and include the required trailer:

~~~text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
~~~

## Blocked Path

If a predecessor is missing, verification cannot run, or any gate fails, write the log with:

~~~text
=== STATUS ===
EXIT=1
STATUS=BLOCKED
~~~

Commit only the blocked log and include the command output that proves the blocker.

> **Depends on:** F0, F1, F2 (settings), F3 (audit covers Embed too)
> **Patterns:** P7 (single Retrieve entry), R5 (TTL by source), R10 (version check), D14 (model defaults)

## Why

Several features need similarity search: NL alert search (find
"alerts about charging issues"), RAG-backed help chatbot (cite docs),
trip-history Q&A ("what was that scenic detour last June?"), drive-
coaching narrative anchors. Building per-feature embedding stores
would multiply infra and break P7. This slice ships the single
canonical retrieval surface.

## Design

### D8.1 pgvector enablement + sanity check (R10)

Migration `000200_enable_vector.up.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
DECLARE v TEXT;
BEGIN
  SELECT extversion INTO v FROM pg_extension WHERE extname='vector';
  IF v IS NULL OR v < '0.5.0' THEN
    RAISE EXCEPTION 'pgvector >= 0.5.0 required (HNSW); found %', v;
  END IF;
END $$;
```

App start-up runs `SELECT extversion FROM pg_extension WHERE extname='vector'` and logs WARN if < 0.7 (HNSW still works on 0.5+, 0.7 enables IVFFlat tuning improvements).

### D8.2 Embeddings table

`000201_embeddings.up.sql`:

```sql
CREATE TABLE embeddings (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type   TEXT        NOT NULL,    -- "drive_summary"|"alert_history"|"docs"|"charge_session"|"automation_run"|...
    source_id     TEXT        NOT NULL,    -- domain key
    chunk_idx     INT         NOT NULL DEFAULT 0,
    text          TEXT        NOT NULL,    -- post-redaction (F8 hook)
    text_hash     TEXT        NOT NULL,    -- sha256 of text
    embedding     VECTOR(768) NOT NULL,    -- nomic-embed-text dim
    model         TEXT        NOT NULL,    -- e.g. "nomic-embed-text" or "text-embedding-3-small"
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL     -- TTL (R5), set per source_type policy
);

CREATE UNIQUE INDEX embeddings_dedupe_idx
  ON embeddings (user_id, source_type, source_id, chunk_idx, model);

CREATE INDEX embeddings_hnsw_idx
  ON embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX embeddings_user_source_idx
  ON embeddings (user_id, source_type);

CREATE INDEX embeddings_expires_idx
  ON embeddings (expires_at);
```

OpenAI's `text-embedding-3-small` is 1536-dim — store in a separate
table `embeddings_1536` with the same shape to avoid mixing
dimensions in one table. Retrieve API picks the right table based on
the configured model.

### D8.3 TTL policy per source_type (R5)

```go
var TTLPolicy = map[string]time.Duration{
    "drive_summary":   90 * 24 * time.Hour,   // 90d
    "charge_session":  90 * 24 * time.Hour,
    "alert_history":   30 * 24 * time.Hour,
    "automation_run":  30 * 24 * time.Hour,
    "docs":            0,                      // never expire (pinned to release)
    "user_note":       365 * 24 * time.Hour,
}
```

A daily cron deletes expired rows + re-embeds anything that's been
soft-edited since last embed (via `text_hash` mismatch check).

### D8.4 Single Retrieve entry (P7)

`internal/ai/rag/rag.go`:

```go
type Chunk struct {
    SourceType string
    SourceID   string
    ChunkIdx   int
    Text       string
    Score      float32   // cosine similarity 0..1
}

type Retriever interface {
    Retrieve(ctx context.Context, userID int64, query string, sourceTypes []string, k int) ([]Chunk, error)
    Index(ctx context.Context, userID int64, sourceType, sourceID string, chunks []string) error
    Forget(ctx context.Context, userID int64, sourceType, sourceID string) error
}
```

`Retrieve` workflow:
1. Embed query via configured Embed provider.
2. SQL: `SELECT ... FROM embeddings WHERE user_id=$1 AND source_type = ANY($2) ORDER BY embedding <=> $3 LIMIT k`.
3. Return chunks with cosine scores.

`Index` workflow:
1. Skip if `(user_id, source_type, source_id, chunk_idx, model)` exists with matching `text_hash`.
2. Otherwise embed + UPSERT.

### D8.5 Indexers (background workers)

One indexer per source_type, scheduled by feature need (NOT all
upfront — lazy on first Retrieve to avoid pre-emptive cost). Each
indexer:
1. Reads from the canonical domain table (drives, charges, alerts).
2. Calls `Index` with redacted text (F8 will plug in here).
3. Logs to `ai_call_log` via the audit decorator.

This slice ships only `docs` indexer (which embeds the user-facing
help docs at boot for the RAG-backed chatbot in N6). Other indexers
ship with their consuming feature slice.

### D8.6 Off-mode

`ai_mode='off'` ⇒ `Retriever` constructor returns a no-op
implementation that returns `nil, nil`. Indexers don't start. The
embeddings table remains empty for that user.

## Tasks

1. Migrations (vector extension, embeddings, embeddings_1536).
2. Repo + tests (with pgtest container).
3. `Retriever` + no-op + tests.
4. Docs indexer + tests; embeds `docs/user/**/*.md` at boot.
5. TTL cron job (`internal/jobs/embeddings_ttl.go`).
6. Wire the no-op vs real switch in `app.New()` based on
   `ai_mode`.

## Allowed files

- `migrations/000200_*.up.sql`, `.down.sql`
- `migrations/000201_*.up.sql`, `.down.sql`
- `internal/ai/rag/**`
- `internal/jobs/embeddings_ttl.go` (+ test)
- `internal/app/new.go` (constructor switch)
- `docs/user/` (existing dir, indexer reads from here)

## Verification

```
goose up
go test -race ./internal/ai/rag/...
go test -race ./internal/jobs/... -run Embeddings

psql -c "SELECT extname, extversion FROM pg_extension WHERE extname='vector';"
# expect: 0.5.0+
```

## Deliverable

Log + ADR-015 footer (I4 confirmed: with mode=off, embeddings table
row count for that user = 0).

## Forward dependency

- N6 (RAG help chatbot) consumes Retrieve.
- N3 (NL search) consumes Retrieve.
- D2/D5/C4 may consume Retrieve.

