// The compute port the [HashCalculatorViewModel] binds to (P1/S8 state-holder seam) — the native analogue of
// the web tool's inline `crypto.subtle.digest` call (web/src/features/admin/components/devtools/tools/
// HashCalculator.tsx). The web computes the digest directly in an async handler; here the computation lives
// behind a narrow seam so the view-model depends on an abstraction (real on-device engine ↔ test fake) and
// the loading / content / error envelope stays uniform with every other surface. The computation is purely
// on-device (no HTTP, no network) — it works identically offline, satisfying ADR-002 (the view performs no
// I/O of its own). The [hashResource] adapter folds a compute outcome into a cache-then-network [Resource],
// so the same off-device unit test that pins the projection also pins the freshness/error envelope.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HashCalculator) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed: the mandated `HashCalculator*` filename cannot match the
// surface's `HashCalculatorEngine` seam name.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.feature.views.hashcalculator

import io.teslasync.shared.core.data.repo.Resource

/**
 * Computes the SHA-256 digest of a string — the native port of the web tool's `crypto.subtle.digest`. A
 * `suspend` seam (the web call is async) so a host can inject the production on-device engine or a fake that
 * throws / delays to exercise the error / loading branches. Implementations never touch the network: the
 * digest is computed on-device and is therefore always available, including offline.
 */
fun interface HashCalculatorEngine {
    /** The [HashDigest] of [input]; throws only if the platform cannot provide SHA-256 (defensive). */
    suspend fun digest(input: String): HashDigest
}

/**
 * The production engine — a thin, on-device wrapper over the pure [HashCalculatorProjection]. No dispatcher
 * hop is taken: a SHA-256 over the short text a developer pastes into the tool is sub-millisecond, the same
 * synchronous-feeling work the web `await crypto.subtle.digest` performs. It performs no network I/O, so the
 * surface stays fully functional with no connectivity.
 */
fun hashCalculatorEngine(): HashCalculatorEngine = HashCalculatorEngine { input -> HashCalculatorProjection.digest(input) }

/**
 * Folds a compute [result] into a cache-then-network [Resource] of the digest — the data adapter the state
 * holder collects (and the unit test drives directly). A success becomes a fresh [Resource.Success] stamped
 * [nowMs]; a failure keeps any prior digest visible as a stale [Resource.Error] (so a recompute that fails
 * never blanks the last good hash — the ADR-013 "offline / last known" rule), or, with no prior digest,
 * surfaces as a hard [Resource.Error] the view renders as the error state with a retry.
 */
internal fun hashResource(
    result: Result<HashDigest>,
    cached: HashDigest?,
    cachedFetchedAt: Long?,
    nowMs: Long,
): Resource<HashDigest> =
    result.fold(
        onSuccess = { digest -> Resource.Success(digest, fetchedAt = nowMs, stale = false) },
        onFailure = { error ->
            Resource.Error(
                cached = cached,
                fetchedAt = cached?.let { cachedFetchedAt },
                stale = cached != null,
                error = error,
            )
        },
    )
