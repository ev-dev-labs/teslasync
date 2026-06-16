// Pure, framework-free model + projections for the SafetyPage settings surface — the native analogue of everything the
// web page derives before composing its panels (web/src/features/settings/pages/SafetyPage.tsx, the AI-OFF-safe
// explainer host that lists every safety-related TeslaSync setting with its current value + a plain-English summary).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin, so the composable stays a thin render
// layer and all of this is exercised off-device by the :app:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the deterministic, module-scope listing of the seven
// safety-related settings (web `SAFETY_ROWS`), kept in the same order so the off-mode static-help surface lists
// everything Helix would explain on-mode; (2) the decode of the raw `/settings` document into the seven typed,
// null-safe values the badges show, with the SAME defaults the web `useSettings` hook applies so the page always
// renders a success surface even before/without a fetch (web `const raw = settings ?? defaults`); and (3) the inline
// value tokens the web hardcodes per row (`On`/`Off`, the time/digest string, `Suspended`/`Active`), modelled as a
// sealed [SafetyRowValue] the render layer resolves from the localized catalog so no English literal is hardcoded.
//
// Not unit-bearing: every value here is a user-entered preference (booleans, HH:MM strings, an enum string), never SI
// telemetry, so there is no unit conversion at this layer (Phase-48 / unit-conversion.instructions) — display
// formatting is the render boundary's job.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling admin/battery surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located registration object + recorder.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.settings.safety

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * Canonical metadata for this surface. The web page is a top-level settings route, so this object carries the
 * cross-cutting concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the diagnostics
 * [SLUG] emitted with the one-shot `view.opened` event (P1/S11).
 */
object SafetyPageRegistration {
    /** The navigation destination id (Destinations.kt `page("settingsSafety", "/settings/safety", …)`). */
    const val ROUTE_ID: String = "settingsSafety"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/settings/safety"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SafetyPage"
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no setting values. */
internal fun recordSafetyPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SafetyPageRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/**
 * The seven safety-related setting values read from the `/settings` document, decoded with the SAME defaults the web
 * `useSettings` hook applies (web/src/hooks/useSettings.ts `defaults`). Because every field defaults, the listing
 * always has a value to show — the page never renders loading/empty/error, only its success surface (web
 * `settings ?? defaults`).
 */
data class SafetySettings(
    val quietHoursEnabled: Boolean,
    val quietHoursStart: String,
    val quietHoursEnd: String,
    val alertDigestMode: String,
    val criticalFlashEnabled: Boolean,
    val tabBadgeEnabled: Boolean,
    val apiSuspended: Boolean,
) {
    companion object {
        /** Verbatim port of the web `useSettings` `defaults` for the safety-related fields. */
        val DEFAULT: SafetySettings =
            SafetySettings(
                quietHoursEnabled = false,
                quietHoursStart = "22:00",
                quietHoursEnd = "07:00",
                alertDigestMode = "instant",
                criticalFlashEnabled = true,
                tabBadgeEnabled = true,
                apiSuspended = false,
            )

        /**
         * Decodes the raw `/settings` JSON document into the typed safety values, defaulting any missing/JSON-null
         * field to its web default (web `raw[key] ?? defaults[key]`). A non-object document yields [DEFAULT].
         */
        fun fromDocument(document: JsonElement?): SafetySettings {
            val obj = document as? JsonObject ?: return DEFAULT
            return SafetySettings(
                quietHoursEnabled = obj.bool(KEY_QUIET_HOURS_ENABLED, DEFAULT.quietHoursEnabled),
                quietHoursStart = obj.str(KEY_QUIET_HOURS_START, DEFAULT.quietHoursStart),
                quietHoursEnd = obj.str(KEY_QUIET_HOURS_END, DEFAULT.quietHoursEnd),
                alertDigestMode = obj.str(KEY_ALERT_DIGEST_MODE, DEFAULT.alertDigestMode),
                criticalFlashEnabled = obj.bool(KEY_CRITICAL_FLASH_ENABLED, DEFAULT.criticalFlashEnabled),
                tabBadgeEnabled = obj.bool(KEY_TAB_BADGE_ENABLED, DEFAULT.tabBadgeEnabled),
                apiSuspended = obj.bool(KEY_API_SUSPENDED, DEFAULT.apiSuspended),
            )
        }

        private fun JsonObject.bool(
            key: String,
            default: Boolean,
        ): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: default

        private fun JsonObject.str(
            key: String,
            default: String,
        ): String = (this[key] as? JsonPrimitive)?.contentOrNull ?: default
    }
}

private const val KEY_QUIET_HOURS_ENABLED = "quiet_hours_enabled"
private const val KEY_QUIET_HOURS_START = "quiet_hours_start"
private const val KEY_QUIET_HOURS_END = "quiet_hours_end"
private const val KEY_ALERT_DIGEST_MODE = "alert_digest_mode"
private const val KEY_CRITICAL_FLASH_ENABLED = "critical_flash_enabled"
private const val KEY_TAB_BADGE_ENABLED = "tab_badge_enabled"
private const val KEY_API_SUSPENDED = "api_suspended"

/**
 * The display token for one listing row's current value — the typed analogue of the web `renderValue` results. The
 * render layer resolves each case to a localized string (web hardcodes the English literals inline), so no value text
 * is hardcoded in the UI.
 */
sealed interface SafetyRowValue {
    /** A boolean toggle rendered as the common `On` / `Off` labels (web `x ? 'On' : 'Off'`). */
    data class OnOff(val on: Boolean) : SafetyRowValue

    /** The Fleet-API kill-switch rendered as `Suspended` / `Active` (web `x ? 'Suspended' : 'Active'`). */
    data class ApiState(val suspended: Boolean) : SafetyRowValue

    /** A verbatim string value (an HH:MM window bound or the digest-mode enum); blank shows the em dash. */
    data class Plain(val text: String) : SafetyRowValue
}

/**
 * The deterministic listing of safety-related settings, in the web `SAFETY_ROWS` order. Each entry carries only the
 * framework-free identity (the [docsAnchor] the row links to and the [value] projection); the localized title +
 * description strings are bound at the render boundary from the catalog (R.string), keeping this model Android-free.
 */
enum class SafetySetting(
    val docsAnchor: String,
) {
    QuietHoursEnabled(DOCS_QUIET_HOURS),
    QuietHoursStart(DOCS_QUIET_HOURS),
    QuietHoursEnd(DOCS_QUIET_HOURS),
    AlertDigestMode(DOCS_DIGEST),
    CriticalFlashEnabled(DOCS_TAB_SIGNALLING),
    TabBadgeEnabled(DOCS_TAB_SIGNALLING),
    ApiSuspended(DOCS_API_SUSPENDED),
    ;

    /** Resolves this row's current display token from the decoded [settings] (web per-row `renderValue`). */
    fun value(settings: SafetySettings): SafetyRowValue =
        when (this) {
            QuietHoursEnabled -> SafetyRowValue.OnOff(settings.quietHoursEnabled)
            QuietHoursStart -> SafetyRowValue.Plain(settings.quietHoursStart)
            QuietHoursEnd -> SafetyRowValue.Plain(settings.quietHoursEnd)
            AlertDigestMode -> SafetyRowValue.Plain(settings.alertDigestMode)
            CriticalFlashEnabled -> SafetyRowValue.OnOff(settings.criticalFlashEnabled)
            TabBadgeEnabled -> SafetyRowValue.OnOff(settings.tabBadgeEnabled)
            ApiSuspended -> SafetyRowValue.ApiState(settings.apiSuspended)
        }
}

private const val DOCS_QUIET_HOURS = "/docs/notifications/quiet-hours.md"
private const val DOCS_DIGEST = "/docs/notifications/digest.md"
private const val DOCS_TAB_SIGNALLING = "/docs/notifications/tab-signalling.md"
private const val DOCS_API_SUSPENDED = "/docs/operations/api-suspended.md"
