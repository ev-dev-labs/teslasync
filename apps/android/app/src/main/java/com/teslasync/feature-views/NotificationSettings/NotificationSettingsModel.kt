// Pure, framework-free model + projections for the NotificationSettings feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/settings/components/NotificationSettings.tsx plus its useWebPush,
// useNotificationListener, useNotificationSoundPrefs and useSettings/useSaveSettings hooks and the
// web/src/lib/notificationSound.ts helpers). No Compose, no Android, no HTTP: every declaration here is
// exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render
// layer.
//
// The web panel is three stacked sections over four data sources. The only logic it owns is reproduced
// here: the per-category sound-preference normalisation / shallow-merge patch / volume clamp (web
// `normalizePrefs` / `setNotificationSoundPrefs` / `clamp`), the master+category+volume play-gate
// (web `playNotificationSound` reasons) and the Test-button "force play" override (web `handleTestSound`),
// the browser-notification permission branch (web `permission === 'default' | 'granted' | 'denied'`), the
// web-push event preferences (web `WebPushPreferences`), and the server "browser tab signals" read/merge
// (web `settings?.tab_badge_enabled !== false` default-ON read + the `{ ...settings, [key]: value }`
// full-document save). The browser web-push gate maps to the device's POST_NOTIFICATIONS permission and
// the localStorage-backed prefs map to device-local stores, so each binding is a seam in the Source.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/NotificationSettings — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.notificationsettings

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlin.math.roundToInt

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object NotificationSettingsRegistration {
    /** Stable surface id. */
    const val ID: String = "notification-settings"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "NotificationSettings"
}

// ── i18n key mirrors (P1/S10) ──
// The web `t('…')` keys (the `settings` namespace), flattened to the generated Android catalog names.
// Referencing them in one place keeps the composable and the off-device test in lockstep with the catalog
// and documents the web → native key contract. The composable resolves the matching `R.string.<name>`.

/** Header title — web `t('browserNotifications.title', 'Browser Notifications')`. */
const val KEY_BROWSER_TITLE: String = "translation_browserNotifications_title"

/** Header subtitle — web `t('browserNotifications.subtitle', …)`. */
const val KEY_BROWSER_SUBTITLE: String = "translation_browserNotifications_subtitle"

/** Unsupported notice — web `t('browserNotifications.unsupported', …)`. */
const val KEY_BROWSER_UNSUPPORTED: String = "translation_browserNotifications_unsupported"

/** Enable action — web `t('browserNotifications.enable', 'Enable Browser Notifications')`. */
const val KEY_BROWSER_ENABLE: String = "translation_browserNotifications_enable"

/** Enabled badge — web `t('browserNotifications.enabled', 'Enabled')`. */
const val KEY_BROWSER_ENABLED: String = "translation_browserNotifications_enabled"

/** Blocked notice — web `t('browserNotifications.blocked', …)`. */
const val KEY_BROWSER_BLOCKED: String = "translation_browserNotifications_blocked"

/** Events heading — web `t('browserNotifications.events', 'Notify me about')`. */
const val KEY_BROWSER_EVENTS: String = "translation_browserNotifications_events"

/** Alerts toggle — web `t('browserNotifications.alerts', 'Alerts')`. */
const val KEY_BROWSER_ALERTS: String = "translation_browserNotifications_alerts"

/** Export-completions toggle — web `t('browserNotifications.exportStatus', 'Export completions')`. */
const val KEY_BROWSER_EXPORT_STATUS: String = "translation_browserNotifications_exportStatus"

/** Events hint — web `t('browserNotifications.hint', …)`. */
const val KEY_BROWSER_HINT: String = "translation_browserNotifications_hint"

/** Tab-signals heading — web `t('settings.tab.heading', 'Browser tab signals')`. */
const val KEY_TAB_HEADING: String = "translation_settings_tab_heading"

/** Tab-badge toggle — web `t('settings.tab.badge', 'Show unread count in browser tab')`. */
const val KEY_TAB_BADGE: String = "translation_settings_tab_badge"

/** Critical-flash toggle — web `t('settings.tab.flash', 'Flash tab title on critical alerts')`. */
const val KEY_TAB_FLASH: String = "translation_settings_tab_flash"

/** Tab-signals hint — web `t('settings.tab.hint', …)`. */
const val KEY_TAB_HINT: String = "translation_settings_tab_hint"

/** Sounds title — web `t('notificationSounds.title', 'Notification sounds')`. */
const val KEY_SOUNDS_TITLE: String = "translation_notificationSounds_title"

/** Sounds subtitle — web `t('notificationSounds.subtitle', …)`. */
const val KEY_SOUNDS_SUBTITLE: String = "translation_notificationSounds_subtitle"

/** Master toggle — web `t('notificationSounds.master', 'Enable notification sounds')`. */
const val KEY_SOUNDS_MASTER: String = "translation_notificationSounds_master"

/** Autoplay hint — web `t('notificationSounds.autoplayHint', …)`. */
const val KEY_SOUNDS_AUTOPLAY_HINT: String = "translation_notificationSounds_autoplayHint"

/** Channels heading — web `t('notificationSounds.categoriesHeading', 'Channels')`. */
const val KEY_SOUNDS_CATEGORIES_HEADING: String = "translation_notificationSounds_categoriesHeading"

/** Test action — web `t('notificationSounds.test', 'Test')`. */
const val KEY_SOUNDS_TEST: String = "translation_notificationSounds_test"

/** Test action accessible name — web `t('notificationSounds.testAria', 'Test {{name}} sound')` (`%1$s`). */
const val KEY_SOUNDS_TEST_ARIA: String = "translation_notificationSounds_testAria"

/** Volume slider label — web `t('notificationSounds.volume', 'Volume')`. */
const val KEY_SOUNDS_VOLUME: String = "translation_notificationSounds_volume"

// ── Server settings-document field names (web `useSettings` / `useSaveSettings`) ──

/** Server field gating the unread-count tab badge — web `settings.tab_badge_enabled`. */
const val FIELD_TAB_BADGE_ENABLED: String = "tab_badge_enabled"

/** Server field gating the critical-alert tab flash — web `settings.critical_flash_enabled`. */
const val FIELD_CRITICAL_FLASH_ENABLED: String = "critical_flash_enabled"

// ── Notification sound categories (web NOTIFICATION_SOUND_CATEGORIES) ──

/**
 * The seven independent notification-sound channels, in the web's declaration order
 * (web/src/lib/notificationSound.ts `NOTIFICATION_SOUND_CATEGORIES`). [wire] is the stable
 * snake_case token used as the persisted map key (the web string-union value); [labelKey] is the
 * generated Android catalog name for the channel's display label (web `notificationSounds.category.<wire>`).
 */
enum class NotificationSoundCategory(
    val wire: String,
    val labelKey: String,
) {
    CriticalAlert("critical_alert", "translation_notificationSounds_category_critical_alert"),
    WarningAlert("warning_alert", "translation_notificationSounds_category_warning_alert"),
    InfoAlert("info_alert", "translation_notificationSounds_category_info_alert"),
    ChargeComplete("charge_complete", "translation_notificationSounds_category_charge_complete"),
    DriveComplete("drive_complete", "translation_notificationSounds_category_drive_complete"),
    AutomationRun("automation_run", "translation_notificationSounds_category_automation_run"),
    Achievement("achievement", "translation_notificationSounds_category_achievement"),
    ;

    companion object {
        /** Resolves a persisted [wire] token back to its category, or `null` for an unknown key. */
        fun fromWire(wire: String): NotificationSoundCategory? = entries.firstOrNull { it.wire == wire }
    }
}

/**
 * The user's per-channel notification-audio preferences — the native port of the web
 * `NotificationSoundPrefs` (web/src/lib/notificationSound.ts). [master] is the overall on/off; when it is
 * off every channel is muted. [perCategory] is the per-channel gate; [volume] is the output level in
 * `[0, 1]`. A missing channel reads through to [DEFAULT] so a partial persisted blob still resolves
 * (the web `normalizePerCategory` behaviour).
 */
data class NotificationSoundPrefs(
    val master: Boolean,
    val perCategory: Map<NotificationSoundCategory, Boolean>,
    val volume: Float,
) {
    /** Whether [category] is enabled, defaulting to its [DEFAULT] gate when absent (web read-through). */
    fun isCategoryEnabled(category: NotificationSoundCategory): Boolean = perCategory[category] ?: DEFAULT.perCategory.getValue(category)

    /** The volume as a whole-number percent in `0..100` — the web `Math.round(volume * 100)`. */
    val volumePercent: Int get() = (clampVolume(volume) * PERCENT).roundToInt()

    companion object {
        /** Web `DEFAULT_NOTIFICATION_SOUND_PREFS` — master off, the seeded per-channel gates, 60% volume. */
        val DEFAULT: NotificationSoundPrefs =
            NotificationSoundPrefs(
                master = false,
                perCategory =
                    mapOf(
                        NotificationSoundCategory.CriticalAlert to true,
                        NotificationSoundCategory.WarningAlert to true,
                        NotificationSoundCategory.InfoAlert to false,
                        NotificationSoundCategory.ChargeComplete to true,
                        NotificationSoundCategory.DriveComplete to false,
                        NotificationSoundCategory.AutomationRun to false,
                        NotificationSoundCategory.Achievement to false,
                    ),
                volume = DEFAULT_VOLUME,
            )

        /**
         * Canonicalises an arbitrary prefs candidate into a fully-populated [NotificationSoundPrefs] — the
         * native port of the web `normalizePrefs`: every channel is present (missing ones fall back to
         * [DEFAULT]) and [volume] is clamped into `[0, 1]`.
         */
        fun normalize(
            master: Boolean,
            perCategory: Map<NotificationSoundCategory, Boolean>,
            volume: Float,
        ): NotificationSoundPrefs =
            NotificationSoundPrefs(
                master = master,
                perCategory = NotificationSoundCategory.entries.associateWith { perCategory[it] ?: DEFAULT.perCategory.getValue(it) },
                volume = clampVolume(volume),
            )
    }
}

/**
 * A partial update to [NotificationSoundPrefs] — the native port of the web `NotificationSoundPrefsPatch`
 * passed to `setNotificationSoundPrefs`. Unset fields retain their current value; [perCategory] merges
 * shallowly over the existing channel gates.
 */
data class NotificationSoundPrefsPatch(
    val master: Boolean? = null,
    val volume: Float? = null,
    val perCategory: Map<NotificationSoundCategory, Boolean> = emptyMap(),
)

/**
 * Applies [patch] to these prefs — the native port of the web `setNotificationSoundPrefs` reducer: an
 * unset field keeps its current value, [NotificationSoundPrefsPatch.perCategory] merges shallowly, and a
 * supplied volume is clamped into `[0, 1]`.
 */
fun NotificationSoundPrefs.applyPatch(patch: NotificationSoundPrefsPatch): NotificationSoundPrefs =
    copy(
        master = patch.master ?: master,
        perCategory = if (patch.perCategory.isEmpty()) perCategory else perCategory + patch.perCategory,
        volume = patch.volume?.let { clampVolume(it) } ?: volume,
    )

/**
 * The Test-button "force play" override — the native port of the web `handleTestSound`: a test always
 * attempts to play even when the master switch is off, so it forces [NotificationSoundPrefs.master] and
 * the tested channel on and lifts a zero volume to 50% (the web `volume <= 0 ? 0.5 : volume`). It is the
 * primary way a user authorises audio playback, so it must never be gated by the saved prefs.
 */
fun NotificationSoundPrefs.testOverrideFor(category: NotificationSoundCategory): NotificationSoundPrefs =
    copy(
        master = true,
        perCategory = perCategory + (category to true),
        volume = if (volume <= 0f) TEST_FALLBACK_VOLUME else volume,
    )

/**
 * The outcome of the saved-prefs play gate — the native port of the web `playNotificationSound` reasons.
 * [Play] means the cue should sound; the others are the silent no-op reasons. Audio-context / play
 * failures are a render-boundary concern (the [NotificationSoundPlayer] seam reports them), so they are
 * intentionally outside this pure decision.
 */
enum class SoundPlayDecision { Play, MasterOff, CategoryOff, VolumeZero }

/**
 * Decides whether the cue for [category] should play under [prefs] — the pure prefix of the web
 * `playNotificationSound`: master off → [SoundPlayDecision.MasterOff]; channel off →
 * [SoundPlayDecision.CategoryOff]; non-positive (clamped) volume → [SoundPlayDecision.VolumeZero]; else
 * [SoundPlayDecision.Play].
 */
fun decideSoundPlay(
    prefs: NotificationSoundPrefs,
    category: NotificationSoundCategory,
): SoundPlayDecision =
    when {
        !prefs.master -> SoundPlayDecision.MasterOff
        !prefs.isCategoryEnabled(category) -> SoundPlayDecision.CategoryOff
        clampVolume(prefs.volume) <= 0f -> SoundPlayDecision.VolumeZero
        else -> SoundPlayDecision.Play
    }

/**
 * Clamps [value] into `[0, 1]` — the native port of the web `clamp(n, 0, 1)`, including its
 * NaN-to-floor behaviour (`Number.isNaN(n) → min`).
 */
fun clampVolume(value: Float): Float =
    when {
        value.isNaN() -> 0f
        value < 0f -> 0f
        value > 1f -> 1f
        else -> value
    }

// ── Web-push event preferences (web useNotificationListener `WebPushPreferences`) ──

/**
 * The out-of-app push event gates — the native port of the web `WebPushPreferences`
 * (web/src/hooks/useNotificationListener.ts). [alerts] gates alert notifications, [exportStatus] gates
 * export-completion notifications. Both default on, matching the web `DEFAULT_PREFS`.
 */
data class WebPushPrefs(
    val alerts: Boolean,
    val exportStatus: Boolean,
) {
    companion object {
        /** Web `DEFAULT_PREFS` — both event families on. */
        val DEFAULT: WebPushPrefs = WebPushPrefs(alerts = true, exportStatus = true)
    }
}

// ── Browser-notification permission (web useWebPush `permission`) ──

/**
 * The runtime notification permission — the native analogue of the web `NotificationPermission`
 * (`'default' | 'granted' | 'denied'`). On Android the host derives it from the OS notifications-enabled
 * flag and `POST_NOTIFICATIONS` (granted at install below API 33).
 */
enum class BrowserNotifPermission { Default, Granted, Denied }

/**
 * The single control the supported browser-notifications block shows for the current permission — the web
 * `permission === 'default' | 'granted' | 'denied'` branch: [RequestPermission] (the Enable button),
 * [ShowEnabledBadge] (the success chip), or [ShowBlockedMessage] (the muted "blocked" note).
 */
enum class BrowserNotifControl { RequestPermission, ShowEnabledBadge, ShowBlockedMessage }

/** The control the supported block shows for [permission] (web permission branch). */
fun browserNotifControl(permission: BrowserNotifPermission): BrowserNotifControl =
    when (permission) {
        BrowserNotifPermission.Default -> BrowserNotifControl.RequestPermission
        BrowserNotifPermission.Granted -> BrowserNotifControl.ShowEnabledBadge
        BrowserNotifPermission.Denied -> BrowserNotifControl.ShowBlockedMessage
    }

/** Whether the per-event push toggles render — web `permission === 'granted'`. */
fun showsEventPreferences(permission: BrowserNotifPermission): Boolean = permission == BrowserNotifPermission.Granted

// ── Server "browser tab signals" (web useSettings `tab_badge_enabled` / `critical_flash_enabled`) ──

/**
 * The two server-persisted tab-signal flags the panel renders — the native projection of the web
 * `useSettings` document. Each defaults ON when the field is missing from the response, matching the web
 * `settings?.tab_badge_enabled !== false` read and the backend `settingsDefaults()`.
 *
 * @property badgeEnabled whether the unread-count badge is shown (web `tab_badge_enabled`).
 * @property criticalFlashEnabled whether the title flashes on critical alerts (web `critical_flash_enabled`).
 */
data class TabSignals(
    val badgeEnabled: Boolean,
    val criticalFlashEnabled: Boolean,
) {
    companion object {
        /** The default (both on) — the surface never blanks; missing fields read as on (web default). */
        val DEFAULT: TabSignals = TabSignals(badgeEnabled = true, criticalFlashEnabled = true)

        /**
         * Reads the two flags out of the raw `/settings` [document] — the native port of the web
         * default-ON reads. A non-object document (or a missing / non-boolean field) reads as on; only an
         * explicit `false` turns a flag off (web `!== false`).
         */
        fun read(document: JsonElement?): TabSignals =
            TabSignals(
                badgeEnabled = fieldNotFalse(document, FIELD_TAB_BADGE_ENABLED),
                criticalFlashEnabled = fieldNotFalse(document, FIELD_CRITICAL_FLASH_ENABLED),
            )
    }
}

/**
 * Sets a single tab-signal [key] to [value] inside the full `/settings` [current] document — the native
 * port of the web `saveSettings.mutate({ ...settings, [key]: value })`: every other field is preserved
 * verbatim (a full-replace upsert that zero-values nothing) and only the one flag changes. A `null`
 * current document (nothing loaded yet) yields a single-field object.
 */
fun mergeTabSignal(
    current: JsonElement?,
    key: String,
    value: Boolean,
): JsonObject {
    val base = (current as? JsonObject)?.toMutableMap() ?: mutableMapOf()
    base[key] = JsonPrimitive(value)
    return JsonObject(base)
}

/**
 * Returns `true` unless [key] is present in [document] as an explicit boolean `false` — the web
 * `value !== false` default-ON rule. A missing field, a non-object document, or a non-boolean value all
 * read as `true`.
 */
private fun fieldNotFalse(
    document: JsonElement?,
    key: String,
): Boolean {
    val primitive = (document as? JsonObject)?.get(key) as? JsonPrimitive
    return primitive?.booleanOrNull != false
}

// ── Lifecycle classifier for the network-backed tab-signals feed (per-state coverage) ──

/**
 * The mutually-exclusive surface the tab-signals section switches on — the lifecycle chrome the
 * cache-then-network `/settings` feed implies. [Ready] renders the two toggles (content, or stale/offline
 * "last known"); [Loading]/[Error] render the first-load skeleton and the retry surface. Loading takes
 * precedence over error so a refresh-with-skeleton never flashes the error surface.
 */
enum class TabSignalsSurface { Loading, Error, Ready }

/** Classifies the tab-signals feed's lifecycle flags into the surface to render. */
fun tabSignalsSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): TabSignalsSurface =
    when {
        isLoading -> TabSignalsSurface.Loading
        isError -> TabSignalsSurface.Error
        else -> TabSignalsSurface.Ready
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [NotificationSettingsRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it
 * from its first [onAppear]. Carries no preference values — only the static surface slug.
 */
fun recordNotificationSettingsOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to NotificationSettingsRegistration.SLUG))
}

internal const val EVENT_VIEW_OPENED: String = "view.opened"
internal const val FIELD_SURFACE: String = "surface"
private const val DEFAULT_VOLUME: Float = 0.6f
private const val TEST_FALLBACK_VOLUME: Float = 0.5f
private const val PERCENT: Float = 100f
