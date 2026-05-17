package jobs

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// EmbeddingsTTLSettingsReader is the narrow view of
// [database.SettingsRepo] [RunEmbeddingsTTL] depends on. Defined
// inline so callers can supply a fake without dragging the full
// settings repo into job tests.
type EmbeddingsTTLSettingsReader interface {
	AIMode(ctx context.Context) (string, error)
}

// EmbeddingsTTLResult reports the per-table delete counts so the
// scheduler can log a single tidy line per tick.
type EmbeddingsTTLResult struct {
	Deleted768  int64
	Deleted1536 int64
}

// Total returns the sum of deletes across both physical embeddings
// tables (a metric the AI ops dashboard surfaces).
func (r EmbeddingsTTLResult) Total() int64 { return r.Deleted768 + r.Deleted1536 }

// RunEmbeddingsTTL deletes expired rows from both embeddings tables.
//
// Re-checks ai_mode at execution time per ADR-015 §I12 — the
// scheduler may have started this loop while AI was on, but the
// admin can flip ai_mode='off' at any moment and we MUST honour it
// immediately. If the mode is off the function returns
// ([EmbeddingsTTLResult{}], nil) without touching the DB.
//
// Even with mode=off the function NEVER errors on a missing settings
// row — fail-closed semantics: a degraded settings table must not
// hide live data behind a recurring cron failure. Settings read
// failures are logged WARN and treated as off (no deletes).
//
// SQL contract:
//   - WHERE expires_at < now() — the never-expire sentinel
//     ([rag.IsNeverExpires]) is far in the future, so docs rows are
//     naturally skipped.
//   - No batching: per-tenant row counts are small (10s..1000s) and
//     the HNSW index keeps the planner honest. If a future deploy
//     accumulates 100K+ expired rows the cron should grow batching
//     before this becomes a hot-path concern.
func RunEmbeddingsTTL(
	ctx context.Context,
	db *database.DB,
	settings EmbeddingsTTLSettingsReader,
) (EmbeddingsTTLResult, error) {
	if db == nil {
		return EmbeddingsTTLResult{}, fmt.Errorf("jobs: RunEmbeddingsTTL requires non-nil db")
	}
	if settings == nil {
		return EmbeddingsTTLResult{}, fmt.Errorf("jobs: RunEmbeddingsTTL requires non-nil settings")
	}

	mode, err := settings.AIMode(ctx)
	if err != nil {
		log.Warn().Err(err).
			Str("job", "embeddings_ttl").
			Msg("settings read failed, treating as ai_mode=off (no deletes)")
		return EmbeddingsTTLResult{}, nil
	}
	if mode == rag.AIModeOff {
		log.Debug().
			Str("job", "embeddings_ttl").
			Msg("ai_mode=off, skipping (per ADR-015 §I12)")
		return EmbeddingsTTLResult{}, nil
	}

	res := EmbeddingsTTLResult{}

	for _, table := range []struct {
		name   string
		target *int64
	}{
		{rag.TableEmbeddings768, &res.Deleted768},
		{rag.TableEmbeddings1536, &res.Deleted1536},
	} {
		// Inline the table name — pgx cannot parameterise table
		// identifiers. Both names come from compile-time constants
		// so there's no SQL-injection vector.
		tag, err := db.Pool.Exec(ctx, fmt.Sprintf(
			`DELETE FROM %s WHERE expires_at < now()`, table.name,
		))
		if err != nil {
			return res, fmt.Errorf("jobs: embeddings_ttl delete from %s: %w", table.name, err)
		}
		*table.target = tag.RowsAffected()
	}

	if res.Total() > 0 {
		log.Info().
			Str("job", "embeddings_ttl").
			Int64("deleted_768", res.Deleted768).
			Int64("deleted_1536", res.Deleted1536).
			Int64("deleted_total", res.Total()).
			Msg("embeddings TTL cron deleted expired rows")
	} else {
		log.Debug().
			Str("job", "embeddings_ttl").
			Msg("embeddings TTL cron found nothing to delete")
	}
	return res, nil
}
