// UI-thread-free state holder backing the ThemePicker surface — the native port of the state the web
// `ThemeProvider` owns (web/src/components/ui/ThemeProvider.tsx) and exposes to the picker through
// `useTheme()`. It binds the persisted selection feed through [ThemePickerSource], folds it with the static
// brand catalogues, and re-shares it as a lifecycle-aware [UiState] (ADR-002): the view performs no HTTP or
// persistence — it collects [state] and forwards the picks. The persisted selection is the surface's only
// async dependency, so its cache-then-network lifecycle drives the picker's loading / content /
// empty (defensive) / error / stale / offline states. [selectTheme]/[selectMode]/[applyCustomColors] persist
// + broadcast the user's pick (web `setTheme`/`setMode`/`setCustomColors`), [retry]/[refresh] re-read
// persistence, and [onViewOpened] emits the one PII-safe `view.opened` diagnostic (P1/S11) — the surface
// slug only, never a theme id or colour.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ThemePicker) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.themepicker

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * State holder for the ThemePicker surface.
 *
 * The persisted selection feed is folded with the static brand catalogues ([ThemeCatalog.project]) and
 * re-shared as lifecycle-aware [UiState] so the composable can switch the picker's surface — loading (first
 * hydrate), content (the mode + accent grids and custom builder), the defensive empty branch (a friendly
 * state if the catalogue is ever empty), a hard error with retry, and the stale/offline freshness envelope —
 * without re-deriving the cache-then-network contract. [selectTheme]/[selectMode]/[applyCustomColors]
 * persist + broadcast the user's pick (web `setTheme`/`setMode`/`setCustomColors`), [retry] re-reads
 * persistence, and [onViewOpened] emits the one PII-safe `view.opened` diagnostic (P1/S11).
 *
 * @param source the preference seam (a shared-store adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ThemePickerViewModel(
    private val source: ThemePickerSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The persisted selection folded with the brand catalogues as lifecycle-aware [UiState] — the surface's
     * primary feed. The empty phase is the defensive "no theme options" branch ([ThemePickerData.isEmpty]),
     * unreachable with the static catalogue but surfaced as a friendly state rather than a blank box.
     */
    val state: StateFlow<UiState<ThemePickerData>> =
        refreshTrigger
            .flatMapLatest { source.selection() }
            .map { resource -> resource.foldData(ThemeCatalog::project) }
            .asUiState(isEmpty = { it.isEmpty })

    init {
        // Trigger the first persistence read; `state` starts at loading and flips to content/empty/error.
        source.hydrate()
    }

    /** Persists + broadcasts the chosen brand theme and logs a PII-safe diagnostic (web `setTheme`). */
    fun selectTheme(themeId: String) {
        logger.info(EVENT_THEME_SELECTED, SURFACE_FIELD)
        source.setTheme(themeId)
    }

    /** Persists + broadcasts the chosen display mode and logs a PII-safe diagnostic (web `setMode`). */
    fun selectMode(modeId: String) {
        logger.info(EVENT_MODE_SELECTED, SURFACE_FIELD)
        source.setMode(modeId)
    }

    /** Persists + broadcasts custom colours (pinning the custom theme) and logs a PII-safe diagnostic. */
    fun applyCustomColors(
        primary: Long,
        accent: Long,
    ) {
        logger.info(EVENT_CUSTOM_COLORS, SURFACE_FIELD)
        source.setCustomColors(primary, accent)
    }

    /** Re-reads persistence after a hard error (web has no equivalent — this backs the picker's retry). */
    fun retry() {
        logger.info(EVENT_REFRESH, SURFACE_FIELD)
        source.hydrate()
        refreshTrigger.update { it + 1 }
    }

    /** Re-reads persistence; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no theme id, colour, or hex value. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordThemePickerOpened(logger)
    }

    companion object {
        /** Wires the surface from the shared [ThemePreferenceStore] (web `useTheme()`). */
        fun create(
            store: ThemePreferenceStore,
            logger: Logger,
        ): ThemePickerViewModel = ThemePickerViewModel(StoreThemePickerSource(store), logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: ThemePickerSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ThemePickerViewModel(source, logger) }
            }
    }
}

/**
 * Maps the payload of a cache-then-network [Resource] without touching its freshness envelope — folds a
 * `Resource<ThemeSelection>` into a `Resource<ThemePickerData>` by combining the persisted selection with
 * the static catalogues, preserving the Loading/Success/Error phase, the cached value, the stamp, the stale
 * flag, and any error so the [io.teslasync.android.data.toUiState] projection still derives every state.
 */
private fun Resource<ThemeSelection>.foldData(transform: (ThemeSelection) -> ThemePickerData): Resource<ThemePickerData> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }
