// Pure, framework-free model + projection for the SecurityPanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/telemetry-panels/SecurityPanel.tsx). No Compose, no Android
// framework, no HTTP: every declaration here is unit-tested off device in the :android:testReleaseUnitTest
// gate, so the composable stays a thin render layer. The web component receives a `SecurityEvent` prop plus
// an optional `remoteStartEnabled` flag and renders, when either is present, a Lock-status box
// (Lock/Unlock, green/amber), a Sentry-mode chip (Active/Inactive), Doors + Windows values, a User-present
// row (Yes/No), an optional italic `detail` line, and a Remote-Start row (Enabled/Disabled/—); when neither
// is present it renders a friendly "No security data available" empty state. The readers below pull the
// typed `SecurityEvent` fields (`locked`, `sentry_mode`, `doors_open`, `windows_open`, `user_present`,
// `detail`) and the vehicle-config `remote_start_enabled`, narrowing each exactly as the web's typed
// contract does (a field that is absent or of the wrong JSON kind reads as missing). No unit conversion is
// involved (every field is a boolean/string), so this surface needs no UnitFormatter.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SecurityPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ClimatePanel / SecurityStatusWidget
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitypanel

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, location, or any
 * security payload, so a diagnostics line can never leak the vehicle's identity or access state.
 */
const val SECURITY_PANEL_SLUG: String = "SecurityPanel"

/** Em dash shown for a missing reading — the web `remoteStartEnabled == null ? '—'` fallback. */
internal const val EM_DASH: String = "\u2014"

// The typed `SecurityEvent` fields the web reads off the `securityData` prop. `locked` / `sentry_mode` /
// `user_present` are typed `boolean | null`; `doors_open` / `windows_open` / `detail` are typed
// `string | null`. The readers narrow each with the web's typed contract.
private const val FIELD_LOCKED = "locked"
private const val FIELD_SENTRY_MODE = "sentry_mode"
private const val FIELD_DOORS_OPEN = "doors_open"
private const val FIELD_WINDOWS_OPEN = "windows_open"
private const val FIELD_USER_PRESENT = "user_present"
private const val FIELD_DETAIL = "detail"

/** The vehicle-config field backing the web `remoteStartEnabled` prop (web `VehicleConfig.remote_start_enabled`). */
private const val FIELD_REMOTE_START_ENABLED = "remote_start_enabled"

/**
 * The semantic tone a colored value carries — the native analogue of the web's `text-green-400` /
 * `text-amber-400` / `text-red-400` / muted value styling. The render layer maps each onto a theme color.
 */
enum class ValueTone {
    /** Engaged / good (web green) — the locked, sentry-active-text, user-present, remote-start-enabled values. */
    Success,

    /** Attention (web amber) — the unlocked lock-status value. */
    Warning,

    /** Problem / armed (web red) — the active Sentry-mode chip. */
    Danger,

    /** Off / not-engaged (web muted) — every inactive/absent value. */
    Neutral,
}

/**
 * The combined raw snapshot this surface consumes — the native mirror of the web's two inputs: the
 * `securityData` prop ([security], a `SecurityEvent` JSON object) and the `remoteStartEnabled` prop
 * (sourced from [config], the latest vehicle-config snapshot's `remote_start_enabled`). Pure data so the
 * merge + projection stay unit-testable off device; either element may be `null`/`JsonNull`/non-object
 * when its feed has not resolved (or carries no value).
 */
data class SecuritySnapshot(
    val security: JsonElement?,
    val config: JsonElement?,
) {
    companion object {
        /** The all-absent snapshot used for a no-vehicle / first-load fold (the web both-props-null branch). */
        val EMPTY: SecuritySnapshot = SecuritySnapshot(security = null, config = null)

        /** Wraps the security + config cached values into a snapshot — the merge's `from(cached, cached)` step. */
        fun from(
            security: JsonElement?,
            config: JsonElement?,
        ): SecuritySnapshot = SecuritySnapshot(security = security, config = config)
    }
}

/**
 * The pure decoded security state — the "data adapter" output the web component reads before it renders.
 * No strings, no Compose: just the booleans/strings the rows are computed from, so the parsing rules
 * (typed-field reads + the `?? 'Closed'` / truthy-`detail` guards reproduced from the web source) are
 * unit-tested in isolation.
 *
 * @property hasSecurity whether a `SecurityEvent` object was decoded (web `securityData` truthy).
 * @property locked web `securityData.locked` (a missing / non-boolean value reads as unlocked).
 * @property sentryMode web `securityData.sentry_mode` (likewise reads as off when absent).
 * @property doorsOpen web `securityData.doors_open` raw string, or `null` when absent / not a string.
 * @property windowsOpen web `securityData.windows_open` raw string, or `null` when absent / not a string.
 * @property userPresent web `securityData.user_present` (reads as absent/false when missing).
 * @property detail web `securityData.detail` when truthy (non-empty), else `null` (the `detail && …` guard).
 * @property remoteStartEnabled web `remoteStartEnabled` from config (`true`/`false`/`null` when unknown).
 */
data class SecurityReading(
    val hasSecurity: Boolean,
    val locked: Boolean,
    val sentryMode: Boolean,
    val doorsOpen: String?,
    val windowsOpen: String?,
    val userPresent: Boolean,
    val detail: String?,
    val remoteStartEnabled: Boolean?,
) {
    /** True when the surface has anything to render (web `securityData != null || remoteStartEnabled != null`). */
    val hasData: Boolean get() = hasSecurity || remoteStartEnabled != null

    companion object {
        /** The no-security readout carrying only the (possibly-null) remote-start flag from config. */
        fun noSecurity(remoteStartEnabled: Boolean?): SecurityReading =
            SecurityReading(
                hasSecurity = false,
                locked = false,
                sentryMode = false,
                doorsOpen = null,
                windowsOpen = null,
                userPresent = false,
                detail = null,
                remoteStartEnabled = remoteStartEnabled,
            )
    }
}

/**
 * The localized strings the panel renders — the native mirror of every `t('…')` call the web component
 * makes, resolved once at the Compose boundary (P1/S10) and passed in so the projection stays
 * framework-free yet fully localized. [snapshotLabel] personalizes the error surface's retry copy.
 */
data class SecurityPanelStrings(
    val title: String,
    val locked: String,
    val unlocked: String,
    val lockStatus: String,
    val sentryMode: String,
    val active: String,
    val inactive: String,
    val doors: String,
    val windows: String,
    val closed: String,
    val userPresent: String,
    val yes: String,
    val no: String,
    val remoteStart: String,
    val enabled: String,
    val disabled: String,
    val noData: String,
    val snapshotLabel: String = title,
)

/**
 * The fully projected, render-ready view of the security snapshot — the native analogue of everything the
 * web component computes before returning JSX. Pure data (no Compose types) so every branch is unit-tested
 * directly. When [hasData] is false the surface renders its empty state (web both-props-null); otherwise it
 * renders the lock box, sentry chip, door/window/user rows (only when [hasSecurity]), the optional detail
 * line, and the always-present remote-start row.
 *
 * @property hasData whether anything is renderable (web `hasData`); false → the empty state.
 * @property hasSecurity whether the `SecurityEvent` rows render (web `securityData && …`).
 * @property locked drives the Lock vs Unlock glyph (web `securityData.locked ? <Lock/> : <Unlock/>`).
 * @property lockText the localized lock status (web `Locked`/`Unlocked`).
 * @property lockTone the lock status tone (web green when locked, amber when unlocked).
 * @property lockStatusLabel the muted sub-label (web `Vehicle lock status`).
 * @property sentryActive whether Sentry mode is engaged (web `securityData.sentry_mode`).
 * @property sentryText the localized Sentry value (web `Active`/`Inactive`).
 * @property sentryTone the Sentry chip tone (web red when active, muted otherwise).
 * @property doorsValue the doors value (web `doors_open ?? 'Closed'`).
 * @property windowsValue the windows value (web `windows_open ?? 'Closed'`).
 * @property userPresentText the localized user-present value (web `Yes`/`No`).
 * @property userPresentTone the user-present tone (web green when present, muted otherwise).
 * @property detail the optional italic detail line, or `null` (web `securityData.detail && …`).
 * @property remoteStartText the localized remote-start value (web `—`/`Enabled`/`Disabled`).
 * @property remoteStartTone the remote-start tone (web green only when enabled, muted otherwise).
 */
data class SecurityPanelDisplay(
    val hasData: Boolean,
    val hasSecurity: Boolean,
    val locked: Boolean,
    val lockText: String,
    val lockTone: ValueTone,
    val lockStatusLabel: String,
    val sentryActive: Boolean,
    val sentryText: String,
    val sentryTone: ValueTone,
    val doorsValue: String,
    val windowsValue: String,
    val userPresentText: String,
    val userPresentTone: ValueTone,
    val detail: String?,
    val remoteStartText: String,
    val remoteStartTone: ValueTone,
) {
    companion object {
        /** The no-data projection (web `hasData` false): the surface shows its empty state. */
        fun empty(): SecurityPanelDisplay =
            SecurityPanelDisplay(
                hasData = false,
                hasSecurity = false,
                locked = false,
                lockText = EM_DASH,
                lockTone = ValueTone.Neutral,
                lockStatusLabel = EM_DASH,
                sentryActive = false,
                sentryText = EM_DASH,
                sentryTone = ValueTone.Neutral,
                doorsValue = EM_DASH,
                windowsValue = EM_DASH,
                userPresentText = EM_DASH,
                userPresentTone = ValueTone.Neutral,
                detail = null,
                remoteStartText = EM_DASH,
                remoteStartTone = ValueTone.Neutral,
            )
    }
}

/**
 * Pure projection from the combined snapshot to the panel's render state — a 1:1 port of the web
 * component's field reads, null guards, and per-row tone logic. Stateless and side-effect-free so it is
 * fully covered by the off-device unit gate; the composable only resolves localized strings and draws what
 * these return.
 */
object SecurityPanelProjection {
    /**
     * The readings the web derives from the snapshot. The `locked` / `sentry_mode` / `user_present` flags use
     * the boolean guard (absent/non-boolean → false); `doors_open` / `windows_open` use the string guard
     * (absent/non-string → `null`, surfacing the `?? 'Closed'` fallback at projection time); `detail` is the
     * truthy-string guard (web `detail && …`); `remote_start_enabled` is read from the config object as a
     * tri-state boolean (web `remoteStartEnabled: boolean | null`).
     */
    fun parse(snapshot: SecuritySnapshot?): SecurityReading {
        val config = snapshot?.config as? JsonObject
        val remoteStart = config?.boolOrNull(FIELD_REMOTE_START_ENABLED)
        val security = snapshot?.security as? JsonObject ?: return SecurityReading.noSecurity(remoteStart)
        return SecurityReading(
            hasSecurity = true,
            locked = security.boolOrFalse(FIELD_LOCKED),
            sentryMode = security.boolOrFalse(FIELD_SENTRY_MODE),
            doorsOpen = security.stringOrNull(FIELD_DOORS_OPEN),
            windowsOpen = security.stringOrNull(FIELD_WINDOWS_OPEN),
            userPresent = security.boolOrFalse(FIELD_USER_PRESENT),
            detail = security.stringOrNull(FIELD_DETAIL)?.takeIf { it.isNotEmpty() },
            remoteStartEnabled = remoteStart,
        )
    }

    /**
     * True when [snapshot] carries no security object AND no remote-start flag (web `!hasData`) → render the
     * empty state. Used by the view-model to classify the cache-then-network feed onto
     * [io.teslasync.android.data.UiPhase.Empty].
     */
    fun isEmptySnapshot(snapshot: SecuritySnapshot?): Boolean = !parse(snapshot).hasData

    /**
     * Projects [snapshot] onto the render-ready [SecurityPanelDisplay] using [strings] for every label/value.
     * A no-data snapshot yields [SecurityPanelDisplay.empty] (the web empty branch); otherwise every field is
     * read + localized exactly as the web component does, including the `doors_open ?? 'Closed'` fallback and
     * the tri-state remote-start value.
     */
    fun project(
        snapshot: SecuritySnapshot?,
        strings: SecurityPanelStrings,
    ): SecurityPanelDisplay {
        val reading = parse(snapshot)
        if (!reading.hasData) return SecurityPanelDisplay.empty()
        return SecurityPanelDisplay(
            hasData = true,
            hasSecurity = reading.hasSecurity,
            locked = reading.locked,
            lockText = if (reading.locked) strings.locked else strings.unlocked,
            lockTone = if (reading.locked) ValueTone.Success else ValueTone.Warning,
            lockStatusLabel = strings.lockStatus,
            sentryActive = reading.sentryMode,
            sentryText = if (reading.sentryMode) strings.active else strings.inactive,
            sentryTone = if (reading.sentryMode) ValueTone.Danger else ValueTone.Neutral,
            doorsValue = reading.doorsOpen ?: strings.closed,
            windowsValue = reading.windowsOpen ?: strings.closed,
            userPresentText = if (reading.userPresent) strings.yes else strings.no,
            userPresentTone = if (reading.userPresent) ValueTone.Success else ValueTone.Neutral,
            detail = reading.detail,
            remoteStartText = remoteStartText(reading.remoteStartEnabled, strings),
            remoteStartTone = if (reading.remoteStartEnabled == true) ValueTone.Success else ValueTone.Neutral,
        )
    }

    /** The localized remote-start value — web `remoteStartEnabled == null ? '—' : enabled ? 'Enabled' : 'Disabled'`. */
    fun remoteStartText(
        remoteStartEnabled: Boolean?,
        strings: SecurityPanelStrings,
    ): String =
        when (remoteStartEnabled) {
            null -> EM_DASH
            true -> strings.enabled
            false -> strings.disabled
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SECURITY_PANEL_SLUG] (P1/S11). Carries
 * no lock/sentry/door payload or vehicle id, so a diagnostics line can never leak access state. Kept free of
 * Compose so it is unit-tested with a recording [Logger]; the view-model calls it from the composable's
 * first-composition effect.
 */
fun recordSecurityPanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SECURITY_PANEL_SLUG))
}

/** A JSON boolean field, or `null` when absent / `JsonNull` / not a JSON boolean (web typed `boolean | null`). */
private fun JsonObject.boolOrNull(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

/** A JSON boolean field, defaulting to `false` when absent / not a JSON boolean (web `value ? … : …`). */
private fun JsonObject.boolOrFalse(key: String): Boolean = boolOrNull(key) ?: false

/** A JSON string field, or `null` when absent / not a quoted string (web typed `string | null`). */
private fun JsonObject.stringOrNull(key: String): String? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return if (primitive.isString) primitive.content else null
}
