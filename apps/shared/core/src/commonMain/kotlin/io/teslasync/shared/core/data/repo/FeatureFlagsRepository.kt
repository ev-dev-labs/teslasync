package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.featureflags.FeatureFlagChangesResponse
import io.teslasync.shared.core.presentation.featureflags.FeatureFlagEntry
import io.teslasync.shared.core.presentation.featureflags.FeatureFlagWriteResponse
import io.teslasync.shared.core.presentation.featureflags.FeatureFlagsListResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/** The default flag-change audit limit — the port of the web `PAGINATION.DEFAULT_LIMIT` (50). */
public const val FEATURE_FLAG_CHANGES_DEFAULT_LIMIT: Int = 50

/**
 * The S7 data port for the typed feature-flag registry — the cross-platform analogue of the web
 * `useFeatureFlags` hook domain (web/src/api/hooks/useFeatureFlags.ts), mounted under
 * `/api/v1/system/flags*`. Every native Feature-Flags surface (Android/Apple via KMP, Windows via
 * the C# port) reaches the backend exclusively through this interface, so a single fake stands in
 * for the whole domain in the S8 state-holder tests.
 *
 * The three reads ([flags], [flag], [flagChanges]) stream a cache-then-network [Resource]
 * (ADR-013): the cached value first for an instant cold start, then the refreshed value. The two
 * mutations ([setFlag], [deleteFlag]) are sudo-gated, non-throwing suspend [Result]s; on success
 * each evicts the WHOLE flags cache partition — the data-layer analogue of the web hooks
 * invalidating the `['system','flags']` prefix (which drops the list, every per-key entry, and
 * every change feed at once, because a write can affect any of them). Sudo step-up itself is the
 * networking layer's concern (S6), exactly as the web delegates it to the shared `request`
 * interceptor; a user-cancelled step-up surfaces here as an ordinary `Result.failure`.
 *
 * A flag value is arbitrary JSON ([JsonElement]) and no field is unit-bearing, so payloads
 * round-trip verbatim with no SI conversion. The change-feed scoping derivation ([flagChangesScoped]
 * / [flagChangesCacheKey]) is the one non-trivial client-side rule ported from the web; it is
 * locked by golden vectors shared with the C# port so the three platforms cannot drift (ADR-004).
 */
public interface FeatureFlagsRepository {
    /**
     * `GET /system/flags` — the full registry (web `useFlags`). The web hook polls this on a 30s
     * interval; the polling cadence is an S8/UI concern, this port just streams cache-then-network.
     */
    public fun flags(): Flow<Resource<FeatureFlagsListResponse>>

    /**
     * `GET /system/flags/{key}` — a single flag, used to refresh the edit drawer post-save (web
     * `useFlag`). The web hook is `enabled` only for a non-blank key; calling this with a blank
     * [key] is a caller error (the UI gates it), mirrored at the store layer.
     */
    public fun flag(key: String): Flow<Resource<FeatureFlagEntry>>

    /**
     * The flag-change audit feed (web `useFlagChanges`). A non-blank [flagKey] scopes to a single
     * flag's history via `GET /system/flags/{key}/changes?limit={limit}`; a null/blank [flagKey]
     * lists the global feed via `GET /system/flags/changes?limit={limit}`. The scoping decision and
     * cache key are [flagChangesScoped] / [flagChangesCacheKey].
     */
    public fun flagChanges(
        flagKey: String? = null,
        limit: Int = FEATURE_FLAG_CHANGES_DEFAULT_LIMIT,
    ): Flow<Resource<FeatureFlagChangesResponse>>

    /**
     * `PUT /system/flags/{key}` `{value, reason}` (sudo-gated) — creates or updates a flag (web
     * `useSetFlag`). On success the whole flags partition is evicted so the next read of any flag
     * feed re-fetches (the `invalidateQueries(['system','flags'])` analogue).
     */
    public suspend fun setFlag(
        key: String,
        value: JsonElement,
        reason: String,
    ): Result<FeatureFlagWriteResponse>

    /**
     * `DELETE /system/flags/{key}?reason={reason}` (sudo-gated) — removes a flag (web
     * `useDeleteFlag`). `reason` is required by the backend (the audit row is rejected without it)
     * and is carried as a query param exactly as the web `URLSearchParams({ reason })`. On success
     * the whole flags partition is evicted.
     */
    public suspend fun deleteFlag(
        key: String,
        reason: String,
    ): Result<FeatureFlagWriteResponse>
}

/**
 * Whether a flag-changes request is scoped to a single flag — the port of the web
 * `useFlagChanges` guard `typeof flagKey === 'string' && flagKey.length > 0`. A null OR empty
 * [flagKey] is the global feed; any non-empty key scopes to that flag. Locked by golden vectors
 * shared with the C# port.
 */
public fun flagChangesScoped(flagKey: String?): Boolean = !flagKey.isNullOrEmpty()

/**
 * Builds the stable cache/feed key for a flag-changes request, mirroring the web
 * `featureFlagKeys.changes(scoped ? flagKey : null, limit)` tuple
 * `['system','flags','changes', flagKey ?? '__all__', limit]`: a scoped request keys on the flag
 * key, the global feed keys on the sentinel `__all__`, and the [limit] participates so two limits
 * cache independently. Locked by golden vectors shared with the C# port.
 */
public fun flagChangesCacheKey(
    flagKey: String?,
    limit: Int,
): String {
    val scope = if (flagChangesScoped(flagKey)) flagKey!! else FLAG_CHANGES_ALL
    return "changes:$scope:$limit"
}

/** Cache/feed key for the full registry list (web `featureFlagKeys.list`). */
public fun flagsListCacheKey(): String = "list"

/** Cache/feed key for a single flag (web `featureFlagKeys.flag(key)`). */
public fun flagCacheKey(key: String): String = "flag:$key"

/** The sentinel the web `featureFlagKeys.changes` substitutes for a null/global flag key. */
public const val FLAG_CHANGES_ALL: String = "__all__"
