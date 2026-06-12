// UI-thread-free state holder backing the AISettings feature view — the native port of the settings/AI hook
// composition the web component owns (web/src/features/settings/components/AISettings.tsx). It binds the shared
// cache-then-network [AISettingsViewSource] (P1/S8), projects the `/settings` document onto the [UiState]
// surface (loading / content / empty / stale / offline / error) as [AiSettingsProjection], exposes today's
// usage for the cost-cap bar, runs the save mutation (web `useSaveAiSettings`) tracking an in-flight [saving]
// flag, exposes the refresh/retry action, and emits the PII-safe `view.opened` diagnostic. The view never
// performs HTTP — it only collects state and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AISettings) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.aisettings

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.AiSettingsRepository
import io.teslasync.shared.core.data.repo.AiUsageRepository
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.aisettings.AiSettingsStore
import io.teslasync.shared.core.presentation.aiusage.AiUsageStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [AISettings] surface. It consumes the cache-then-network
 * [AISettingsViewSource] (P1/S8) and re-shares the two reads as [UiState] streams via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. A blank/absent
 * settings document maps to the empty surface (web "MUST always render", but native renders an honest empty
 * empty state rather than a default-off panel masquerading as data); an error keeps any cached value visible
 * with the offline/stale chip + retry, never blanking working content.
 *
 * It owns no networking. [refresh]/[retry] re-collect both feeds; [save] delegates to the source, flips the
 * in-flight [saving] flag the button binds to (web `saveAi.isPending`), and restarts the read collection on
 * success so the persisted mode is reflected. [recordViewOpened] emits the one-shot `view.opened` diagnostic
 * (P1/S11).
 *
 * @param source the cache-then-network settings/AI seam (a shared-layer adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + save/refresh events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AISettingsViewModel(
    private val source: AISettingsViewSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects both cache-then-network reads (manual retry + post-save refresh).
    private val refreshTrigger = MutableStateFlow(0)
    private val savingState = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /**
     * The `/settings` document as cache-then-network UI state: loading / content / empty (blank/absent
     * document) / stale / offline / error, carrying the freshness stamp + error kind, projected onto
     * [AiSettingsProjection] (mode + cost cap).
     */
    val settings: StateFlow<UiState<AiSettingsProjection>> =
        refreshTrigger
            .flatMapLatest { source.settings() }
            .map { it.mapData(::projectAiSettings) }
            .asUiState { !it.present }

    /**
     * Today's usage as cache-then-network UI state for the cost-cap bar. The emptiness predicate is `false` so
     * a resolved value (even all-zeros) always renders content — web parity: a no-rows payload shows an empty
     * bar, not a skeleton.
     */
    val usageToday: StateFlow<UiState<AiUsageToday>> =
        refreshTrigger
            .flatMapLatest { source.usageToday() }
            .map { it.mapData(::projectAiUsageToday) }
            .asUiState { false }

    /** Whether a save is in flight — backs the button's disabled + "Saving…" state (web `saveAi.isPending`). */
    val saving: StateFlow<Boolean> = savingState

    /** Re-runs the cache-then-network load of both reads (web `refetch()`); backs the retry affordance. */
    fun refresh() {
        logger.info("aiSettings.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error/offline surface's retry affordance. */
    fun retry(): Unit = refresh()

    /**
     * Saves the chosen [mode] (web `handleSave` → `useSaveAiSettings`). Flips [saving] for the button, builds
     * the patch (off clears `ai_features`), delegates to the source, and on success restarts the reads so the
     * persisted mode is reflected. The web component shows no toast, so neither does this — the in-flight flag
     * and the re-rendered mode are the feedback; a failure is logged (no PII) and leaves prior state intact.
     */
    fun save(mode: HelixMode) {
        if (savingState.value) return
        savingState.value = true
        logger.info("aiSettings.save", mapOf("mode" to mode.wire))
        launch {
            try {
                source.saveAiSettings(buildSavePatch(mode)).fold(
                    onSuccess = { refreshTrigger.update { it + 1 } },
                    onFailure = { logger.warn("aiSettings.saveFailed", mapOf("mode" to mode.wire)) },
                )
            } finally {
                savingState.value = false
            }
        }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no provider name, key, or spend figure, so a diagnostics line can never leak the configuration.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAISettingsViewOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: AISettingsViewSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AISettingsViewModel(source, logger) }
            }

        /** Wire the surface from the shared **S8** holders. */
        fun create(
            settingsStore: SettingsStore,
            aiUsageStore: AiUsageStore,
            aiSettingsStore: AiSettingsStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): AISettingsViewModel = AISettingsViewModel(aiSettingsViewSource(settingsStore, aiUsageStore, aiSettingsStore), logger, scope)

        /** Wire the surface from the shared **S7** repositories (refetch-on-retry binding). */
        fun create(
            settingsRepository: SettingsRepository,
            aiUsageRepository: AiUsageRepository,
            aiSettingsRepository: AiSettingsRepository,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): AISettingsViewModel =
            AISettingsViewModel(
                aiSettingsViewSource(settingsRepository, aiUsageRepository, aiSettingsRepository),
                logger,
                scope,
            )
    }
}
