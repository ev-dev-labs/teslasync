package rag

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ProviderResolver is the narrow view of [provider.Registry] the
// retriever depends on. The registry implements [For] which returns
// a fully decorated provider (audit + trace + redact + rate-limit +
// cost-cap once F8/F9 land); going through this interface ensures
// EVERY embed call lands in ai_call_log and respects the per-feature
// gate — the retriever can never bypass the audit chain by holding a
// stale provider reference.
//
// The interface is satisfied by *provider.Registry directly. Tests
// supply a fake that returns a [provider.Mock] without the registry
// dependency.
type ProviderResolver interface {
	For(ctx context.Context, featureID string) (provider.Provider, error)
}

// PgvectorRetriever is the production [Retriever] implementation.
// Instances are constructed via [New] (which short-circuits to
// [NoopRetriever] when ai_mode='off'); construct directly only in
// tests where you want to skip the off-mode gate.
//
// The struct holds:
//   - db        : the pgx pool used for both read and write paths.
//   - providers : resolver that returns the audited provider chain
//     on every call (re-resolution per call lets a
//     settings update take effect without a restart).
//   - featureID : the registry feature ID this retriever was built
//     for. Used to (a) gate the resolver call, and (b)
//     stamp ai_call_log rows via WithFeatureID(ctx).
//   - model     : the embedding model name (e.g. "nomic-embed-text").
//   - dim       : the vector dimensionality derived from model.
//   - table     : the physical table name picked by [tableForDim].
//
// All fields are immutable after construction; the struct is safe
// for concurrent use across goroutines.
type PgvectorRetriever struct {
	db        *database.DB
	providers ProviderResolver
	featureID string
	model     string
	dim       int
	table     string
}

// NewPgvectorRetriever constructs a PgvectorRetriever for the named
// embedding model. Returns [ErrUnknownModel] if the model is not
// registered in [modelDims]. The factory ([New]) is the production
// caller; tests use this directly to bypass the off-mode gate.
//
// Pre-conditions:
//   - db        : non-nil. A nil pool is a programmer error and
//     panics rather than fail at the first query.
//   - providers : non-nil. Same rationale.
//   - featureID : non-empty. The audit decorator records this on
//     every embed call; an empty string would attribute
//     the spend to "no feature" and confuse the usage
//     card.
//   - model     : must be present in [modelDims].
func NewPgvectorRetriever(
	db *database.DB,
	providers ProviderResolver,
	featureID string,
	model string,
) (*PgvectorRetriever, error) {
	if db == nil {
		panic("rag: NewPgvectorRetriever called with nil db")
	}
	if providers == nil {
		panic("rag: NewPgvectorRetriever called with nil providers")
	}
	if featureID == "" {
		return nil, fmt.Errorf("rag: featureID required")
	}
	dim, ok := DimFor(model)
	if !ok {
		return nil, fmt.Errorf("%w: %q (known: %v)", ErrUnknownModel, model, KnownModels())
	}
	table := tableForDim(dim)
	if table == "" {
		// Defence in depth: DimFor returned an entry, but the
		// physical table for that dim is unknown. Means modelDims
		// added a new dim without a matching migration — fail
		// closed at construction so the bug is impossible to ship.
		return nil, fmt.Errorf("rag: model %q has dim %d with no table; add a migration", model, dim)
	}
	return &PgvectorRetriever{
		db:        db,
		providers: providers,
		featureID: featureID,
		model:     model,
		dim:       dim,
		table:     table,
	}, nil
}

// withProviderCtx wraps ctx with the audit decorator's required
// keys. Every embed call MUST go through this — the audit decorator
// reads the subject + feature off ctx; missing keys produce
// "no feature" rows in ai_call_log.
func (p *PgvectorRetriever) withProviderCtx(ctx context.Context, userSubject string) context.Context {
	ctx = provider.WithSubject(ctx, userSubject)
	ctx = provider.WithFeatureID(ctx, p.featureID)
	return ctx
}

// embed batches one or more strings into vectors, validating that
// every returned vector matches the configured dimension. Wraps
// dimension drift (a misconfigured provider that emits 1024-dim
// vectors when we expect 768) into [ErrDimMismatch] before any
// SQL touches.
func (p *PgvectorRetriever) embed(ctx context.Context, userSubject string, inputs []string) ([][]float32, error) {
	prov, err := p.providers.For(ctx, p.featureID)
	if err != nil {
		// The registry returns ErrProviderDisabled / ErrFeatureDisabled
		// when the gate flips between construction and call; bubble
		// up unchanged so the caller can distinguish "off" from a
		// real failure.
		return nil, fmt.Errorf("rag: resolve provider: %w", err)
	}
	resp, err := prov.Embed(p.withProviderCtx(ctx, userSubject), provider.EmbedRequest{
		Model: p.model,
		Input: inputs,
	})
	if err != nil {
		return nil, fmt.Errorf("rag: embed (%s/%s): %w", prov.Name(), p.model, err)
	}
	if resp == nil {
		return nil, fmt.Errorf("rag: embed (%s/%s): nil response", prov.Name(), p.model)
	}
	if got := len(resp.Vectors); got != len(inputs) {
		return nil, fmt.Errorf("rag: provider returned %d vectors for %d inputs", got, len(inputs))
	}
	for i, v := range resp.Vectors {
		if len(v) != p.dim {
			return nil, fmt.Errorf("%w: input %d has %d dims, want %d", ErrDimMismatch, i, len(v), p.dim)
		}
	}
	return resp.Vectors, nil
}

// hashChunk is the canonical text-hash for the dedupe path. Two
// chunks with identical text always produce the same hex digest, so
// the Index pre-query can compare hashes rather than full text.
func hashChunk(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

// Retrieve embeds query, then SELECTs the top-k chunks by cosine
// distance over the configured table. The cosine distance operator
// `<=>` is provided by pgvector and walks the HNSW index for an
// O(log n) approximate nearest-neighbour search.
//
// Off-mode is handled by the factory ([New]); reaching this method
// on a PgvectorRetriever means the gate is open. We still verify
// inputs first so a buggy caller sees the same errors regardless of
// mode.
func (p *PgvectorRetriever) Retrieve(
	ctx context.Context,
	userSubject string,
	query string,
	sourceTypes []string,
	k int,
) ([]Chunk, error) {
	if err := validateRetrieveArgs(query, k); err != nil {
		return nil, err
	}

	vecs, err := p.embed(ctx, userSubject, []string{query})
	if err != nil {
		return nil, err
	}
	queryVec, err := formatVector(vecs[0])
	if err != nil {
		return nil, err
	}

	// Two query shapes: with and without a source-type filter. We
	// build the SQL inline (NOT via string concat with user data)
	// because pgx requires the table name to be in the literal SQL
	// — table names cannot be parameterised. The table value comes
	// from [tableForDim] which is a closed set of two compile-time
	// constants, so the inline interpolation is provably safe.
	//
	// Score column: `1 - (embedding <=> $vec)` converts cosine
	// distance (range [0, 2] for unit-normalised vectors) into
	// cosine similarity (range [-1, 1] — see Chunk.Score doc).
	var (
		rows pgx.Rows
		qErr error
	)
	if len(sourceTypes) == 0 {
		sql := fmt.Sprintf(`
			SELECT source_type, source_id, chunk_idx, text,
			       1 - (embedding <=> $1::vector) AS score
			  FROM %s
			 WHERE user_subject = $2
			   AND model        = $3
			 ORDER BY embedding <=> $1::vector
			 LIMIT $4`, p.table)
		rows, qErr = p.db.Pool.Query(ctx, sql, queryVec, userSubject, p.model, k)
	} else {
		sql := fmt.Sprintf(`
			SELECT source_type, source_id, chunk_idx, text,
			       1 - (embedding <=> $1::vector) AS score
			  FROM %s
			 WHERE user_subject = $2
			   AND model        = $3
			   AND source_type  = ANY($4::text[])
			 ORDER BY embedding <=> $1::vector
			 LIMIT $5`, p.table)
		rows, qErr = p.db.Pool.Query(ctx, sql, queryVec, userSubject, p.model, sourceTypes, k)
	}
	if qErr != nil {
		return nil, fmt.Errorf("rag: retrieve query: %w", qErr)
	}
	defer rows.Close()

	out := make([]Chunk, 0, k)
	for rows.Next() {
		var c Chunk
		var score float64 // pgvector emits the score column as double precision
		if err := rows.Scan(&c.SourceType, &c.SourceID, &c.ChunkIdx, &c.Text, &score); err != nil {
			return nil, fmt.Errorf("rag: retrieve scan: %w", err)
		}
		c.Score = float32(score)
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rag: retrieve rows: %w", err)
	}
	return out, nil
}

// Index upserts the supplied chunks under (userSubject, sourceType,
// sourceID), skipping the embed call for chunks whose text_hash
// matches an existing row. After the upsert, any chunk_idx beyond
// len(chunks)-1 for the same (userSubject, sourceType, sourceID,
// model) is DELETEd so a shrunk source cannot leak stale chunks.
//
// The whole operation runs inside a single transaction so a partial
// failure cannot leave an embeddings table in a half-updated state
// (e.g. new chunks visible to retrieval but stale chunks not yet
// removed).
//
// Pre-querying hashes avoids paying for embed calls on unchanged
// chunks — important for the docs indexer which would otherwise
// re-embed every doc on every boot. The UPSERT's WHERE clause is a
// belt-and-braces guard against a concurrent writer; F7 has only
// one indexer per (subject, source) so the race is theoretical.
func (p *PgvectorRetriever) Index(
	ctx context.Context,
	userSubject string,
	sourceType string,
	sourceID string,
	chunks []string,
) error {
	if err := validateIndexArgs(sourceType, sourceID, chunks); err != nil {
		return err
	}

	// Empty chunks list is a valid "delete everything for this
	// source" call (equivalent to Forget). Handle it explicitly so
	// the embed path is skipped entirely.
	if len(chunks) == 0 {
		return p.Forget(ctx, userSubject, sourceType, sourceID)
	}

	// 1. Pre-query existing (chunk_idx, text_hash) pairs so we know
	//    which chunks need fresh embeddings.
	existing, err := p.fetchExistingHashes(ctx, userSubject, sourceType, sourceID)
	if err != nil {
		return err
	}

	hashes := make([]string, len(chunks))
	for i, c := range chunks {
		hashes[i] = hashChunk(c)
	}

	// 2. Build the list of (idx, text) pairs that need embedding.
	//    A chunk needs embedding iff (a) no row exists for that
	//    chunk_idx, or (b) the stored text_hash differs.
	type pending struct {
		idx  int
		text string
	}
	var toEmbed []pending
	for i, h := range hashes {
		if existing[i] != h {
			toEmbed = append(toEmbed, pending{idx: i, text: chunks[i]})
		}
	}

	// 3. Embed only the changed/new chunks. Empty toEmbed means
	//    every chunk_idx is up-to-date; we still need to handle
	//    truncation (chunks shrunk relative to existing).
	var embedTexts []string
	for _, p := range toEmbed {
		embedTexts = append(embedTexts, p.text)
	}
	var embedVecs [][]float32
	if len(embedTexts) > 0 {
		embedVecs, err = p.embed(ctx, userSubject, embedTexts)
		if err != nil {
			return err
		}
	}

	// 4. Apply all writes inside a transaction so the table is
	//    consistent on failure.
	tx, err := p.db.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("rag: index begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	now := time.Now().UTC()
	expiresAt := ExpiresAt(sourceType, now)

	upsertSQL := fmt.Sprintf(`
		INSERT INTO %s
			(user_subject, source_type, source_id, chunk_idx,
			 text, text_hash, embedding, model, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9)
		ON CONFLICT (user_subject, source_type, source_id, chunk_idx, model)
		DO UPDATE SET
			text       = EXCLUDED.text,
			text_hash  = EXCLUDED.text_hash,
			embedding  = EXCLUDED.embedding,
			expires_at = EXCLUDED.expires_at,
			created_at = now()
		WHERE %s.text_hash IS DISTINCT FROM EXCLUDED.text_hash`,
		p.table, p.table)

	for i, pe := range toEmbed {
		vec, err := formatVector(embedVecs[i])
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, upsertSQL,
			userSubject, sourceType, sourceID, pe.idx,
			pe.text, hashes[pe.idx], vec, p.model, expiresAt,
		); err != nil {
			return fmt.Errorf("rag: index upsert chunk %d: %w", pe.idx, err)
		}
	}

	// 5. Truncation: drop any chunks beyond the new len(chunks).
	deleteSQL := fmt.Sprintf(`
		DELETE FROM %s
		 WHERE user_subject = $1
		   AND source_type  = $2
		   AND source_id    = $3
		   AND model        = $4
		   AND chunk_idx   >= $5`, p.table)
	if _, err := tx.Exec(ctx, deleteSQL,
		userSubject, sourceType, sourceID, p.model, len(chunks),
	); err != nil {
		return fmt.Errorf("rag: index truncate: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("rag: index commit: %w", err)
	}
	return nil
}

// fetchExistingHashes returns the chunk_idx → text_hash map for the
// given source. Missing chunk_idx entries return zero-value strings
// so the caller can simply compare to the new hash.
func (p *PgvectorRetriever) fetchExistingHashes(
	ctx context.Context,
	userSubject string,
	sourceType string,
	sourceID string,
) (map[int]string, error) {
	sql := fmt.Sprintf(`
		SELECT chunk_idx, text_hash
		  FROM %s
		 WHERE user_subject = $1
		   AND source_type  = $2
		   AND source_id    = $3
		   AND model        = $4`, p.table)
	rows, err := p.db.Pool.Query(ctx, sql,
		userSubject, sourceType, sourceID, p.model)
	if err != nil {
		return nil, fmt.Errorf("rag: fetch existing hashes: %w", err)
	}
	defer rows.Close()

	out := map[int]string{}
	for rows.Next() {
		var idx int
		var hash string
		if err := rows.Scan(&idx, &hash); err != nil {
			return nil, fmt.Errorf("rag: scan existing hash: %w", err)
		}
		out[idx] = hash
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rag: existing rows: %w", err)
	}
	return out, nil
}

// Forget deletes every chunk for (userSubject, sourceType, sourceID).
// Idempotent: missing rows are not an error.
func (p *PgvectorRetriever) Forget(
	ctx context.Context,
	userSubject string,
	sourceType string,
	sourceID string,
) error {
	if err := validateForgetArgs(sourceType, sourceID); err != nil {
		return err
	}
	sql := fmt.Sprintf(`
		DELETE FROM %s
		 WHERE user_subject = $1
		   AND source_type  = $2
		   AND source_id    = $3
		   AND model        = $4`, p.table)
	if _, err := p.db.Pool.Exec(ctx, sql,
		userSubject, sourceType, sourceID, p.model); err != nil {
		return fmt.Errorf("rag: forget: %w", err)
	}
	return nil
}

// Compile-time assertion the production retriever satisfies the
// interface so a future signature change forces an update here too.
var _ Retriever = (*PgvectorRetriever)(nil)

// staticResolver is a tiny [ProviderResolver] that always returns
// the supplied provider. Used by the docs indexer's bootstrap path
// (where the registry has already gated by featureID upstream) and
// by tests.
type staticResolver struct{ p provider.Provider }

// NewStaticResolver wraps p in a [ProviderResolver] that ignores the
// featureID argument. The production registry is the preferred
// resolver; this is a focused helper for tests and for the indexer
// goroutine in N6 which has already resolved the provider once and
// wants to avoid re-resolving on every chunk.
func NewStaticResolver(p provider.Provider) ProviderResolver {
	if p == nil {
		panic("rag: NewStaticResolver called with nil provider")
	}
	return &staticResolver{p: p}
}

func (s *staticResolver) For(_ context.Context, _ string) (provider.Provider, error) {
	return s.p, nil
}
