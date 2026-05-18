# Help corpus

This directory is the **help corpus** for the Helix chatbot. Every markdown file under `docs/user/` is a source the chatbot can ground its answers in — retrieval-augmented generation (RAG) backed by pgvector.

If you're writing documentation for the published user-facing site, that lives one level up under `docs/` and is rendered by VitePress. This directory is for the chatbot only.

## Why it's separate from the rest of the docs

The published docs site (`docs/index.md`, `docs/guide/`, `docs/features/`, `docs/deployment/`, `docs/contributing/`) is a curated, navigable reference. It assumes a human reader who can use the sidebar and the search bar.

The chatbot corpus is a different shape of writing:

- Short, self-contained answers
- Heavy on "what to do when …" / "why is X happening" framing
- Anchored to specific UI moments ("after you turn on Sentry Mode", "when a drive ends")
- No assumed prior context — the retriever pulls one chunk and the model answers from it

Mixing the two would produce a published site full of "the user just asked …" fragments and a chatbot grounded in essays it can't usefully retrieve from. Two corpora, two indexers, two audiences.

## What goes here

- **Markdown only.** The indexer skips every other extension. Code samples are fine, but the surrounding prose is the part that gets embedded.
- **One topic per file.** Easier to retrieve, easier to maintain. A 5-page essay is worse than 5 focused files.
- **Filenames are part of the source ID.** `charging/quickstart.md` becomes the stable identifier the chatbot cites when it grounds an answer.
- **Front matter is allowed.** The indexer treats the file as plain text either way; front matter doesn't help or hurt retrieval.
- **Hidden files and partials are skipped.** Filenames starting with `.` or `_` are ignored — useful for drafts and shared snippets that aren't standalone answers.

## How indexing works

The indexer lives in `internal/ai/rag/`. The contract is:

1. On boot (when the chatbot feature is enabled), the indexer walks this directory.
2. Each markdown file is turned into one source row under `source_type='docs'`.
3. The `source_id` is the **slash-normalised** path relative to `docs/user/` — `charging/quickstart.md`, not `charging\quickstart.md`. This makes the IDs stable across Windows ↔ Unix host swaps.
4. Each file is chunked, embedded with the configured embedding model, and stored in `ai_embeddings` (pgvector).
5. Re-indexing is **idempotent**. Content hashes prevent re-embedding of unchanged files. A re-index after a doc edit only embeds the files that changed.

The chatbot's retrieval step queries `ai_embeddings` for the top-k chunks by cosine similarity, joins back to the source rows for citation metadata, and presents the model with both the user's question and the retrieved chunks.

## Writing for retrieval

Good chatbot answers come from chunks that:

- **Stand alone.** If a chunk is retrieved without its neighbours, the model still has enough to answer.
- **Lead with the question.** The first paragraph should mention the situation the user is in. "When you turn on Sentry Mode …", "If a drive shows zero distance …".
- **Are specific.** "Tap **Settings → Vehicle → Charging** then …" beats "go to the settings page and find the charging option".
- **Quote the UI.** When a button is called **Connect Tesla**, write **Connect Tesla** — exact strings retrieve better than paraphrases.

What doesn't retrieve well:

- Tables of options with no surrounding prose (the table cells embed as fragments)
- Long backstories before the answer
- Heavy cross-referencing — chunks lose their neighbours; relative references go stale

If you're writing a help article and find yourself thinking "this needs three pages of context", that's a signal it belongs in the published docs, not the chatbot corpus.

## Where the chatbot fits in Helix

The chatbot is one Helix feature among many — registered as `chatbot-llm` in `internal/ai/features/registry.go`, wired through the standard decorator chain (trace → audit → cost → ratelimit → redact), and gated by the same off-by-default per-user toggle every Helix feature has. If a user hasn't opted in, the chatbot is invisible and this corpus is never read.

The full Helix reference: [Helix AI](../guide/helix-ai.md).

## Operational notes

- The corpus is **read-only at runtime** for the API. Edits happen at build time (you write markdown, commit, deploy).
- After a deploy, the indexer detects changed files via content hash and re-embeds only those.
- An empty corpus is valid. The chatbot will still function but won't ground its answers in your docs — it'll answer from its general training.
- Provider matters less than corpus quality. A small embedding model on a good corpus beats a large model on a sparse one.

## Where to learn more

- `internal/ai/rag/docs_indexer.go` — the walker + chunker + embed loop
- `internal/ai/rag/retriever.go` — the query-time retrieval path
- `migrations/*_embeddings.up.sql` — the pgvector schema
- [Helix AI](../guide/helix-ai.md) — how the chatbot fits into the broader AI layer
