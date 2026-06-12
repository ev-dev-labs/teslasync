// UI-thread-free state holder backing the Compose [NotificationSettings] surface — the native port of the
// web component's four-hook composition (web/src/features/settings/components/NotificationSettings.tsx:
// useSettings/useSaveSettings, useNotificationListener, useNotificationSoundPrefs/setNotificationSoundPrefs,
// playNotificationSound). It binds the bundled [NotificationSettingsSource] (P1/S8 layer): the
// network-backed `/settings` document is projected onto the shared [UiState] surface (loading / content /
// stale / offline / error) for the "browser tab signals" section, and the device-local web-push event +
// notification-sound preferences are exposed as Compose-collectable [StateFlow]s. It owns no networking,
// audio, or runtime-permission logic itself — those are seams (the Source) and Activity-coupled concerns
// (the composable). It emits the one PII-safe `view.opened` diagnostic (P1/S11) and never logs a value.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationSettings) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.notificationsettings

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * Lifecycle-aware state holder backing the Compose [NotificationSettings].
 *
 * It exposes three observable streams the screen renders: [tabSignals] (the cache-then-network `/settings`
 * flags as [UiState], the only network-backed source, so the section renders loading / content / stale /
 * offline / error), [soundPrefs] and [webPushPrefs] (the device-local preference snapshots). The seven
 * mutators persist through the [NotificationSettingsSource] and update the relevant stream; [testSound]
 * plays a channel's cue (web `handleTestSound` force-play) and returns the outcome so the composable can
 * re-show the playback hint. [retry]/[refresh] re-fetch the `/settings` document. The single network
 * read uses the refetch-on-retry repository binding, so a hard error's retry truly re-fetches.
 *
 * @param source the bundled surface seam (the production [DefaultNotificationSettingsSource] or a fake).
 * @param logger the single sanctioned redacting logger (ADR-016); receives only `view.opened`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationSettingsViewModel(
    private val source: NotificationSettingsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network `/settings` read (retry + post-save refresh).
    private val refreshTrigger = MutableStateFlow(0)

    private val documentFeed: StateFlow<Resource<JsonElement>> =
        refreshTrigger
            .flatMapLatest { source.settingsDocument() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = Resource.Loading(cached = null, fetchedAt = null, stale = false),
            )

    /**
     * The two browser-tab-signal flags as cache-then-network UI state. The emptiness predicate is `false`
     * so a resolved document always renders the toggles (web parity: missing fields default ON, never an
     * empty surface); the skeleton is the transient pre-resolve state.
     */
    val tabSignals: StateFlow<UiState<TabSignals>> =
        documentFeed
            .map { it.toTabSignals().toUiState { false } }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState.loading(),
            )

    private val mutableSoundPrefs = MutableStateFlow(NotificationSoundPrefs.DEFAULT)

    /** The device-local notification-sound preferences (web `useNotificationSoundPrefs`). */
    val soundPrefs: StateFlow<NotificationSoundPrefs> = mutableSoundPrefs.asStateFlow()

    private val mutableWebPushPrefs = MutableStateFlow(WebPushPrefs.DEFAULT)

    /** The device-local web-push event preferences (web `useNotificationListener` prefs). */
    val webPushPrefs: StateFlow<WebPushPrefs> = mutableWebPushPrefs.asStateFlow()

    private var viewOpenedRecorded = false
    private var prefsLoaded = false

    /**
     * Records the one-shot `view.opened` diagnostic (P1/S11 — PII-safe, surface slug only) and loads the
     * device-local preference snapshots. Call from the composable's first-composition effect.
     */
    fun onAppear() {
        if (!viewOpenedRecorded) {
            viewOpenedRecorded = true
            recordNotificationSettingsOpened(logger)
        }
        if (!prefsLoaded) {
            prefsLoaded = true
            launch {
                mutableSoundPrefs.value = source.loadSoundPrefs()
                mutableWebPushPrefs.value = source.loadWebPushPrefs()
            }
        }
    }

    /** Re-fetches the `/settings` document — backs the tab-signals retry + offline re-read affordances. */
    fun retry() {
        refreshTrigger.update { it + 1 }
    }

    /** Refresh over the visible tab-signals — identical to [retry]. */
    fun refresh(): Unit = retry()

    /** Sets the unread-count tab badge (web `tab_badge_enabled`) via the full-document save. */
    fun setTabBadge(enabled: Boolean): Unit = saveTabSignal(FIELD_TAB_BADGE_ENABLED, enabled)

    /** Sets the critical-alert tab flash (web `critical_flash_enabled`) via the full-document save. */
    fun setCriticalFlash(enabled: Boolean): Unit = saveTabSignal(FIELD_CRITICAL_FLASH_ENABLED, enabled)

    /** Sets the alerts push-event gate (web `setPrefs(prev => ({ ...prev, alerts }))`). */
    fun setAlerts(enabled: Boolean): Unit = patchWebPush { it.copy(alerts = enabled) }

    /** Sets the export-completions push-event gate (web `setPrefs(prev => ({ ...prev, exportStatus }))`). */
    fun setExportStatus(enabled: Boolean): Unit = patchWebPush { it.copy(exportStatus = enabled) }

    /** Toggles the master sound switch (web `handleMasterToggle`). */
    fun setSoundMaster(enabled: Boolean): Unit = patchSound(NotificationSoundPrefsPatch(master = enabled))

    /** Toggles one sound channel (web per-row `setNotificationSoundPrefs({ perCategory: { … } })`). */
    fun setSoundCategory(
        category: NotificationSoundCategory,
        enabled: Boolean,
    ): Unit = patchSound(NotificationSoundPrefsPatch(perCategory = mapOf(category to enabled)))

    /** Sets the output volume from a `0..100` slider value (web `setNotificationSoundPrefs({ volume: next/100 })`). */
    fun setVolumePercent(percent: Int): Unit = patchSound(NotificationSoundPrefsPatch(volume = percent / VOLUME_PERCENT_MAX))

    /**
     * Plays [category]'s cue with the Test-button force-play override (web `handleTestSound`) and returns
     * why it did or did not sound, so the composable can re-show the playback hint on an audio failure.
     */
    fun testSound(category: NotificationSoundCategory): SoundPlayResult =
        source.playSound(mutableSoundPrefs.value.testOverrideFor(category), category)

    private fun saveTabSignal(
        key: String,
        value: Boolean,
    ) {
        // Web `handleTestSound`'s sibling `updateTabSetting`: `if (!settings) return` — never save before load.
        val current = documentFeed.value.cached ?: return
        val merged = mergeTabSignal(current, key, value)
        launch {
            source.saveSettingsDocument(merged)
            refreshTrigger.update { it + 1 }
        }
    }

    private fun patchSound(patch: NotificationSoundPrefsPatch) {
        val next = mutableSoundPrefs.value.applyPatch(patch)
        if (next == mutableSoundPrefs.value) return
        mutableSoundPrefs.value = next
        launch { source.saveSoundPrefs(next) }
    }

    private fun patchWebPush(transform: (WebPushPrefs) -> WebPushPrefs) {
        val next = transform(mutableWebPushPrefs.value)
        if (next == mutableWebPushPrefs.value) return
        mutableWebPushPrefs.value = next
        launch { source.saveWebPushPrefs(next) }
    }

    companion object {
        private const val VOLUME_PERCENT_MAX = 100f

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: NotificationSettingsSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { NotificationSettingsViewModel(source, logger) }
            }

        /**
         * Wires the surface from the shared **S7** [SettingsRepository] (the refetch-on-retry binding) plus
         * the device-local preference stores and the cue player.
         */
        fun create(
            settingsRepository: SettingsRepository,
            webPushPrefsStore: WebPushPrefsStore,
            soundPrefsStore: NotificationSoundPrefsStore,
            player: NotificationSoundPlayer,
            logger: Logger,
        ): NotificationSettingsViewModel =
            NotificationSettingsViewModel(
                notificationSettingsSource(settingsRepository, webPushPrefsStore, soundPrefsStore, player),
                logger,
            )
    }
}
