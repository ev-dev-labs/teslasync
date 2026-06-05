package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.automations.Automation
import io.teslasync.shared.core.presentation.automations.AutomationBulkOp
import io.teslasync.shared.core.presentation.automations.AutomationBulkResult
import io.teslasync.shared.core.presentation.automations.AutomationFull
import io.teslasync.shared.core.presentation.automations.AutomationFullInput
import io.teslasync.shared.core.presentation.automations.AutomationHistoryListResponse
import io.teslasync.shared.core.presentation.automations.AutomationPreset
import io.teslasync.shared.core.presentation.automations.AutomationPresetsResponse
import io.teslasync.shared.core.presentation.automations.ReEnableAutomationResult
import io.teslasync.shared.core.presentation.automations.ToggleAutomationResult
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the Automations control plane — the cross-platform analogue of the web
 * `useAutomations` hook domain (web/src/api/hooks/useAutomations.ts). Every native Automations
 * surface (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively
 * through this interface, so a single fake stands in for the whole domain in the S8
 * state-holder tests.
 *
 * The five reads stream a cache-then-network [Resource] (ADR-013): the cached value first for
 * an instant cold start, then the refreshed value. Each is cached under a stable per-feed key
 * (see [automationListKey] etc.) mirroring the web TanStack query keys. The seven mutations
 * are non-throwing suspend [Result]s; they call the API directly and DO NOT touch the durable
 * cache — the cache-then-network operator always re-fetches on the S8 store's targeted refresh
 * (the `invalidateQueries` analogue), so the previous rows stay visible during the reload while
 * no stale value is ever served as fresh. Values are SI on the wire; conversion is the render
 * boundary's job (S5).
 */
public interface AutomationsRepository {
    /** `GET /automations` — the automation list (web `useAutomations`, `safeArray`-guarded). */
    public fun automations(): Flow<Resource<List<Automation>>>

    /** `GET /automations/history?limit=` — the execution history (web `useAutomationHistory`). */
    public fun automationHistory(limit: Int = DEFAULT_HISTORY_LIMIT): Flow<Resource<AutomationHistoryListResponse>>

    /** `GET /automations/{id}` — one fully-expanded automation (web `useAutomation`). */
    public fun automation(id: Long): Flow<Resource<AutomationFull>>

    /** `GET /automations/presets[?category=]` — the preset gallery (web `useAutomationPresets`). */
    public fun automationPresets(category: String? = null): Flow<Resource<AutomationPresetsResponse>>

    /** `GET /automations/presets/{id}` — one preset (web `useAutomationPreset`). */
    public fun automationPreset(id: String): Flow<Resource<AutomationPreset>>

    /** `PATCH /automations/{id}/toggle` with `{ enabled }` (web `useToggleAutomation`). */
    public suspend fun toggleAutomation(
        id: Long,
        enabled: Boolean,
    ): Result<ToggleAutomationResult>

    /** `PATCH /automations/{id}/re-enable` (web `useReEnableAutomation`). */
    public suspend fun reEnableAutomation(id: Long): Result<ReEnableAutomationResult>

    /** `DELETE /automations/{id}` (web `useDeleteAutomation`). */
    public suspend fun deleteAutomation(id: Long): Result<Unit>

    /** `POST /automations/bulk` with `{ ids, op }` (web `useBulkAutomationsUpdate`). */
    public suspend fun bulkAutomationsUpdate(
        ids: List<Long>,
        op: AutomationBulkOp,
    ): Result<AutomationBulkResult>

    /** `POST /automations/{id}/test-run` (web `useTestRunAutomation`). */
    public suspend fun testRunAutomation(id: Long): Result<Unit>

    /** `POST /automations` with the full input body (web `useCreateAutomationFull`). */
    public suspend fun createAutomationFull(input: AutomationFullInput): Result<AutomationFull>

    /** `PUT /automations/{id}` with the full input body (web `useUpdateAutomationFull`). */
    public suspend fun updateAutomationFull(
        id: Long,
        input: AutomationFullInput,
    ): Result<AutomationFull>

    public companion object {
        /** The web `useAutomationHistory(limit = 20)` default. */
        public const val DEFAULT_HISTORY_LIMIT: Int = 20
    }
}

/**
 * The `/automations/history` query map — the port of the web ``/automations/history?limit=${limit}``.
 * The web hook ALWAYS sends `limit` (it has a default of 20), so the key is unconditional.
 * Locked by golden vectors shared with the C# port.
 */
public fun automationHistoryQuery(limit: Int): Map<String, String> = mapOf("limit" to limit.toString())

/**
 * The `/automations/presets` query map — the port of the web
 * ``const queryParam = category ? '?category=' + category : ''``. The category is sent only
 * when present AND non-blank (mirroring JavaScript's truthy guard, so an empty string is
 * treated as "no filter"). Locked by golden vectors shared with the C# port.
 */
public fun automationPresetsQuery(category: String?): Map<String, String> {
    val query = linkedMapOf<String, String>()
    category?.takeIf { it.isNotEmpty() }?.let { query["category"] = it }
    return query
}

/** Cache/feed key for the automation list — the web `automationKeys.all` (`['automations']`). */
public fun automationListKey(): String = "list"

/** Cache/feed key for the history feed at [limit] — the web `automationKeys.history(limit)`. */
public fun automationHistoryKey(limit: Int): String = "history:$limit"

/** Cache/feed key for one automation — the web `automationKeys.detail(id)` (`['automations', id]`). */
public fun automationDetailKey(id: Long): String = "detail:$id"

/**
 * Cache/feed key for the presets feed — the web `presetKeys.all` / `presetKeys.category(cat)`.
 * Mirrors the web's truthy guard: a null OR blank category collapses to the un-categorised key
 * (the same null-coalescing the web `useAutomationPresets` query key applies).
 */
public fun automationPresetsKey(category: String?): String = category?.takeIf { it.isNotEmpty() }?.let { "presets:$it" } ?: "presets"

/** Cache/feed key for one preset — the web `presetKeys.detail(id)` (`['automation-preset', id]`). */
public fun automationPresetKey(id: String): String = "preset:$id"
