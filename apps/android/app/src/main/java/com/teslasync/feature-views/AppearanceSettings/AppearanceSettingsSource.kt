// The data port the AppearanceSettings feature view binds to — the native analogue of the eight hooks the web
// component composes (web/src/features/settings/components/AppearanceSettings.tsx):
//   • useSettings / useSaveSettings → the shared S8 SettingsStore `GET /settings` document + full-replace
//     `PUT /settings` (the partial-merge `{ ...settings, ui_density }` write pattern);
//   • useChartPalette → derived from the same settings document's `chart_palette` field (no separate feed);
//   • useStatusBarPrefs / useAchievementCelebrationPrefs / useSidebarStyle → device-local reactive prefs the web
//     persists to localStorage, here a reactive [AppearanceLocalStore] (an injected seam, never the network);
//   • the product-tours replay/reset actions (web `tourLauncher` / `tourRegistry`).
// The view performs NO HTTP and never touches persistence directly — it binds this seam, and a test fake stands
// in for the whole domain.
//
// `InvalidPackageDeclaration`/`ktlint:standard:filename`/`MatchingDeclarationName` are suppressed: the mandated
// surface directory (com/teslasync/feature-views/AppearanceSettings) cannot form a valid Kotlin package and the
// file hosts the seam plus its device-local bindings, mirroring the sibling surfaces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.appearancesettings

import android.content.SharedPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [AppearanceSettingsViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never to a concrete store or the network. [settings]/[saveSettings] are the shared **S8**
 * settings-document feed + full-replace write (web `useSettings` / `useSaveSettings`); the three device-local
 * pref flows + their setters mirror the web localStorage hooks (`useStatusBarPrefs`,
 * `useAchievementCelebrationPrefs`, `useSidebarStyle`); the tour actions mirror the web `tourLauncher` /
 * `tourRegistry`. No HTTP touches the view.
 */
interface AppearanceSettingsSource {
    /** Stream the cache-then-network `GET /settings` document (web `useSettings`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** Full-replace `PUT /settings` with the merged [document] (web `useSaveSettings`). Refreshes the feed on success. */
    suspend fun saveSettings(document: JsonElement): Result<JsonElement>

    /** Device-local footer status-bar prefs (web `useStatusBarPrefs`). */
    val statusBar: StateFlow<StatusBarPrefs>

    /** Device-local achievement-celebration prefs (web `useAchievementCelebrationPrefs`). */
    val celebration: StateFlow<CelebrationPrefs>

    /** Device-local sidebar style (web `useSidebarStyle`). */
    val sidebarStyle: StateFlow<SidebarStyle>

    /** Persists the footer status-bar prefs (web `setStatusBarPrefs`). */
    fun setStatusBar(prefs: StatusBarPrefs)

    /** Persists the celebration prefs (web `setAchievementCelebrationPrefs`). */
    fun setCelebration(prefs: CelebrationPrefs)

    /** Persists the sidebar style (web `setSidebarStyle`). */
    fun setSidebarStyle(style: SidebarStyle)

    /** Requests a replay of one onboarding tour (web `startTour`). */
    fun replayTour(tour: ProductTour)

    /** Clears every tour's "seen" flag so they replay (web `resetAllTours`). */
    fun resetAllTours()
}

/**
 * The reactive device-local preferences a [AppearanceSettingsSource] composes alongside the shared settings
 * feed — the native analogue of the three web localStorage hooks. Kept behind an interface so the view-model is
 * unit-tested over an in-memory fake while production persists to [SharedPreferences].
 */
interface AppearanceLocalStore {
    val statusBar: StateFlow<StatusBarPrefs>
    val celebration: StateFlow<CelebrationPrefs>
    val sidebarStyle: StateFlow<SidebarStyle>

    fun setStatusBar(prefs: StatusBarPrefs)

    fun setCelebration(prefs: CelebrationPrefs)

    fun setSidebarStyle(style: SidebarStyle)

    fun replayTour(tour: ProductTour)

    fun resetAllTours()
}

/**
 * In-memory [AppearanceLocalStore] seeded from the web defaults (status bar shown, icon-only off; celebration
 * toasts + dashboard + push on, sound off; sidebar `linear`). The default binding for previews/tests and the
 * fallback when no persistent store is wired. Reactive: every setter pushes the new value to its [StateFlow].
 */
class InMemoryAppearanceLocalStore(
    statusBar: StatusBarPrefs = StatusBarPrefs(),
    celebration: CelebrationPrefs = CelebrationPrefs(),
    sidebarStyle: SidebarStyle = SidebarStyle.Linear,
    completedTours: Set<ProductTour> = ProductTour.entries.toSet(),
) : AppearanceLocalStore {
    private val statusBarState = MutableStateFlow(statusBar)
    private val celebrationState = MutableStateFlow(celebration)
    private val sidebarState = MutableStateFlow(sidebarStyle)
    private val completed = MutableStateFlow(completedTours)

    /** The tours whose onboarding has been seen; cleared by [resetAllTours]. Exposed for assertions. */
    val completedTours: StateFlow<Set<ProductTour>> = completed.asStateFlow()

    override val statusBar: StateFlow<StatusBarPrefs> = statusBarState.asStateFlow()
    override val celebration: StateFlow<CelebrationPrefs> = celebrationState.asStateFlow()
    override val sidebarStyle: StateFlow<SidebarStyle> = sidebarState.asStateFlow()

    override fun setStatusBar(prefs: StatusBarPrefs) = statusBarState.update { prefs }

    override fun setCelebration(prefs: CelebrationPrefs) = celebrationState.update { prefs }

    override fun setSidebarStyle(style: SidebarStyle) = sidebarState.update { style }

    override fun replayTour(tour: ProductTour) = completed.update { it - tour }

    override fun resetAllTours() = completed.update { emptySet() }
}

/**
 * [SharedPreferences]-backed [AppearanceLocalStore] — the production persistence the web gets from localStorage:
 * values survive process death and a setter both persists and re-emits so the open surface reflects the change
 * instantly. Pure of any Android `Context` (it takes the resolved [prefs]) so it stays straightforward to wire.
 */
class SharedPreferencesAppearanceLocalStore(
    private val prefs: SharedPreferences,
) : AppearanceLocalStore {
    private val statusBarState = MutableStateFlow(readStatusBar())
    private val celebrationState = MutableStateFlow(readCelebration())
    private val sidebarState = MutableStateFlow(readSidebar())

    override val statusBar: StateFlow<StatusBarPrefs> = statusBarState.asStateFlow()
    override val celebration: StateFlow<CelebrationPrefs> = celebrationState.asStateFlow()
    override val sidebarStyle: StateFlow<SidebarStyle> = sidebarState.asStateFlow()

    override fun setStatusBar(prefs: StatusBarPrefs) {
        this.prefs
            .edit()
            .putBoolean(KEY_SB_ENABLED, prefs.enabled)
            .putBoolean(KEY_SB_ICON_ONLY, prefs.iconOnly)
            .apply()
        statusBarState.update { prefs }
    }

    override fun setCelebration(prefs: CelebrationPrefs) {
        this.prefs
            .edit()
            .putBoolean(KEY_CB_TOASTS, prefs.showToasts)
            .putBoolean(KEY_CB_SOUND, prefs.playSound)
            .putBoolean(KEY_CB_DASHBOARD, prefs.showOnDashboard)
            .putBoolean(KEY_CB_PUSH, prefs.pushOnUnlock)
            .apply()
        celebrationState.update { prefs }
    }

    override fun setSidebarStyle(style: SidebarStyle) {
        prefs.edit().putString(KEY_SIDEBAR, style.wire).apply()
        sidebarState.update { style }
    }

    override fun replayTour(tour: ProductTour) {
        prefs.edit().putStringSet(KEY_TOURS_DONE, currentDone() - tour.wire).apply()
    }

    override fun resetAllTours() {
        prefs.edit().remove(KEY_TOURS_DONE).apply()
    }

    private fun readStatusBar(): StatusBarPrefs =
        StatusBarPrefs(
            enabled = prefs.getBoolean(KEY_SB_ENABLED, StatusBarPrefs().enabled),
            iconOnly = prefs.getBoolean(KEY_SB_ICON_ONLY, StatusBarPrefs().iconOnly),
        )

    private fun readCelebration(): CelebrationPrefs =
        CelebrationPrefs().let { d ->
            CelebrationPrefs(
                showToasts = prefs.getBoolean(KEY_CB_TOASTS, d.showToasts),
                playSound = prefs.getBoolean(KEY_CB_SOUND, d.playSound),
                showOnDashboard = prefs.getBoolean(KEY_CB_DASHBOARD, d.showOnDashboard),
                pushOnUnlock = prefs.getBoolean(KEY_CB_PUSH, d.pushOnUnlock),
            )
        }

    private fun readSidebar(): SidebarStyle = SidebarStyle.from(prefs.getString(KEY_SIDEBAR, null))

    private fun currentDone(): Set<String> = prefs.getStringSet(KEY_TOURS_DONE, emptySet())?.toSet() ?: emptySet()

    private companion object {
        const val KEY_SB_ENABLED = "appearance.statusBar.enabled"
        const val KEY_SB_ICON_ONLY = "appearance.statusBar.iconOnly"
        const val KEY_CB_TOASTS = "appearance.celebration.showToasts"
        const val KEY_CB_SOUND = "appearance.celebration.playSound"
        const val KEY_CB_DASHBOARD = "appearance.celebration.showOnDashboard"
        const val KEY_CB_PUSH = "appearance.celebration.pushOnUnlock"
        const val KEY_SIDEBAR = "appearance.sidebarStyle"
        const val KEY_TOURS_DONE = "appearance.tours.completed"
    }
}

/**
 * Binds the surface to the shared **S8** [SettingsStore] (the settings document + full-replace save, exactly the
 * feeds/invalidations the web `useSettings` / `useSaveSettings` hooks own) and the device-local [local] prefs
 * store. Re-collecting [settings] performs a genuine cache-then-network re-fetch backing the refresh/retry
 * affordance; [saveSettings] routes through the store so it refreshes the settings feed on success. No HTTP
 * touches the view.
 */
fun bindAppearanceSettingsSource(
    settingsStore: SettingsStore,
    local: AppearanceLocalStore,
): AppearanceSettingsSource =
    object : AppearanceSettingsSource {
        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override suspend fun saveSettings(document: JsonElement): Result<JsonElement> = settingsStore.saveSettings(document)

        override val statusBar: StateFlow<StatusBarPrefs> get() = local.statusBar
        override val celebration: StateFlow<CelebrationPrefs> get() = local.celebration
        override val sidebarStyle: StateFlow<SidebarStyle> get() = local.sidebarStyle

        override fun setStatusBar(prefs: StatusBarPrefs) = local.setStatusBar(prefs)

        override fun setCelebration(prefs: CelebrationPrefs) = local.setCelebration(prefs)

        override fun setSidebarStyle(style: SidebarStyle) = local.setSidebarStyle(style)

        override fun replayTour(tour: ProductTour) = local.replayTour(tour)

        override fun resetAllTours() = local.resetAllTours()
    }
