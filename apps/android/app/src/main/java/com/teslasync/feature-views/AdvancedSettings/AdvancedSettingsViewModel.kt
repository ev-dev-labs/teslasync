// UI-thread-free state holder backing the Compose [AdvancedSettings] surface — the native port of the
// web panel's hook composition (web/src/features/settings/components/AdvancedSettings.tsx). The web
// component keeps no real state: it reads `listSilenced()` synchronously on every render and bumps a
// `tick` after each `unsilence` / `clearAllSilenced` to re-read. Here that becomes a lifecycle-aware
// [UiState] of the canonical [SilencedPrompts], covering every state the surface renders: loading (the
// first device-local read), content (the list), empty (nothing silenced — the web `silenced.length`
// guard), a hard error + retry, and — through the ADR-013 freshness contract — the stale / offline
// envelope (a failed re-read keeps the last list visible). The injected [ConfirmSilenceStore] (P1/S8)
// reads/writes device-local storage; the view-model performs no HTTP (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AdvancedSettings) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.advancedsettings

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * State holder backing the Compose [AdvancedSettings].
 *
 * It owns the silenced-prompt allowlist [state]. The first [onAppear] (and every [refresh] / [retry])
 * reads the device-local allowlist; [restore] re-enables one prompt and [restoreAll] wipes them all,
 * each re-reading the resulting list. Every load shows refreshing over any prior list (the web leaves
 * the existing rows on screen) then resolves to content / empty, or — on failure — folds through the
 * shared [toUiState] contract: the error state with a retry when nothing was shown, or the stale
 * "last known" list with a retry when one was. It owns no networking and exposes the PII-safe
 * `view.opened` diagnostic (P1/S11) — only the surface slug is ever logged, never the action ids.
 *
 * @param store the device-local "Don't ask again" allowlist seam (P1/S8) — production adapter or a fake.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock millisecond source for the freshness stamp; overridable so tests stay deterministic.
 */
class AdvancedSettingsViewModel(
    private val store: ConfirmSilenceStore,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = System::currentTimeMillis,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow<UiState<SilencedPrompts>>(UiState.loading())

    /** The allowlist as loading / content / empty / stale / offline / error UI state. */
    val state: StateFlow<UiState<SilencedPrompts>> = mutableState.asStateFlow()

    private var viewOpenedRecorded = false

    /**
     * Records the one-shot `view.opened` diagnostics event (P1/S11 — PII-safe, surface slug only) and
     * performs the first device-local read. Call from the composable's first-composition effect.
     */
    fun onAppear() {
        if (!viewOpenedRecorded) {
            viewOpenedRecorded = true
            logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to AdvancedSettingsRegistration.SLUG))
        }
        reload()
    }

    /** Re-reads the device-local allowlist (backs the first load, the stale/offline chip, and retry). */
    fun reload() = load { store.list() }

    /** Retry after a hard read failure — re-reads the allowlist. */
    fun retry() = reload()

    /** Refresh over the visible list — re-reads the allowlist; backs the stale/offline chip. */
    fun refresh() = reload()

    /**
     * Re-enables the prompt for a single action [key] (web `unsilence` + `tick` bump), then re-reads the
     * resulting list. Only the surface slug is logged — the action id never leaves the view-model.
     */
    fun restore(key: String) {
        logger.info(EVENT_RESTORE, mapOf(FIELD_SURFACE to AdvancedSettingsRegistration.SLUG))
        load { store.unsilence(key) }
    }

    /**
     * Wipes every silenced prompt (web `clearAllSilenced` + `tick` bump), then re-reads the now-empty
     * list. Only the surface slug is logged — no action ids are recorded.
     */
    fun restoreAll() {
        logger.info(EVENT_RESTORE_ALL, mapOf(FIELD_SURFACE to AdvancedSettingsRegistration.SLUG))
        load { store.clearAll() }
    }

    /**
     * Runs [action] over the store, showing refreshing over any prior list, then folding the outcome
     * through [silencedResource] → [toUiState]. A failure keeps a prior list visible (stale) or surfaces
     * a hard error + retry when there was nothing to show.
     */
    private fun load(action: suspend () -> Set<String>) {
        val current = mutableState.value
        val prior = current.data?.takeIf { !it.isBlank }
        val priorFetchedAt = current.fetchedAt
        mutableState.value =
            Resource.Loading(cached = prior, fetchedAt = priorFetchedAt, stale = false).toUiState { it.isBlank }
        launch {
            val result = runCatching { SilencedPrompts.of(action()) }
            mutableState.value = silencedResource(result, prior, priorFetchedAt, clock()).toUiState { it.isBlank }
        }
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_RESTORE = "advancedSettings.restore"
        private const val EVENT_RESTORE_ALL = "advancedSettings.restoreAll"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            store: ConfirmSilenceStore,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AdvancedSettingsViewModel(store, logger) }
            }
    }
}
