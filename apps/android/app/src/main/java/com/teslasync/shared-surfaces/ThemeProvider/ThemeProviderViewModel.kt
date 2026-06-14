// UI-thread-free state holder backing the ThemeProvider surface — the native port of the web context
// provider's state (web/src/components/ui/ThemeProvider.tsx). It binds the backend settings feed + the
// local selection cache through [ThemeProviderSource] and performs no HTTP or persistence itself (ADR-002):
// the view collects [selection] (what `useTheme()` reflects) and [syncState] (the cache-then-network
// status of the backend settings document) and folds them through the pure [ThemeProviderProjection].
//
// The backend settings document is the surface's primary async dependency, so its cache-then-network
// lifecycle drives the shell's loading / content / empty (a document with no saved appearance) / error /
// stale / offline states. On first load the holder reproduces the web mount `useEffect`: it adopts a
// server-saved theme/mode and mirrors it into the local cache. The setters reproduce the web
// `setTheme` / `setMode` / `setCustomColors`: persist locally, then full-replace `PUT /settings` with the
// merged document (fire-and-forget, exactly the web `saveThemeToBackend`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.themeprovider

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * State holder for the ThemeProvider surface.
 *
 * [selection] is the effective appearance choice the composable resolves and `useTheme()` exposes — sourced
 * from the local cache (instant) and reconciled with the server on first load. [syncState] re-shares the
 * backend settings document as a lifecycle-aware [UiState] so the composable can switch the sync-status
 * surface — loading (first fetch), content (a server-saved appearance), the empty branch (a document with no
 * saved appearance, so the local/default theme stands), a hard error with retry, and the stale/offline
 * freshness envelope — without re-deriving the cache-then-network contract.
 *
 * [setTheme] / [setMode] / [setCustomColors] persist the choice locally and full-replace `PUT /settings`
 * (web `saveThemeToBackend`), [refresh]/[retry] re-fetch the document, and [onViewOpened] emits the one
 * PII-safe `view.opened` diagnostic (P1/S11) — the surface slug only, never a VIN, route, or any content.
 *
 * @param source the data seam (a shared-store adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ThemeProviderViewModel(
    private val source: ThemeProviderSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The effective appearance choice (web `useTheme()` state); driven by the shared local cache. */
    val selection: StateFlow<ThemeSelection> = source.localSelection

    /**
     * The backend settings document as lifecycle-aware [UiState] — the surface's sync-status feed. A
     * document with no recognised theme/mode is treated as the structurally-empty phase via the
     * [ThemeProviderProjection.hasThemeSettings] predicate, so the empty state is honest (the local/default
     * theme is applied) rather than a blank surface.
     */
    val syncState: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { source.settings() }
            .asUiState(isEmpty = { !ThemeProviderProjection.hasThemeSettings(it) })

    init {
        // Web mount `useEffect`: read GET /settings once; adopt + mirror a server-saved appearance locally.
        launch {
            val terminal = source.settings().first { it is Resource.Success || it is Resource.Error }
            val document = terminal.cached
            if (document != null && ThemeProviderProjection.hasThemeSettings(document)) {
                val current = source.localSelection.value
                val parsed = ThemeProviderProjection.parseSelection(document, current)
                if (parsed != current) source.persistSelection(parsed)
            }
        }
    }

    /** Selects a colour theme: persists locally + saves to the backend (web `setTheme`). */
    fun setTheme(id: ThemeId) = applySelection(source.localSelection.value.copy(themeId = id), EVENT_SET_THEME)

    /** Selects a mode: persists locally + saves to the backend (web `setMode`). */
    fun setMode(id: ModeId) = applySelection(source.localSelection.value.copy(modeId = id), EVENT_SET_MODE)

    /** Sets the custom colours and switches to the custom theme (web `setCustomColors`). */
    fun setCustomColors(
        primary: String,
        accent: String,
    ) = applySelection(
        source.localSelection.value.copy(themeId = ThemeId.Custom, customPrimary = primary, customAccent = accent),
        EVENT_SET_CUSTOM,
    )

    /** Re-fetches the settings document after a hard error or to refresh the stale/offline surface. */
    fun retry() {
        logger.info(EVENT_REFRESH, surfaceField)
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the settings document; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no VIN, route, or appearance content. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, surfaceField)
    }

    private fun applySelection(
        next: ThemeSelection,
        event: String,
    ) {
        logger.info(event, surfaceField)
        source.persistSelection(next)
        launch { runCatching { saveToBackend(next) } }
    }

    private suspend fun saveToBackend(next: ThemeSelection) {
        val merged = ThemeProviderProjection.mergeSelection(syncState.value.data, next)
        source.saveSettings(merged)
    }

    private val surfaceField: Map<String, String> get() = mapOf(SURFACE_KEY to ThemeProviderRegistration.SLUG)

    companion object {
        private const val SURFACE_KEY = "surface"
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "themeProvider.refresh"
        private const val EVENT_SET_THEME = "themeProvider.setTheme"
        private const val EVENT_SET_MODE = "themeProvider.setMode"
        private const val EVENT_SET_CUSTOM = "themeProvider.setCustom"

        /** Wires the surface from the shared [SettingsStore] + local [ThemeSelectionStore] (P1/S8). */
        fun create(
            settingsStore: SettingsStore,
            selectionStore: ThemeSelectionStore,
            logger: Logger,
        ): ThemeProviderViewModel = ThemeProviderViewModel(bindThemeProviderSource(settingsStore, selectionStore), logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: ThemeProviderSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ThemeProviderViewModel(source, logger) }
            }
    }
}
