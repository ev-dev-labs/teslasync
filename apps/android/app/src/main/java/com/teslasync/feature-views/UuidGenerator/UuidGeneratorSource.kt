// The generation port the [UuidGeneratorViewModel] binds to (P1/S8 state-holder seam) — the native analogue
// of the web tool's `safeRandomUUID()` call (web .../tools/UuidGenerator.tsx + @/lib/safeUUID). The web tool
// generates the id inline in the Generate handler; here the randomness lives behind a narrow seam so the
// view-model depends on an abstraction (real on-device generator ↔ test fake) and the loading / content /
// error envelope stays uniform with every other surface. Generation is purely on-device (no HTTP, no
// network) — it works identically offline, satisfying ADR-002 (the view performs no I/O of its own). The
// [uuidResource] adapter folds a generate outcome into a cache-then-network [Resource], so the same
// off-device unit test that pins the projection also pins the freshness/error envelope.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/UuidGenerator) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed: the mandated `UuidGenerator*` filename cannot match the surface's `UuidEngine` seam name.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.featureviews.uuidgenerator

import io.teslasync.shared.core.data.repo.Resource
import java.security.SecureRandom

/**
 * Produces one fresh UUID — the native port of the web tool's `safeRandomUUID()`. A `suspend` seam so a host
 * can inject the production on-device generator or a fake that throws / delays to exercise the error / loading
 * branches. Implementations never touch the network: the id is generated on-device and is therefore always
 * available, including offline.
 */
fun interface UuidEngine {
    /** A canonical lowercase RFC 4122 v4 UUID string. */
    suspend fun next(): String
}

/**
 * The production generator — a thin, on-device wrapper that fills [UuidGeneratorProjection.UUID_BYTE_COUNT]
 * cryptographically-strong bytes from [random] and formats them with [UuidGeneratorProjection.formatV4]. This
 * mirrors the web `safeRandomUUID` `crypto.getRandomValues` path (the branch that actually runs in the
 * non-secure-context LAN/HTTP deployments TeslaSync targets). No dispatcher hop is taken: drawing 16 bytes is
 * sub-microsecond, and it performs no network I/O, so the surface stays fully functional with no connectivity.
 */
fun uuidEngine(random: SecureRandom = SecureRandom()): UuidEngine =
    UuidEngine {
        val bytes = ByteArray(UuidGeneratorProjection.UUID_BYTE_COUNT)
        random.nextBytes(bytes)
        UuidGeneratorProjection.formatV4(bytes)
    }

/**
 * Folds a generate [result] into a cache-then-network [Resource] of the batch — the data adapter the state
 * holder collects (and the unit test drives directly). A success becomes a fresh [Resource.Success] stamped
 * [nowMs]; a failure keeps any prior batch visible as a stale [Resource.Error] (so a failed generate never
 * blanks the existing list — the ADR-013 "offline / last known" rule), or, with no prior batch, surfaces as a
 * hard [Resource.Error] the view renders as the error state with a retry.
 */
internal fun uuidResource(
    result: Result<UuidBatch>,
    cached: UuidBatch?,
    cachedFetchedAt: Long?,
    nowMs: Long,
): Resource<UuidBatch> =
    result.fold(
        onSuccess = { batch -> Resource.Success(batch, fetchedAt = nowMs, stale = false) },
        onFailure = { error ->
            Resource.Error(
                cached = cached,
                fetchedAt = cached?.let { cachedFetchedAt },
                stale = cached != null,
                error = error,
            )
        },
    )
