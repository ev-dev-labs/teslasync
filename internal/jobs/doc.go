// Package jobs hosts cross-cutting background jobs that don't belong
// to a single feature. Each job is a free function with the signature
// `Run<X>(ctx, deps...) (result, error)`; the scheduler (currently
// app.New) decides when to call them.
//
// Layer: platform
//
// Why a separate package (vs putting the cron next to the feature it
// serves):
//
//  1. Several features write to embeddings (docs, drives, charges,
//     alerts), so the TTL cron is shared infrastructure — putting it
//     in any one feature would force that feature to depend on the
//     others.
//  2. The scheduler needs to know about every cross-cutting job to
//     enforce sequencing (e.g. don't run TTL during a backup); a
//     central package gives it a stable import surface.
//  3. ADR-015 §I12 requires every AI background job to re-check
//     ai_mode at execution time. A dedicated package documents this
//     contract once instead of replicating it in every feature.
package jobs
