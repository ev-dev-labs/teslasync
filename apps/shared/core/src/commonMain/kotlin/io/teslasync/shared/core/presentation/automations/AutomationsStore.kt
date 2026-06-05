package io.teslasync.shared.core.presentation.automations

import io.teslasync.shared.core.data.repo.AutomationsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.automationDetailKey
import io.teslasync.shared.core.data.repo.automationHistoryKey
import io.teslasync.shared.core.data.repo.automationListKey
import io.teslasync.shared.core.data.repo.automationPresetKey
import io.teslasync.shared.core.data.repo.automationPresetsKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the Automations control plane — the cross-platform port of
 * the web `useAutomations` hook domain (web/src/api/hooks/useAutomations.ts). Every native
 * Automations screen (Android/Apple via KMP, Windows via the C# port) binds to this single
 * holder rather than re-implementing endpoints, query keys, or invalidation rules.
 *
 * Reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each is
 * lazily created on first access, shared so every observer of the same `(feed, params)` folds
 * into one upstream collection, and refreshable. The seven mutations are non-throwing suspend
 * [Result]s; on success each refreshes EXACTLY the feeds the matching web hook invalidates via
 * `invalidateQueries`:
 *  - toggle / re-enable / create  → the list;
 *  - delete / bulk                → the list + every history feed;
 *  - test-run                     → every history feed;
 *  - update                       → the list + that automation's detail.
 *
 * Refreshing re-collects the cache-then-network feed, which always re-fetches while replaying
 * the last cached rows first (the web behaviour of keeping prior data during a refetch). The
 * holder makes no network calls itself — it delegates entirely to the injected
 * [AutomationsRepository] (S7). A feed nobody is observing is a no-op to refresh.
 *
 * Optimistic UI (the web toggle's instant flip) and toasts are render-layer concerns and are
 * intentionally NOT reproduced here. This holder mirrors the web hook's single-threaded usage
 * and is not internally synchronised; create and drive it from one confinement (the platform
 * main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class AutomationsStore(
    private val repo: AutomationsRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val listFeeds = mutableMapOf<String, StateFlow<Resource<List<Automation>>>>()
    private val historyFeeds = mutableMapOf<String, StateFlow<Resource<AutomationHistoryListResponse>>>()
    private val detailFeeds = mutableMapOf<String, StateFlow<Resource<AutomationFull>>>()
    private val presetsFeeds = mutableMapOf<String, StateFlow<Resource<AutomationPresetsResponse>>>()
    private val presetFeeds = mutableMapOf<String, StateFlow<Resource<AutomationPreset>>>()

    // ---- Reads --------------------------------------------------------------------

    /** Shared, refreshable `GET /automations` feed (web `useAutomations`). */
    public fun automations(): StateFlow<Resource<List<Automation>>> = feed(automationListKey(), listFeeds) { repo.automations() }

    /** Shared, refreshable `GET /automations/history?limit=` feed (web `useAutomationHistory`). */
    public fun automationHistory(
        limit: Int = AutomationsRepository.DEFAULT_HISTORY_LIMIT,
    ): StateFlow<Resource<AutomationHistoryListResponse>> =
        feed(automationHistoryKey(limit), historyFeeds) { repo.automationHistory(limit) }

    /** Shared, refreshable `GET /automations/{id}` feed (web `useAutomation`). */
    public fun automation(id: Long): StateFlow<Resource<AutomationFull>> =
        feed(automationDetailKey(id), detailFeeds) { repo.automation(id) }

    /** Shared, refreshable `GET /automations/presets[?category=]` feed (web `useAutomationPresets`). */
    public fun automationPresets(category: String? = null): StateFlow<Resource<AutomationPresetsResponse>> =
        feed(automationPresetsKey(category), presetsFeeds) { repo.automationPresets(category) }

    /** Shared, refreshable `GET /automations/presets/{id}` feed (web `useAutomationPreset`). */
    public fun automationPreset(id: String): StateFlow<Resource<AutomationPreset>> =
        feed(automationPresetKey(id), presetFeeds) { repo.automationPreset(id) }

    // ---- Mutations ----------------------------------------------------------------

    /** Toggles an automation, then refreshes the list (web `useToggleAutomation`). */
    public suspend fun toggleAutomation(
        id: Long,
        enabled: Boolean,
    ): Result<ToggleAutomationResult> = repo.toggleAutomation(id, enabled).onSuccess { refresh(automationListKey()) }

    /** Re-enables an auto-disabled automation, then refreshes the list (web `useReEnableAutomation`). */
    public suspend fun reEnableAutomation(id: Long): Result<ReEnableAutomationResult> =
        repo.reEnableAutomation(id).onSuccess { refresh(automationListKey()) }

    /** Deletes an automation, then refreshes the list + history (web `useDeleteAutomation`). */
    public suspend fun deleteAutomation(id: Long): Result<Unit> =
        repo.deleteAutomation(id).onSuccess {
            refresh(automationListKey())
            refreshHistory()
        }

    /** Runs an allowlisted bulk op, then refreshes the list + history (web `useBulkAutomationsUpdate`). */
    public suspend fun bulkAutomationsUpdate(
        ids: List<Long>,
        op: AutomationBulkOp,
    ): Result<AutomationBulkResult> =
        repo.bulkAutomationsUpdate(ids, op).onSuccess {
            refresh(automationListKey())
            refreshHistory()
        }

    /** Starts a test run, then refreshes history (web `useTestRunAutomation`). */
    public suspend fun testRunAutomation(id: Long): Result<Unit> = repo.testRunAutomation(id).onSuccess { refreshHistory() }

    /** Creates an automation, then refreshes the list (web `useCreateAutomationFull`). */
    public suspend fun createAutomationFull(input: AutomationFullInput): Result<AutomationFull> =
        repo.createAutomationFull(input).onSuccess { refresh(automationListKey()) }

    /** Updates an automation, then refreshes the list + that automation's detail (web `useUpdateAutomationFull`). */
    public suspend fun updateAutomationFull(
        id: Long,
        input: AutomationFullInput,
    ): Result<AutomationFull> =
        repo.updateAutomationFull(id, input).onSuccess {
            refresh(automationListKey())
            refresh(automationDetailKey(id))
        }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refresh]), and [SharingStarted.WhileSubscribed]
     * keeps a single upstream shared across observers while at least one is active.
     */
    private fun <T> feed(
        key: String,
        feeds: MutableMap<String, StateFlow<Resource<T>>>,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                )
        }

    /** Re-fetches [key]'s feed if it is being observed; a no-op for a feed nobody has opened. */
    private fun refresh(key: String) {
        triggers[key]?.update { it + 1 }
    }

    /**
     * Re-fetches EVERY observed history feed — the holder-side analogue of the web hooks
     * invalidating `['automation-history']` (all limits at once). The keys are snapshotted
     * before iterating so a concurrent feed creation cannot disturb the walk.
     */
    private fun refreshHistory() {
        triggers.keys
            .filter { it.startsWith(HISTORY_PREFIX) }
            .toList()
            .forEach(::refresh)
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L

        // Matches automationHistoryKey("history:$limit"); used to fan a history invalidation
        // across every observed limit.
        const val HISTORY_PREFIX = "history:"
    }
}
