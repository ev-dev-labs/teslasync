// Pure, framework-free model + projection for the SecuritySection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/vehicle-detail/SecuritySection.tsx). No Compose, no Android
// framework, no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// The web component receives a `securityData: SecurityEvent | null` prop plus a `state: VehicleState` prop and
// renders, when `securityData` is present, a four-tile grid (Locked, Sentry, Doors, Windows); otherwise a
// friendly "No security data available" empty state. Two of the tiles read the live `VehicleState`
// (`is_locked` / `sentry_mode`); the other two read the `SecurityEvent` (`door_state` and the four window
// corners, summarised by `windowOpenCount`). The readers below narrow each field exactly as the web typed
// contract + `windowOpenCount` does — a value that is absent or of the wrong JSON kind reads as missing, and
// every window corner is coerced with the web's `Number(v) > 0` rule. No unit conversion is involved (every
// field is a boolean / string / count), so this surface needs no UnitFormatter.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SecuritySection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling SecurityPanel / SecurityStatusCards surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitysection

import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SecuritySectionRegistration {
    /** Stable surface id. */
    const val ID: String = "security-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / vehicle data. */
    const val SLUG: String = "SecuritySection"
}

/** The em dash the surface renders for any absent value (the web `'—'`). */
internal const val EM_DASH: String = "\u2014"

/** The `SecurityEvent.door_state` field the web reads off the `securityData` prop (`string | boolean | null`). */
private const val FIELD_DOOR_STATE: String = "door_state"

/** The four window corners the web sums in `windowOpenCount` (each `string | boolean | null`). */
private val WINDOW_FIELDS: List<String> = listOf("fd_window", "fp_window", "rd_window", "rp_window")

/**
 * The lock state assumed when the live [VehicleState] has not resolved — the shared
 * `normalizeVehicleStateResponse` default (`is_locked ?? true`), so a surface that renders before the state
 * feed terminally resolves stays consistent with the rest of the app rather than inventing a third value.
 */
private const val DEFAULT_LOCKED: Boolean = true

/**
 * The semantic accent a tile carries — the native analogue of the web `MetricCard` `color` prop, which this
 * surface only ever sets to `'green'` or `'cyan'`. The render layer maps each onto a theme color so
 * light / dark / high-contrast all keep working.
 */
enum class CardAccent {
    /** Web `'green'` — the engaged / good reading (locked, sentry active, doors closed, windows closed). */
    Engaged,

    /** Web `'cyan'` — the neutral brand-accent reading (unlocked, sentry off, a door / window open). */
    Neutral,
}

/**
 * The combined raw snapshot this surface consumes — the native mirror of the web's two inputs: the
 * `securityData` prop ([security], a `SecurityEvent` JSON object) and the `state` prop ([state], the live
 * [VehicleState] carrying `is_locked` / `sentry_mode`). Pure data so the projection stays unit-testable off
 * device; [security] may be `null` / `JsonNull` / a non-object when the feed has not resolved (or carries no
 * event), and [state] may be `null` when the live-state feed has no decodable state.
 */
data class SecuritySnapshot(
    val security: JsonElement?,
    val state: VehicleState?,
) {
    /** Whether a `SecurityEvent` object was decoded — the web `securityData ? grid : <EmptyState/>` boundary. */
    val hasEvent: Boolean get() = security is JsonObject

    companion object {
        /** The all-absent snapshot used for a no-vehicle / first-load fold (the web `securityData == null` branch). */
        val EMPTY: SecuritySnapshot = SecuritySnapshot(security = null, state = null)

        /** Wraps the cached security + live-state values into a snapshot — the merge's `from(cached, cached)` step. */
        fun from(
            security: JsonElement?,
            state: VehicleState?,
        ): SecuritySnapshot = SecuritySnapshot(security = security, state = state)
    }
}

/**
 * The pure decoded security state — the "data adapter" output the web component reads before it renders. No
 * strings, no Compose: just the booleans / string / count the tiles are computed from, so the parsing rules
 * (typed reads + `windowOpenCount` + the non-empty `door_state` guard) are unit-tested in isolation.
 *
 * @property hasSecurity whether a `SecurityEvent` object was decoded (web `securityData` truthy).
 * @property locked web `state.is_locked` (the shared normalize default `true` when no state resolved).
 * @property sentryMode web `state.sentry_mode` (reads as off when no state resolved).
 * @property doorState web `securityData.door_state` when present and non-empty, else `null`.
 * @property windowsOpen web `windowOpenCount(securityData)` — the count of corners reading `Number(v) > 0`.
 */
data class SecurityReading(
    val hasSecurity: Boolean,
    val locked: Boolean,
    val sentryMode: Boolean,
    val doorState: String?,
    val windowsOpen: Int,
)

/**
 * The localized strings the surface renders — the native mirror of every `t('…')` call the web component
 * makes, resolved once at the Compose boundary (P1/S10) and passed in so the projection stays framework-free
 * yet fully localized. [windowsOpenTemplate] is the catalog `'{{count}} open'` pattern (Android `'%1$s open'`)
 * the projection interpolates the open-window count into.
 */
data class SecuritySectionStrings(
    val title: String,
    val locked: String,
    val yes: String,
    val no: String,
    val sentry: String,
    val active: String,
    val off: String,
    val doors: String,
    val closed: String,
    val windows: String,
    val windowsOpenTemplate: String,
    val noData: String,
)

/**
 * The fully projected, render-ready view of the snapshot — the native analogue of everything the web component
 * computes before handing the four `<MetricCard>`s their props. Pure strings (no Compose types) so every
 * branch is unit-tested directly. When [hasEvent] is false the surface renders its empty state (web
 * `securityData == null`); otherwise it renders the four tiles.
 *
 * @property hasEvent whether the four-tile grid renders (web `securityData` truthy); false → the empty state.
 * @property locked drives the Lock vs Unlock glyph (web `state.is_locked ? <Lock/> : <Unlock/>`).
 * @property lockedValue localized lock value (web `is_locked ? 'Yes' : 'No'`).
 * @property lockedAccent the lock tile accent (web green when locked, cyan otherwise).
 * @property sentryValue localized sentry value (web `sentry_mode ? 'Active' : 'Off'`).
 * @property sentryAccent the sentry tile accent (web green when active, cyan otherwise).
 * @property doorsValue the doors value (web `door_state ?? 'Closed'`).
 * @property doorsAccent the doors tile accent (web cyan when a door state is present, green otherwise).
 * @property windowsValue the windows value (web `windowsOpen > 0 ? '{{count}} open' : 'Closed'`).
 * @property windowsAccent the windows tile accent (web cyan when any window is open, green otherwise).
 */
data class SecuritySectionDisplay(
    val hasEvent: Boolean,
    val locked: Boolean,
    val lockedValue: String,
    val lockedAccent: CardAccent,
    val sentryValue: String,
    val sentryAccent: CardAccent,
    val doorsValue: String,
    val doorsAccent: CardAccent,
    val windowsValue: String,
    val windowsAccent: CardAccent,
) {
    companion object {
        /** The no-event projection (web `securityData == null`): the surface shows its empty state. */
        fun empty(): SecuritySectionDisplay =
            SecuritySectionDisplay(
                hasEvent = false,
                locked = false,
                lockedValue = EM_DASH,
                lockedAccent = CardAccent.Neutral,
                sentryValue = EM_DASH,
                sentryAccent = CardAccent.Neutral,
                doorsValue = EM_DASH,
                doorsAccent = CardAccent.Neutral,
                windowsValue = EM_DASH,
                windowsAccent = CardAccent.Neutral,
            )
    }
}

/**
 * Pure projection from the combined snapshot to the surface's render state — a 1:1 port of the web component's
 * field reads, null guards, and per-tile color logic. Stateless and side-effect-free so it is fully covered by
 * the off-device unit gate; the composable only resolves localized strings and draws what these return.
 */
object SecuritySectionProjection {
    /**
     * The readings the web derives from the snapshot. `is_locked` / `sentry_mode` come from the live
     * [VehicleState] (the shared normalize defaults apply when no state resolved); `door_state` uses the
     * non-empty-string guard (web `door_state != null && door_state !== '' ? String(door_state) : null`); the
     * four window corners are summed by [windowOpenCount].
     */
    fun parse(snapshot: SecuritySnapshot?): SecurityReading {
        val state = snapshot?.state
        val locked = state?.isLocked ?: DEFAULT_LOCKED
        val sentry = state?.sentryMode ?: false
        val security = snapshot?.security as? JsonObject
        return if (security == null) {
            SecurityReading(hasSecurity = false, locked = locked, sentryMode = sentry, doorState = null, windowsOpen = 0)
        } else {
            SecurityReading(
                hasSecurity = true,
                locked = locked,
                sentryMode = sentry,
                doorState = doorStateOf(security),
                windowsOpen = windowOpenCount(security),
            )
        }
    }

    /**
     * True when [snapshot] carries no `SecurityEvent` object (web `securityData == null`) → render the empty
     * state. Used by the view-model to classify the cache-then-network feed onto
     * [io.teslasync.android.data.UiPhase.Empty].
     */
    fun isEmptySnapshot(snapshot: SecuritySnapshot?): Boolean = snapshot?.security !is JsonObject

    /**
     * Projects [snapshot] onto the render-ready [SecuritySectionDisplay] using [strings] for every label /
     * value. A no-event snapshot yields [SecuritySectionDisplay.empty] (the web empty branch); otherwise every
     * tile is read + localized exactly as the web component does, including the `door_state ?? 'Closed'`
     * fallback, the `windowsOpen > 0 ? '{{count}} open' : 'Closed'` value, and the per-tile green / cyan accent.
     */
    fun project(
        snapshot: SecuritySnapshot?,
        strings: SecuritySectionStrings,
    ): SecuritySectionDisplay {
        val reading = parse(snapshot)
        if (!reading.hasSecurity) return SecuritySectionDisplay.empty()
        val windowsOpen = reading.windowsOpen > 0
        return SecuritySectionDisplay(
            hasEvent = true,
            locked = reading.locked,
            lockedValue = if (reading.locked) strings.yes else strings.no,
            lockedAccent = if (reading.locked) CardAccent.Engaged else CardAccent.Neutral,
            sentryValue = if (reading.sentryMode) strings.active else strings.off,
            sentryAccent = if (reading.sentryMode) CardAccent.Engaged else CardAccent.Neutral,
            doorsValue = reading.doorState ?: strings.closed,
            doorsAccent = if (reading.doorState != null) CardAccent.Neutral else CardAccent.Engaged,
            windowsValue = if (windowsOpen) windowsOpenText(strings.windowsOpenTemplate, reading.windowsOpen) else strings.closed,
            windowsAccent = if (windowsOpen) CardAccent.Neutral else CardAccent.Engaged,
        )
    }

    /**
     * Counts the open window corners — a faithful port of the web `windowOpenCount`: for each of the four
     * corners, skip an absent value, coerce the rest with JS `Number(v)` semantics, and count the corner when
     * the result is a finite number greater than zero. A native boolean `true` coerces to `1` (open); a string
     * enum such as `"open"` coerces to `NaN` (not counted), exactly as `Number('open')` does in the browser.
     */
    fun windowOpenCount(security: JsonObject): Int {
        var open = 0
        for (key in WINDOW_FIELDS) {
            val element = security[key]
            if (element == null || element is JsonNull) continue
            val coerced = jsNumber(element)
            if (coerced.isFinite() && coerced > 0.0) open += 1
        }
        return open
    }
}

/** Localized `'{{count}} open'` — the catalog `'%1$s open'` pattern with the open-window [count] interpolated. */
private fun windowsOpenText(
    template: String,
    count: Int,
): String = String.format(Locale.ROOT, template, count)

/**
 * The non-empty `door_state` string the web renders verbatim (`String(door_state)`), or `null` when the field
 * is absent, JSON null, a non-primitive, or the empty string (the web `door_state !== ''` guard). A boolean /
 * numeric `door_state` is stringified to its literal, matching the browser `String(value)`.
 */
private fun doorStateOf(security: JsonObject): String? {
    val primitive = security[FIELD_DOOR_STATE]?.takeUnless { it is JsonNull } as? JsonPrimitive
    return primitive?.content?.takeIf { it.isNotEmpty() }
}

/**
 * JS `Number(value)` semantics for a JSON element — the coercion the web `windowOpenCount` applies to each
 * window corner. A JSON string parses as a trimmed decimal (`''` → `0`, a non-numeric string → `NaN`); a JSON
 * boolean becomes `1` / `0`; a JSON number passes through; any other shape is `NaN`.
 */
private fun jsNumber(element: JsonElement): Double {
    val primitive = element as? JsonPrimitive ?: return Double.NaN
    return when {
        primitive.isString -> jsParseString(primitive.content)
        primitive.booleanOrNull != null -> if (primitive.booleanOrNull == true) 1.0 else 0.0
        else -> primitive.doubleOrNull ?: Double.NaN
    }
}

/** JS `Number(string)` for a quoted JSON string: a trimmed empty string is `0`, otherwise a decimal or `NaN`. */
private fun jsParseString(raw: String): Double {
    val trimmed = raw.trim()
    return if (trimmed.isEmpty()) 0.0 else (JsonPrimitive(trimmed).doubleOrNull ?: Double.NaN)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SecuritySectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from
 * the composable's first-composition effect. Carries only the slug — never a lock / sentry / door value.
 */
fun recordSecuritySectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SecuritySectionRegistration.SLUG))
}
