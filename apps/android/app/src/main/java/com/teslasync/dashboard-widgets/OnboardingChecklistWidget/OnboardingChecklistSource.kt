// The data ports the Onboarding Checklist widget binds to — the native analogue of the web
// `useChecklistTasks` hook composition (web/src/features/onboarding/checklist.ts, consumed by
// web/src/features/dashboard/widgets/OnboardingChecklistWidget.tsx). The view never performs HTTP; a
// concrete adapter over the shared S8 state holders (or a test fake) drives these seams. Two seams: a
// cache-then-network read feed that folds the four live sources the web reads (vehicles, alert rules,
// notification channels, theme) together with the five client-persisted checklist flags into one
// [OnboardingChecklistInputs] stream, and a small write port for the dismiss / restart affordances + the
// 100%-complete stamping the web persists to localStorage. Cache-then-network freshness is preserved end
// to end (ADR-013): the aggregate keeps the loading / refreshing / stale / offline character of the
// underlying feeds exactly as the web lets its hooks default to empty while loading.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/OnboardingChecklistWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.onboardingchecklist

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * Streams the cache-then-network sequence of resolved checklist inputs the widget renders. A single-method
 * seam so the view-model depends on an abstraction (real adapter <-> test fake), never on a concrete store
 * or the network.
 */
fun interface OnboardingChecklistSource {
    /** The cache-then-network input feed (cached values first for an instant cold start, then refreshed). */
    fun stream(): Flow<Resource<OnboardingChecklistInputs>>
}

/**
 * The client-persisted checklist flags — the native analogue of the web localStorage helpers in
 * web/src/features/onboarding/checklist.ts. The three read-only flags ([commandPaletteDiscovered],
 * [webPushGranted], [customizeDashboardCompleted]) are written by other surfaces / the platform
 * permission state; the widget only mutates [dismissed] + the 100%-complete [completedAt] stamp via
 * [setDismissed] / [setCompletedAt] (web `setChecklistDismissed` / `setChecklistCompletedAt`). Exposed as
 * reactive flows so a flag flipping anywhere re-renders the widget, exactly like the web
 * `useChecklistFlagVersion` subscription.
 */
interface OnboardingChecklistPreferences {
    /** Whether the command palette has been opened at least once (web `isCommandPaletteDiscovered`). */
    val commandPaletteDiscovered: Flow<Boolean>

    /** Whether web/system push notifications are granted (web `isWebPushGranted`). */
    val webPushGranted: Flow<Boolean>

    /** Whether the user has added a dashboard widget through the catalogue (web `isCustomizeDashboardCompleted`). */
    val customizeDashboardCompleted: Flow<Boolean>

    /** Whether the user has explicitly dismissed the checklist (web `isChecklistDismissed`). */
    val dismissed: Flow<Boolean>

    /** Epoch-ms the checklist first hit 100%, or `null` (web `getChecklistCompletedAt`). */
    val completedAt: Flow<Long?>

    /** Persists the dismissed flag (web `setChecklistDismissed`). */
    suspend fun setDismissed(dismissed: Boolean)

    /** Persists (or clears) the 100%-complete timestamp (web `setChecklistCompletedAt`). */
    suspend fun setCompletedAt(epochMs: Long?)
}

/**
 * The aggregate freshness + counts folded from the four live feeds — an internal, pure intermediate so
 * [buildChecklistResource] can be unit-tested without coroutines. [coldStart] is the web "everything is
 * still loading with nothing cached" first frame; [refreshing] / [stale] / [error] preserve the
 * cache-then-network character of the underlying feeds.
 */
internal data class NetworkAggregate(
    val vehicleCount: Int,
    val alertRuleCount: Int,
    val channelCount: Int,
    val themeId: String,
    val coldStart: Boolean,
    val refreshing: Boolean,
    val stale: Boolean,
    val error: Throwable?,
    val fetchedAt: Long?,
)

/** The five client-persisted flags captured at one instant (web localStorage snapshot). */
internal data class ChecklistPrefsSnapshot(
    val commandPaletteDiscovered: Boolean,
    val webPushGranted: Boolean,
    val customizeDashboardCompleted: Boolean,
    val dismissed: Boolean,
    val completedAt: Long?,
)

/**
 * Resolves the theme id from the `/settings` document — the native analogue of the web `useTheme().themeId`
 * (the `settings.theme` field the ThemeProvider seeds from). Defaults to
 * [OnboardingChecklistProjection.DEFAULT_THEME_ID] when the document is absent or the field is missing/blank,
 * so a not-yet-loaded settings feed reads as "default theme" (the web initial state). Pure, so the contract
 * is unit-tested without a network.
 */
internal fun resolveThemeId(settings: JsonElement?): String {
    val value = ((settings as? JsonObject)?.get("theme") as? JsonPrimitive)?.contentOrNull
    return if (value.isNullOrBlank()) OnboardingChecklistProjection.DEFAULT_THEME_ID else value
}

/** The fetched-at stamp of any [Resource] variant, or `null`. */
private fun fetchedAtOf(resource: Resource<*>): Long? =
    when (resource) {
        is Resource.Loading -> resource.fetchedAt
        is Resource.Success -> resource.fetchedAt
        is Resource.Error -> resource.fetchedAt
    }

/**
 * Folds the four live feeds into a [NetworkAggregate], reading each feed's best-available value
 * (`Resource.cached`, which is the fresh value on success) and defaulting counts to 0 — the web
 * `vehicles?.length ?? 0` behaviour. Pure, so it is unit-tested without a network or cache.
 */
internal fun aggregateNetwork(
    vehicles: Resource<List<Vehicle>>,
    alertRules: Resource<List<AlertRule>>,
    channels: Resource<List<NotificationChannel>>,
    settings: Resource<JsonElement>,
): NetworkAggregate {
    val all = listOf(vehicles, alertRules, channels, settings)
    return NetworkAggregate(
        vehicleCount = vehicles.cached?.size ?: 0,
        alertRuleCount = alertRules.cached?.size ?: 0,
        channelCount = channels.cached?.size ?: 0,
        themeId = resolveThemeId(settings.cached),
        coldStart = all.all { it is Resource.Loading && it.cached == null },
        refreshing = all.any { it is Resource.Loading && it.cached != null },
        stale = all.any { it.stale },
        error = all.firstNotNullOfOrNull { (it as? Resource.Error)?.error },
        fetchedAt = all.mapNotNull(::fetchedAtOf).maxOrNull(),
    )
}

/**
 * Combines the aggregate live feeds with the persisted [prefs] into the cache-then-network
 * [Resource]<[OnboardingChecklistInputs]> the widget renders. A cold start (all four feeds loading, none
 * cached) maps to a content-less [Resource.Loading] (the brief skeleton frame). Otherwise the inputs are
 * always buildable — counts default to 0 and the persisted flags are always available — so the checklist
 * always renders (the web behaviour of never blanking): a failed live refresh degrades to an offline
 * [Resource.Error] that keeps the inputs visible with `stale = true` + a retry, and an in-flight refresh
 * keeps them visible while flagging `refreshing`. Pure, so it is unit-tested without coroutines.
 */
internal fun buildChecklistResource(
    network: NetworkAggregate,
    prefs: ChecklistPrefsSnapshot,
): Resource<OnboardingChecklistInputs> {
    if (network.coldStart) return Resource.Loading(cached = null, fetchedAt = null, stale = false)
    val inputs =
        OnboardingChecklistInputs(
            vehicleCount = network.vehicleCount,
            alertRuleCount = network.alertRuleCount,
            channelCount = network.channelCount,
            themeId = network.themeId,
            commandPaletteDiscovered = prefs.commandPaletteDiscovered,
            webPushGranted = prefs.webPushGranted,
            customizeDashboardCompleted = prefs.customizeDashboardCompleted,
            dismissed = prefs.dismissed,
            completedAt = prefs.completedAt,
        )
    val error = network.error
    return when {
        error != null -> Resource.Error(cached = inputs, fetchedAt = network.fetchedAt, stale = true, error = error)
        network.refreshing -> Resource.Loading(cached = inputs, fetchedAt = network.fetchedAt, stale = network.stale)
        else -> Resource.Success(data = inputs, fetchedAt = network.fetchedAt ?: 0L, stale = network.stale)
    }
}

/**
 * The shared-state-holder-backed [OnboardingChecklistSource]. It folds the shared [VehiclesStore.vehicles]
 * (web `useVehicles`), [NotificationsStore.alertRules] (web `useAlertRules`),
 * [NotificationsStore.notificationChannels] (web `useNotificationChannels`), and [SettingsStore.settings]
 * (the web `useTheme` source) feeds together with the persisted [preferences] flags via
 * [aggregateNetwork] + [buildChecklistResource]. No HTTP touches the view — the shared holders (S7/S8)
 * own it.
 */
class StoreOnboardingChecklistSource(
    private val vehiclesStore: VehiclesStore,
    private val notificationsStore: NotificationsStore,
    private val settingsStore: SettingsStore,
    private val preferences: OnboardingChecklistPreferences,
) : OnboardingChecklistSource {
    override fun stream(): Flow<Resource<OnboardingChecklistInputs>> {
        val network =
            combine(
                vehiclesStore.vehicles(),
                notificationsStore.alertRules(),
                notificationsStore.notificationChannels(),
                settingsStore.settings(),
            ) { vehicles, alertRules, channels, settings -> aggregateNetwork(vehicles, alertRules, channels, settings) }
        val prefs =
            combine(
                preferences.commandPaletteDiscovered,
                preferences.webPushGranted,
                preferences.customizeDashboardCompleted,
                preferences.dismissed,
                preferences.completedAt,
            ) { cp, push, customize, dismissed, completedAt ->
                ChecklistPrefsSnapshot(cp, push, customize, dismissed, completedAt)
            }
        return combine(network, prefs) { net, snapshot -> buildChecklistResource(net, snapshot) }
    }
}

/**
 * An in-memory [OnboardingChecklistPreferences] — the default for hosts that have not yet wired a
 * persistent store and the controllable fake for tests. The widget's dismiss / restart / completion
 * stamping flows through [setDismissed] / [setCompletedAt]; the read-only flags expose [markCommandPalette]
 * / [setWebPushGranted] / [markCustomizeDashboard] so callers can model the web localStorage / permission
 * transitions deterministically.
 */
class InMemoryOnboardingChecklistPreferences(
    commandPaletteDiscovered: Boolean = false,
    webPushGranted: Boolean = false,
    customizeDashboardCompleted: Boolean = false,
    dismissed: Boolean = false,
    completedAt: Long? = null,
) : OnboardingChecklistPreferences {
    private val commandPaletteState = MutableStateFlow(commandPaletteDiscovered)
    private val webPushState = MutableStateFlow(webPushGranted)
    private val customizeState = MutableStateFlow(customizeDashboardCompleted)
    private val dismissedState = MutableStateFlow(dismissed)
    private val completedAtState = MutableStateFlow(completedAt)

    override val commandPaletteDiscovered: StateFlow<Boolean> = commandPaletteState.asStateFlow()
    override val webPushGranted: StateFlow<Boolean> = webPushState.asStateFlow()
    override val customizeDashboardCompleted: StateFlow<Boolean> = customizeState.asStateFlow()
    override val dismissed: StateFlow<Boolean> = dismissedState.asStateFlow()
    override val completedAt: StateFlow<Long?> = completedAtState.asStateFlow()

    override suspend fun setDismissed(dismissed: Boolean) {
        dismissedState.value = dismissed
    }

    override suspend fun setCompletedAt(epochMs: Long?) {
        completedAtState.value = epochMs
    }

    /** Records command-palette discovery (web `markCommandPaletteDiscovered`). */
    fun markCommandPalette() {
        commandPaletteState.value = true
    }

    /** Updates the web/system push-grant flag (web `Notification.permission === 'granted'`). */
    fun setWebPushGranted(granted: Boolean) {
        webPushState.value = granted
    }

    /** Records first dashboard-widget add (web `markCustomizeDashboardCompleted`). */
    fun markCustomizeDashboard() {
        customizeState.value = true
    }
}
