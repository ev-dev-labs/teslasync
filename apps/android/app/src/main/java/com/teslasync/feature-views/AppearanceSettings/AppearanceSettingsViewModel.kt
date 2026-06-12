// UI-thread-free state holder backing the AppearanceSettings feature view — the native port of the eight-hook
// composition the web component owns (web/src/features/settings/components/AppearanceSettings.tsx). It binds the
// shared settings feed + device-local prefs (P1/S8) through [AppearanceSettingsSource], projects the
// server-backed appearance fields onto the shared [UiState] surface (loading / content / empty / stale /
// offline / error), re-exposes the three device-local pref flows, runs the partial-merge `PUT /settings`
// writes + the local pref + tour mutations raising the matching toasts, and emits the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects state and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AppearanceSettings) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.appearancesettings

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
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** The transient toasts the surface raises (web `useToast`), localized + toned at the Compose boundary (P1/S10). */
enum class AppearanceToast {
    /** Web `toast.info('Status bar shown')`. */
    StatusBarShown,

    /** Web `toast.info('Status bar hidden')`. */
    StatusBarHidden,

    /** Web `toast.success('All tours reset …')`. */
    ToursReset,
}

/**
 * Lifecycle-aware state holder backing the Compose [AppearanceSettings]. It consumes the cache-then-network
 * settings feed (re-shared as [serverPrefs]) and the three device-local pref flows, so the screen stays a
 * stateless Composable that only renders. The server-backed density / time-format / chart-palette controls are
 * disabled until settings resolve (web `disabled={!settings || saveSettings.isPending}`); an empty document
 * still renders the editor showing defaults; a hard error keeps any cached value visible with retry.
 *
 * It owns no networking. [refresh]/[retry] re-collect the settings feed; each mutation delegates to the source,
 * the three server writes use the partial-merge builders and refresh the feed on success, and the status-bar /
 * tours-reset mutations raise the matching [AppearanceToast]. [onViewOpened] emits the one-shot `view.opened`
 * diagnostic (P1/S11).
 *
 * @param source the settings + device-local prefs seam (a shared-layer adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + mutation events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AppearanceSettingsViewModel(
    private val source: AppearanceSettingsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the settings feed (the manual retry + post-save refresh).
    private val refreshTrigger = MutableStateFlow(0)
    private val savingState = MutableStateFlow(false)
    private val toastChannel = Channel<AppearanceToast>(Channel.BUFFERED)
    private var viewOpenedRecorded = false

    private val settingsFeed: StateFlow<Resource<JsonElement>> =
        refreshTrigger
            .flatMapLatest { source.settings() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(FEED_STOP_TIMEOUT_MILLIS),
                initialValue = Resource.Loading(cached = null, fetchedAt = null, stale = false),
            )

    /**
     * The server-backed appearance fields as cache-then-network UI state: loading / content / empty (the
     * document carried none of the three keys yet) / stale / offline / error, carrying the freshness stamp +
     * error kind. Drives the density / time-format / chart-palette controls.
     */
    val serverPrefs: StateFlow<UiState<AppearanceServerPrefs>> =
        settingsFeed
            .map { AppearanceSettingsProjection.projectResource(it) }
            .asUiState { !it.present }

    /** Device-local footer status-bar prefs (web `useStatusBarPrefs`). */
    val statusBar: StateFlow<StatusBarPrefs> = source.statusBar

    /** Device-local achievement-celebration prefs (web `useAchievementCelebrationPrefs`). */
    val celebration: StateFlow<CelebrationPrefs> = source.celebration

    /** Device-local sidebar style (web `useSidebarStyle`). */
    val sidebarStyle: StateFlow<SidebarStyle> = source.sidebarStyle

    /** Whether a settings save is in flight — disables the server-backed controls (web `saveSettings.isPending`). */
    val saving: StateFlow<Boolean> = savingState

    /** Typed toasts the composable maps to localized surfaces (web `useToast`). */
    val toasts: Flow<AppearanceToast> = toastChannel.receiveAsFlow()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no preference value, so a diagnostics line can never leak what a user has configured.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAppearanceSettingsViewOpened(logger)
    }

    /** Re-runs the cache-then-network load of the settings feed (web `refetch()`); backs the retry affordance. */
    fun refresh() {
        logger.info("appearanceSettings.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error/offline surface's retry affordance. */
    fun retry(): Unit = refresh()

    /** Sets the information density (web `setDensity`); a no-op when unchanged or settings have not loaded. */
    fun setDensity(next: DensityId) {
        val current = settingsFeed.value.cached ?: return
        if (AppearanceSettingsProjection.parseServerPrefs(current).density == next) return
        saveDocument(AppearanceSettingsProjection.withDensity(current, next))
    }

    /** Sets the default time format (web `setTimeFormat`); a no-op when unchanged or settings have not loaded. */
    fun setTimeFormat(next: TimeFormatId) {
        val current = settingsFeed.value.cached ?: return
        if (AppearanceSettingsProjection.parseServerPrefs(current).timeFormat == next) return
        saveDocument(AppearanceSettingsProjection.withTimeFormat(current, next))
    }

    /** Sets the chart palette (web `setChartPalette`); a no-op when unchanged or settings have not loaded. */
    fun setChartPalette(next: ChartPaletteId) {
        val current = settingsFeed.value.cached ?: return
        if (AppearanceSettingsProjection.parseServerPrefs(current).chartPalette == next) return
        saveDocument(AppearanceSettingsProjection.withChartPalette(current, next))
    }

    /** Shows/hides the footer status bar (web `setStatusBarPrefs({ enabled })` + the info toast). */
    fun setStatusBarEnabled(enabled: Boolean) {
        source.setStatusBar(source.statusBar.value.copy(enabled = enabled))
        emitToast(if (enabled) AppearanceToast.StatusBarShown else AppearanceToast.StatusBarHidden)
    }

    /** Forces icon-only mode (web `setStatusBarPrefs({ iconOnly })`); no toast. */
    fun setStatusBarIconOnly(iconOnly: Boolean) {
        source.setStatusBar(source.statusBar.value.copy(iconOnly = iconOnly))
    }

    /** Toggles the celebration toast (web `setAchievementCelebrationPrefs({ showToasts })`). */
    fun setCelebrationShowToasts(value: Boolean) {
        source.setCelebration(source.celebration.value.copy(showToasts = value))
    }

    /** Toggles the unlock chime (web `setAchievementCelebrationPrefs({ playSound })`). */
    fun setCelebrationPlaySound(value: Boolean) {
        source.setCelebration(source.celebration.value.copy(playSound = value))
    }

    /** Toggles the dashboard "recently unlocked" widget (web `setAchievementCelebrationPrefs({ showOnDashboard })`). */
    fun setCelebrationShowOnDashboard(value: Boolean) {
        source.setCelebration(source.celebration.value.copy(showOnDashboard = value))
    }

    /** Toggles achievement push delivery (web `setAchievementCelebrationPrefs({ pushOnUnlock })`). */
    fun setCelebrationPushOnUnlock(value: Boolean) {
        source.setCelebration(source.celebration.value.copy(pushOnUnlock = value))
    }

    /** Selects the sidebar style (web `setSidebarStyle`); device-local, no save. */
    fun setSidebarStyle(style: SidebarStyle) {
        source.setSidebarStyle(style)
    }

    /** Requests a replay of [tour] (web `startTour(id)`); records a PII-safe diagnostic. */
    fun replayTour(tour: ProductTour) {
        source.replayTour(tour)
        logger.info("appearanceSettings.tourReplay", mapOf("tour" to tour.wire))
    }

    /** Clears every tour's seen flag (web `resetAllTours()` + the success toast). */
    fun resetAllTours() {
        source.resetAllTours()
        logger.info("appearanceSettings.toursReset")
        emitToast(AppearanceToast.ToursReset)
    }

    private fun saveDocument(document: JsonObject) {
        launch {
            savingState.update { true }
            source
                .saveSettings(document)
                .onSuccess { refreshTrigger.update { it + 1 } }
                .onFailure { logger.warn("appearanceSettings.saveFailed") }
            savingState.update { false }
        }
    }

    private fun emitToast(toast: AppearanceToast) {
        toastChannel.trySend(toast)
    }

    companion object {
        private const val FEED_STOP_TIMEOUT_MILLIS = 5_000L

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: AppearanceSettingsSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AppearanceSettingsViewModel(source, logger) }
            }

        /** Wire the surface from the shared **S8** [SettingsStore] + a device-local [AppearanceLocalStore]. */
        fun create(
            settingsStore: SettingsStore,
            local: AppearanceLocalStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): AppearanceSettingsViewModel = AppearanceSettingsViewModel(bindAppearanceSettingsSource(settingsStore, local), logger, scope)
    }
}
