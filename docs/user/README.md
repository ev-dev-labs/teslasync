# Help corpus

This directory contains focused help articles for Helix. Its Markdown is
compiled into the TeslaSync binary with the rest of the maintained
documentation and searched locally by Helix Chat's BM25-style application
knowledge retriever.

Published user-facing documentation lives one level up under `docs/` and is
rendered by VitePress. Helix Chat can retrieve both that reference material and
the concise articles kept here.

## Why it's separate from the rest of the docs

The published docs site (`docs/index.md`, `docs/guide/`, `docs/features/`, `docs/deployment/`, `docs/contributing/`) is a curated, navigable reference. It assumes a human reader who can use the sidebar and the search bar.

The chatbot corpus is a different shape of writing:

- Short, self-contained answers
- Heavy on "what to do when …" / "why is X happening" framing
- Anchored to specific UI moments ("after you turn on Sentry Mode", "when a drive ends")
- No assumed prior context — the retriever pulls one chunk and the model answers from it

Keeping the focused articles separate avoids filling the published site with
"the user just asked ..." fragments while still letting the same local
retriever rank both collections.

## What goes here

- **Markdown only.** The indexer skips every other extension. Code samples are fine, but the surrounding prose is the part that gets embedded.
- **One topic per file.** Easier to retrieve, easier to maintain. A 5-page essay is worse than 5 focused files.
- **Filenames are part of the source ID.** `charging-quickstart.md` becomes
  `user/charging-quickstart.md`, the stable identifier Helix cites when it
  grounds an answer.
- **Front matter is allowed.** The indexer treats the file as plain text either way; front matter doesn't help or hurt retrieval.
- **Hidden files and partials are skipped.** Filenames starting with `.` or `_` are ignored — useful for drafts and shared snippets that aren't standalone answers.

## How retrieval works

The embedded retriever lives in `internal/ai/rag/`. The contract is:

1. `docs/embed.go` packages maintained Markdown into the API binary at build
   time.
2. On API startup, `LexicalDocsRetriever` walks the embedded filesystem and
   splits every file into bounded chunks.
3. The source ID is the slash-normalised path under `docs/`, such as
   `user/charging-quickstart.md`.
4. Retrieval ranks chunks in memory with BM25-style term relevance and a
   source-path boost.
5. The selected text and source IDs are passed to the active chat provider;
   no embedding request or vector-database query is needed.

The separate `rag-help` feature can still use the configurable pgvector
retriever. Helix Chat's `retrieve_app_knowledge` tool does not depend on that
feature, its toggle, or its embedding provider.

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
- A deploy rebuilds the embedded corpus; there is no runtime indexing job or
  embedding cost for Chat application knowledge.
- If retrieval finds no relevant chunk, Helix states that the knowledge base
  has no match rather than answering from model memory.
- Provider choice affects narration quality, while retrieval remains local and
  deterministic.

## Where to learn more

- `docs/embed.go` — the embedded Markdown corpus
- `internal/ai/rag/lexical_docs.go` — local indexing and ranking
- `internal/ai/rag/chunker.go` — bounded Markdown chunking
- [Helix AI](../guide/helix-ai.md) — how the chatbot fits into the broader AI layer
