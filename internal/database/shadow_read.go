package database

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// ShadowRead executes the old (source-of-truth) query synchronously and,
// concurrently, re-runs a candidate replacement query. If the two results
// diverge, the discrepancy is logged at warn level but the caller always
// receives the old result. Errors produced by the shadow query are logged
// and never propagated.
//
// Intended for canarying a query rewrite (e.g. direct table → compat view,
// or raw GROUP BY → continuous aggregate) against real production traffic
// before promoting it to be the primary read path.
//
// The caller supplies a scanner that translates a *pgx.Rows into the result
// type T. The same scanner is used for both queries, so both queries must
// share a compatible projection.
//
//	users, err := database.ShadowRead(ctx, db.Pool, "users_by_id",
//	    "SELECT id, name FROM users WHERE id = $1", []any{id},
//	    "SELECT id, name FROM v_users WHERE id = $1", []any{id},
//	    scanUser,
//	)
func ShadowRead[T any](
	ctx context.Context,
	q Queryer,
	label string,
	oldSQL string, oldArgs []any,
	newSQL string, newArgs []any,
	scan func(pgx.Rows) (T, error),
) (T, error) {
	var zero T

	oldResult, oldErr := runAndScan(ctx, q, oldSQL, oldArgs, scan)
	if oldErr != nil {
		return zero, oldErr
	}

	// Detach so the caller isn't blocked on the shadow query, but keep a
	// bounded deadline so a pathological new query can't leak connections.
	go func() {
		shadowCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		start := time.Now()
		newResult, newErr := runAndScan(shadowCtx, q, newSQL, newArgs, scan)
		elapsed := time.Since(start)

		if newErr != nil {
			log.Warn().Err(newErr).
				Str("label", label).
				Dur("elapsed", elapsed).
				Msg("shadow_read: candidate query failed")
			return
		}

		oldJSON, err1 := json.Marshal(oldResult)
		newJSON, err2 := json.Marshal(newResult)
		if err1 != nil || err2 != nil {
			log.Warn().
				AnErr("marshal_old", err1).
				AnErr("marshal_new", err2).
				Str("label", label).
				Msg("shadow_read: unable to marshal for comparison")
			return
		}

		if string(oldJSON) == string(newJSON) {
			log.Debug().
				Str("label", label).
				Dur("elapsed", elapsed).
				Msg("shadow_read: results match")
			return
		}

		log.Warn().
			Str("label", label).
			Dur("elapsed", elapsed).
			RawJSON("old", oldJSON).
			RawJSON("new", newJSON).
			Msg("shadow_read: results differ")
	}()

	return oldResult, nil
}

// Queryer is the minimal surface ShadowRead needs from pgx. Both
// *pgxpool.Pool and pgx.Tx satisfy it, as does the project-level DBTX
// interface.
type Queryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func runAndScan[T any](
	ctx context.Context,
	q Queryer,
	sql string, args []any,
	scan func(pgx.Rows) (T, error),
) (T, error) {
	var zero T
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return zero, err
	}
	if rows != nil {
		defer rows.Close()
	}
	return scan(rows)
}
