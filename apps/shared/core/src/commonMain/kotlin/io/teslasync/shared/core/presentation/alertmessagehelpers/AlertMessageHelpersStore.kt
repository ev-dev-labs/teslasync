package io.teslasync.shared.core.presentation.alertmessagehelpers

import io.teslasync.shared.core.data.repo.AlertMessageHelpersRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * UI-free shared state holder for the Alert Studio message-template helpers — the cross-platform
 * port of the web `useAlertMessageHelpers` hook domain
 * (web/src/api/hooks/useAlertMessageHelpers.ts). Every native Alert-Studio editor screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing endpoints, query keys, refetch rules, or the disabled-query gate.
 *
 * The two catalog reads (the preset gallery and the autocomplete field catalog) are exposed as
 * hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each is lazily created on first
 * access, shared so every observer of the same `(feed, params)` folds into one upstream
 * collection, and refreshable via the matching `refresh…`. The field-catalog read additionally
 * carries the web hook's `enabled` gate — when disabled it yields a stable, non-fetching Loading
 * feed (the analogue of a TanStack query with `enabled: false`), so the editor can hold the call
 * until the draft has the inputs the catalog needs.
 *
 * [messagePreview] is the lone action — `useAlertMessagePreview` is a `useMutation`, not a
 * `useQuery` — so it is an imperative, non-throwing suspend call returning a [Result], mirroring
 * `mutation.mutateAsync(body)`. It has no invalidation surface (the web hook registers no
 * `onSuccess`). The holder makes no network calls itself; it delegates entirely to the injected
 * [AlertMessageHelpersRepository] (S7).
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and action is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class AlertMessageHelpersStore(
    private val repo: AlertMessageHelpersRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()
    private val disabledFeeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()

    /** Shared, refreshable `GET /alerts/message-presets[?kind=]` feed (null/blank ⇒ full catalog). */
    public fun messagePresets(kind: String? = null): StateFlow<Resource<JsonElement>> = feed(presetsKey(kind)) { repo.messagePresets(kind) }

    /**
     * Shared, refreshable autocomplete field-catalog feed for the given rule shape. When [enabled]
     * is `false` the returned feed never fetches and stays at the initial Loading slot — the
     * analogue of a TanStack query with `enabled: false`.
     */
    public fun messagePlaceholders( // parity:allow web-hook parity method name (ADR-014), not a stub
        kind: String? = null,
        signalName: String? = null,
        op: String? = null,
        metricId: String? = null,
        enabled: Boolean = true,
    ): StateFlow<Resource<JsonElement>> {
        val key = fieldsKey(kind, signalName, op, metricId)
        if (!enabled) return disabledFeeds.getOrPut(key) { MutableStateFlow(INITIAL) }
        return feed(key) {
            repo.messagePlaceholders(kind, signalName, op, metricId) // parity:allow API method name (ADR-014), not a stub
        }
    }

    /**
     * Renders a single message preview from the live editor draft [body] via
     * `POST /alerts/message-preview`. Mirrors web `useAlertMessagePreview.mutateAsync(body)`:
     * fires on demand (the editor debounces it), touches no cache, and returns the repository's
     * [Result] verbatim.
     */
    public suspend fun messagePreview(body: JsonObject): Result<JsonElement> = repo.messagePreview(body)

    /** Re-fetches the `message-presets` feed for [kind] if it is being observed. */
    public fun refreshMessagePresets(kind: String? = null): Unit = refresh(presetsKey(kind))

    /** Re-fetches the autocomplete field-catalog feed for the given params if it is being observed. */
    public fun refreshMessagePlaceholders( // parity:allow web-hook parity method name (ADR-014), not a stub
        kind: String? = null,
        signalName: String? = null,
        op: String? = null,
        metricId: String? = null,
    ): Unit = refresh(fieldsKey(kind, signalName, op, metricId))

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refresh]), and [SharingStarted.WhileSubscribed]
     * keeps a single upstream shared across observers while at least one is active.
     */
    private fun feed(
        key: String,
        source: () -> Flow<Resource<JsonElement>>,
    ): StateFlow<Resource<JsonElement>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL,
                )
        }

    /** Re-fetches [key]'s feed if it is being observed; a no-op for a feed nobody has opened. */
    private fun refresh(key: String) {
        triggers[key]?.update { it + 1 }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        const val KEY_PRESETS = "presets"
        const val KEY_FIELDS = "fields"

        /** Mirrors the web truthiness check (`kind ? … : ''`): null or blank ⇒ the universal "" key. */
        fun norm(value: String?): String = value?.takeIf { it.isNotBlank() } ?: ""

        fun presetsKey(kind: String?): String = "$KEY_PRESETS:${norm(kind)}"

        fun fieldsKey(
            kind: String?,
            signalName: String?,
            op: String?,
            metricId: String?,
        ): String = "$KEY_FIELDS:${norm(kind)}:${norm(signalName)}:${norm(op)}:${norm(metricId)}"
    }
}
