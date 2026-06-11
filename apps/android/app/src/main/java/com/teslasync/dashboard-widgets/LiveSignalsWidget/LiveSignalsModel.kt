// Pure, framework-free model + projection for the Live Signals dashboard widget — the native analogue of
// the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/LiveSignalsWidget.tsx). No Compose, no Android framework, no HTTP:
// every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. SI values (°C, kPa) are converted to the user's display unit here at the
// single render-boundary seam (Phase-48 SI-canonical rule; web `useUnits()` + `convertTempFromSI` /
// `convertPressureFromSI`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/LiveSignalsWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling ClimateStatusWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.livesignals

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** Em dash shown for a missing reading — the web `'—'` fallback and the shared formatter's empty value. */
internal const val EM_DASH: String = "\u2014"

/** Go `fmt.Sprintf("%v", nil)` string sentinels the web `cleanNil` strips so a stored "<nil>" never renders. */
private val NIL_SENTINELS: Set<String> = setOf("<nil>", "nil", "null")

// Motor snapshot fields the web reads (`/motor/latest`): raw torque, stator temperature, gear.
private const val FIELD_DI_TORQUE = "di_torque"
private const val FIELD_DI_STATOR_TEMP = "di_stator_temp"
private const val FIELD_GEAR = "gear"

// Climate snapshot compat-alias fields the web reads (`/climate/latest`): cabin/outside temp, HVAC power.
private const val FIELD_INSIDE_TEMP = "inside_temp"
private const val FIELD_OUTSIDE_TEMP = "outside_temp"
private const val FIELD_HVAC_POWER = "hvac_power"

// Tire-pressure snapshot corners the web reads (`/tire-pressure/latest`), SI kilopascals.
private const val FIELD_FRONT_LEFT = "front_left"
private const val FIELD_FRONT_RIGHT = "front_right"
private const val FIELD_REAR_LEFT = "rear_left"
private const val FIELD_REAR_RIGHT = "rear_right"

// Security-event fields the web reads (`/security/latest`): lock + sentry booleans.
private const val FIELD_LOCKED = "locked"
private const val FIELD_SENTRY_MODE = "sentry_mode"

/** Temperatures render as whole degrees (web `fmtInt`); pressures + HVAC render with one decimal (web `fmtNumber(_, 1)`). */
private const val TEMP_DECIMALS = 0
private const val PRESSURE_DECIMALS = 1
private const val HVAC_POWER_DECIMALS = 1

/** Literal unit suffixes the web appends verbatim (torque is raw Nm; HVAC power is already kW). */
private const val TORQUE_UNIT = " Nm"
private const val HVAC_POWER_UNIT = " kW"

/**
 * The four tire-position labels are non-translatable wheel-position codes rendered as literals by the web
 * source (`label="FL"` … — they are NOT `t()` keys), so they are reproduced verbatim here for parity.
 */
internal const val TIRE_LABEL_FL = "FL"
internal const val TIRE_LABEL_FR = "FR"
internal const val TIRE_LABEL_RL = "RL"
internal const val TIRE_LABEL_RR = "RR"

/**
 * The widget grid footprint (columns × rows). The web `LiveSignalsWidget` destructures only `vehicleId`
 * from `WidgetProps` and never reads `size`, so the surface renders identically at every footprint; this
 * type exists to mirror the registry's size contract (consumed by the grid host), not to branch the layout.
 */
data class LiveSignalsSize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/telemetry.ts (`live-signals`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object LiveSignalsRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "live-signals"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "telemetry"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LiveSignalsWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val DEFAULT_SIZE: LiveSignalsSize = LiveSignalsSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 2 rows (web `minSize`). */
    val MIN_SIZE: LiveSignalsSize = LiveSignalsSize(cols = 2, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: LiveSignalsSize = LiveSignalsSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: LiveSignalsSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: LiveSignalsSize): LiveSignalsSize =
        LiveSignalsSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * Localized labels the surface folds into its output (web `t('widget.…')` calls). The pure
 * [LiveSignalsProjection] reads these to assemble each section's TalkBack content description; the
 * composable additionally renders them as the visible field labels. The composable builds this from
 * `stringResource`; tests pass a deterministic instance. Keeping i18n out of the projection lets the
 * projection stay a pure, locale-stable function.
 */
data class LiveSignalsStrings(
    val liveSignals: String,
    val noSignals: String,
    val motor: String,
    val torque: String,
    val motorTemp: String,
    val gear: String,
    val climate: String,
    val cabin: String,
    val outside: String,
    val hvac: String,
    val tires: String,
    val security: String,
    val lock: String,
    val locked: String,
    val unlocked: String,
    val sentry: String,
    val active: String,
    val off: String,
)

/** Semantic tone for a security chip — mapped to the shared `BadgeVariant` at the render boundary. */
enum class SignalBadge { Success, Danger, Neutral }

/** Render-ready drivetrain section (web "Motor"): already-formatted torque, temperature, and gear values. */
data class MotorDisplay(
    val torque: String,
    val temp: String,
    val gear: String,
    val contentDescription: String,
)

/** Render-ready climate section: already SI→display-converted cabin/outside temperatures and HVAC power. */
data class ClimateDisplay(
    val cabin: String,
    val outside: String,
    val hvac: String,
    val contentDescription: String,
)

/** Render-ready tire section: the four already SI→display-converted corner pressures. */
data class TiresDisplay(
    val frontLeft: String,
    val frontRight: String,
    val rearLeft: String,
    val rearRight: String,
    val contentDescription: String,
)

/** Render-ready security section: lock + sentry chip text and tone (web `Badge variant`). */
data class SecurityDisplay(
    val lockText: String,
    val lockTone: SignalBadge,
    val sentryText: String,
    val sentryTone: SignalBadge,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of all four live-signal sections — the native analogue of
 * everything the web component computes before returning JSX. A `null` section means its `/…/latest`
 * document was absent / not an object (web query `data` falsy), so the composable renders that section's
 * loading skeleton (web `<Skeleton />`). When every section is `null`, [hasData] is false and the surface
 * renders the friendly empty state (web `!hasData` branch).
 */
data class LiveSignalsDisplay(
    val motor: MotorDisplay?,
    val climate: ClimateDisplay?,
    val tires: TiresDisplay?,
    val security: SecurityDisplay?,
) {
    /** Web `hasData = motor || climate || security || tires`: at least one section resolved an object. */
    val hasData: Boolean get() = motor != null || climate != null || tires != null || security != null
}

/**
 * The immutable widget state the [LiveSignalsWidgetViewModel] exposes: the four raw SI `/…/latest`
 * documents (each `null`/`JsonNull` until its feed resolves an object) plus the freshness of the **motor**
 * feed, which drives the header chip exactly as the web binds `WidgetShell` to the `useMotorLatest` query
 * (`updatedAt` / `isFetching` / `isStale` / `isError`). Conversion to display units happens later, at the
 * render boundary, via [LiveSignalsProjection.project].
 */
data class LiveSignalsState(
    val motor: JsonElement?,
    val climate: JsonElement?,
    val security: JsonElement?,
    val tires: JsonElement?,
    val updatedAtMillis: Long?,
    val isFetching: Boolean,
    val isStale: Boolean,
    val isError: Boolean,
) {
    companion object {
        /** The pre-resolution / no-vehicle state: nothing loaded, neutral freshness (web id≤0 ⇒ disabled queries). */
        val EMPTY: LiveSignalsState =
            LiveSignalsState(
                motor = null,
                climate = null,
                security = null,
                tires = null,
                updatedAtMillis = null,
                isFetching = false,
                isStale = false,
                isError = false,
            )
    }
}

/**
 * Pure projection from the four decoded `/…/latest` [JsonElement]s to the render-ready
 * [LiveSignalsDisplay] — the native port of the field reads + null guards + inline formatting the web
 * component performs in JSX. SI temperatures/pressures are converted through the shared [UnitFormatter]
 * (web `useUnits()` + `convertTempFromSI` / `convertPressureFromSI`), keeping the SI source unconverted
 * (Phase-48; ADR-013). A section whose document is absent / `JsonNull` / not an object projects to `null`
 * (web query `data` falsy ⇒ the section's `<Skeleton />`).
 */
object LiveSignalsProjection {
    /** Project all four sections of [state] using [formatter] for the SI→display boundary and [strings] for labels. */
    fun project(
        state: LiveSignalsState,
        formatter: UnitFormatter,
        strings: LiveSignalsStrings,
    ): LiveSignalsDisplay =
        LiveSignalsDisplay(
            motor = motor(state.motor, formatter, strings),
            climate = climate(state.climate, formatter, strings),
            tires = tires(state.tires, formatter, strings),
            security = security(state.security, strings),
        )

    /** Project the motor snapshot (web `motor ? … : <Skeleton />`); `null` when the document is not an object. */
    fun motor(
        snapshot: JsonElement?,
        formatter: UnitFormatter,
        strings: LiveSignalsStrings,
    ): MotorDisplay? {
        val obj = snapshot as? JsonObject ?: return null
        val torque = obj.rawNumberField(FIELD_DI_TORQUE)?.let { "$it$TORQUE_UNIT" } ?: EM_DASH
        val temp =
            obj.doubleField(FIELD_DI_STATOR_TEMP)?.let { formatter.temperature(it, TEMP_DECIMALS) } ?: EM_DASH
        val gear = cleanNil(obj.stringField(FIELD_GEAR)) ?: EM_DASH
        return MotorDisplay(
            torque = torque,
            temp = temp,
            gear = gear,
            contentDescription = description(strings.motor, strings.torque to torque, strings.motorTemp to temp, strings.gear to gear),
        )
    }

    /** Project the climate snapshot (web `climate ? … : <Skeleton />`); `null` when the document is not an object. */
    fun climate(
        snapshot: JsonElement?,
        formatter: UnitFormatter,
        strings: LiveSignalsStrings,
    ): ClimateDisplay? {
        val obj = snapshot as? JsonObject ?: return null
        val cabin = obj.doubleField(FIELD_INSIDE_TEMP)?.let { formatter.temperature(it, TEMP_DECIMALS) } ?: EM_DASH
        val outside = obj.doubleField(FIELD_OUTSIDE_TEMP)?.let { formatter.temperature(it, TEMP_DECIMALS) } ?: EM_DASH
        val hvac = formatHvacPower(obj.doubleField(FIELD_HVAC_POWER), formatter.prefs.locale)
        return ClimateDisplay(
            cabin = cabin,
            outside = outside,
            hvac = hvac,
            contentDescription = description(strings.climate, strings.cabin to cabin, strings.outside to outside, strings.hvac to hvac),
        )
    }

    /** Project the tire-pressure snapshot (web `tires ? … : <Skeleton />`); `null` when the document is not an object. */
    fun tires(
        snapshot: JsonElement?,
        formatter: UnitFormatter,
        strings: LiveSignalsStrings,
    ): TiresDisplay? {
        val obj = snapshot as? JsonObject ?: return null
        val fl = obj.doubleField(FIELD_FRONT_LEFT)?.let { formatter.pressure(it, PRESSURE_DECIMALS) } ?: EM_DASH
        val fr = obj.doubleField(FIELD_FRONT_RIGHT)?.let { formatter.pressure(it, PRESSURE_DECIMALS) } ?: EM_DASH
        val rl = obj.doubleField(FIELD_REAR_LEFT)?.let { formatter.pressure(it, PRESSURE_DECIMALS) } ?: EM_DASH
        val rr = obj.doubleField(FIELD_REAR_RIGHT)?.let { formatter.pressure(it, PRESSURE_DECIMALS) } ?: EM_DASH
        return TiresDisplay(
            frontLeft = fl,
            frontRight = fr,
            rearLeft = rl,
            rearRight = rr,
            contentDescription =
                description(
                    strings.tires,
                    TIRE_LABEL_FL to fl,
                    TIRE_LABEL_FR to fr,
                    TIRE_LABEL_RL to rl,
                    TIRE_LABEL_RR to rr,
                ),
        )
    }

    /** Project the security snapshot (web `security ? … : <Skeleton />`); `null` when the document is not an object. */
    fun security(
        snapshot: JsonElement?,
        strings: LiveSignalsStrings,
    ): SecurityDisplay? {
        val obj = snapshot as? JsonObject ?: return null
        val locked = obj.boolField(FIELD_LOCKED)
        val sentry = obj.boolField(FIELD_SENTRY_MODE)
        val lockText = if (locked) strings.locked else strings.unlocked
        val sentryText = if (sentry) strings.active else strings.off
        return SecurityDisplay(
            lockText = lockText,
            lockTone = if (locked) SignalBadge.Success else SignalBadge.Danger,
            sentryText = sentryText,
            sentryTone = if (sentry) SignalBadge.Success else SignalBadge.Neutral,
            contentDescription = description(strings.security, strings.lock to lockText, strings.sentry to sentryText),
        )
    }

    /** Web `cleanNil`: drops empty / Go `<nil>` / `nil` / `null` string sentinels so the gear renders the em dash. */
    fun cleanNil(value: String?): String? = if (value.isNullOrEmpty() || value in NIL_SENTINELS) null else value

    /** Folds a section's title + label/value pairs into one TalkBack phrase (web's implicit reading order). */
    private fun description(
        title: String,
        vararg rows: Pair<String, String>,
    ): String = (listOf(title) + rows.map { "${it.first} ${it.second}" }).joinToString(", ")

    /**
     * Formats the already-kW HVAC power as "{n.n} kW" (web `fmtNumber(hvac_power, 1)` — no SI conversion,
     * the field is delivered in kilowatts). Uses the user's [localeTag] grouping/decimal symbols, matching
     * the sibling ClimateStatusWidget's identical `hvac_power` rendering for cross-surface consistency.
     */
    private fun formatHvacPower(
        valueKw: Double?,
        localeTag: String?,
    ): String {
        if (valueKw == null || !valueKw.isFinite()) return EM_DASH
        val pattern = "#,##0." + "0".repeat(HVAC_POWER_DECIMALS)
        val formatted = DecimalFormat(pattern, DecimalFormatSymbols(localeFrom(localeTag))).format(valueKw)
        return "$formatted$HVAC_POWER_UNIT"
    }

    private fun localeFrom(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)
}

/** Read a numeric field, or `null` when absent / `JsonNull` / not a JSON number (web typed `number`). */
private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Read a boolean field, defaulting to `false` when absent / `JsonNull` / not a JSON boolean (web `value ? …`). */
private fun JsonObject.boolField(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: false

/** Read a JSON string field, or `null` when absent / `JsonNull` / not a quoted string (web typed `string`). */
private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }

/**
 * Read a JSON number's verbatim literal token (web renders `${motor.di_torque}` — the parsed number
 * stringified, which round-trips the server's token for the integral/short-decimal magnitudes Go emits).
 * `null` when absent / `JsonNull` / a quoted string / not numeric.
 */
private fun JsonObject.rawNumberField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (!it.isString && it.doubleOrNull != null) it.content else null }

/**
 * The active vehicle id the widget reads signals for — the native port of the web
 * `id = vehicleId ?? vehicles?.[0]?.id ?? 0`. A positive [preferredVehicleId] wins; otherwise the first
 * enrolled vehicle is used; `null` means neither is available (the surface shows its empty state).
 */
fun resolveVehicleId(
    preferredVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = preferredVehicleId?.takeIf { it > 0L } ?: firstVehicleId(vehicles)

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty (web `vehicles?.[0]?.id`). */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
