package database

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// ShadowRead executes the authoritative `oldQuery` synchronously and a
// candidate `newQuery` in the background. The old result is always returned
// to the caller; the shadow result is compared via JSON equality and any
// discrepancy is logged at warn level.
//
// This is intended for production canary validation of database refactors:
// the new code path runs in shadow mode for a release cycle, log noise is
// monitored for `shadow read: results differ`, and only when the warning
// rate is zero is the read switched over to the new query.
//
// Both queries must be safe to run concurrently (read-only). The shadow
// query inherits a fresh 5-second context so a slow new query never delays
// the response to the user.
func ShadowRead[T any](
	ctx context.Context,
	db *DB,
	label string,
	oldQuery string, oldArgs []any,
	newQuery string, newArgs []any,
	scanner func(rows pgx.Rows) (T, error),
) (T, error) {
	oldResult, oldErr := runShadowQuery(ctx, db, oldQuery, oldArgs, scanner)

	go func() {
		shadowCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		newResult, newErr := runShadowQuery(shadowCtx, db, newQuery, newArgs, scanner)
		if newErr != nil {
			log.Warn().Err(newErr).Str("label", label).Msg("shadow read: new query failed")
			return
		}

		oldJSON, err := json.Marshal(oldResult)
		if err != nil {
			log.Warn().Err(err).Str("label", label).Msg("shadow read: marshal old result")
			return
		}
		newJSON, err := json.Marshal(newResult)
		if err != nil {
			log.Warn().Err(err).Str("label", label).Msg("shadow read: marshal new result")
			return
		}

		if string(oldJSON) != string(newJSON) {
			log.Warn().
				Str("label", label).
				RawJSON("old", oldJSON).
				RawJSON("new", newJSON).
				Msg("shadow read: results differ")
		} else {
			log.Debug().Str("label", label).Msg("shadow read: results match")
		}
	}()

	return oldResult, oldErr
}

func runShadowQuery[T any](
	ctx context.Context,
	db *DB,
	query string,
	args []any,
	scanner func(rows pgx.Rows) (T, error),
) (T, error) {
	var zero T
	rows, err := db.Pool.Query(ctx, query, args...)
	if err != nil {
		return zero, err
	}
	defer rows.Close()
	return scanner(rows)
}
