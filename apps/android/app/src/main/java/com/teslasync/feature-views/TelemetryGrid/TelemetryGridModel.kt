// Pure, framework-free model + projection for the TelemetryGrid feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/telemetry-panels/TelemetryGrid.tsx). No Compose, no Android UI, no
// HTTP: every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// TelemetryGrid is a presentational surface — the web component takes a single non-null `state: VehicleState`
// prop from the owning vehicle Live/Overview page (which owns the `/vehicles/{vehicleID}/state` TanStack
// query and its loading / error / stale / offline handling), and its only data hooks are `useTranslation`
// (labels, P1/S10) and `useUnits` (the SI -> display formatter, P1/S8). As in the committed LiveVehicleState
// and QuickMetrics ports, the cache-then-network states live on that owning page, not here; the two branches
// this surface renders — a present `state` (the six-tile grid) and an absent `state` (a friendly EmptyState,
// never a blank box) — are the complete state set. The absent branch doubles as the offline-cached-empty
// surface, and the cached-payload decode path is covered by the projection's data-adapter test.
//
// The web reads ten `VehicleState` fields and formats six tiles. Three figures are rendered with the raw
// `numberFormat` helpers exactly as the web does (`fmtInt(battery_level)%`, `fmtInt(charger_power) kW`,
// `fmtNumber(time_to_full_charge)h`) — these never pass through `useUnits`, so they are formatted here with a
// locale-aware [formatNumber] (the native `fmtNumber` port). The other five (rated range, speed, inside /
// outside temperature, odometer) ARE SI values the web threads through `useUnits`; they are formatted here by
// delegating to the injected [UnitFormatter] (the shared SI -> display boundary, the `useUnits` port), so no
// unit math is duplicated and the SI source is never stored converted (Phase-48 SI-canonical rule).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TelemetryGrid — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.telemetrygrid

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no PII. */
const val TELEMETRY_GRID_SLUG: String = "TelemetryGrid"

/** Web `${fmtInt(battery_level)}%` — the percent glyph appended verbatim; standard in every locale. */
internal const val TELEMETRY_GRID_PERCENT: String = "%"

/** Web `${fmtInt(charger_power)} kW` — the kilowatt glyph appended verbatim; standard in every locale. */
internal const val TELEMETRY_GRID_UNIT_KW: String = "kW"

/** Web `${fmtNumber(time_to_full_charge)}h` — the hours glyph appended verbatim; standard in every locale. */
internal const val TELEMETRY_GRID_UNIT_HOUR: String = "h"

/** Web `numberFormat` global default precision before settings load (`_globalPrecision`). */
internal const val TELEMETRY_GRID_DEFAULT_PRECISION: Int = 2

/** The battery accent threshold the web uses for the emerald branch (`battery_level > 50`). */
internal const val BATTERY_GOOD_THRESHOLD: Double = 50.0

/** The battery accent threshold the web uses for the amber branch (`battery_level > 20`). */
internal const val BATTERY_WARN_THRESHOLD: Double = 20.0

private const val INTEGER_DECIMALS: Int = 0

/**
 * The slice of the `/vehicles/{vehicleID}/state` document that TelemetryGrid actually reads off its `state`
 * prop — the native mirror of the ten `VehicleState` fields the web component renders (web `@/api/types`).
 * Field names keep their snake_case wire form via @SerialName so the projection runs directly off the cached
 * API JSON, and every field defaults so a partial payload decodes without error (a decoder must ignore
 * unknown keys for the columns this surface does not read).
 *
 * The five SI fields ([ratedRangeMeters], [speedMps], [insideTempCelsius], [outsideTempCelsius],
 * [odometerMeters]) are stored and served in SI (meters, m/s, degrees Celsius) per Phase-42/48; they are
 * converted to the user's units only at the display boundary by the injected [UnitFormatter]. The three
 * non-SI display figures ([batteryLevel], [chargerPowerKw], [timeToFullChargeHours]) are formatted with the
 * raw `numberFormat` helpers exactly as the web source does.
 *
 * @property batteryLevel battery state of charge percentage (web `battery_level`).
 * @property ratedRangeMeters EPA/rated range in SI meters (web `rated_range`).
 * @property speedMps current speed in SI metres per second (web `speed`).
 * @property insideTempCelsius cabin temperature in SI degrees Celsius (web `inside_temp`).
 * @property outsideTempCelsius ambient temperature in SI degrees Celsius (web `outside_temp`).
 * @property odometerMeters odometer reading in SI meters (web `odometer`).
 * @property isCharging whether a charge session is active (web `is_charging`).
 * @property chargerPowerKw active charger power, already in kW on the wire (web `charger_power`).
 * @property timeToFullChargeHours hours remaining to a full charge (web `time_to_full_charge`).
 * @property sentryMode whether Sentry Mode is armed (web `sentry_mode`).
 */
@Serializable
data class VehicleStateTelemetry(
    @SerialName("battery_level") val batteryLevel: Double? = null,
    @SerialName("rated_range") val ratedRangeMeters: Double? = null,
    @SerialName("speed") val speedMps: Double? = null,
    @SerialName("inside_temp") val insideTempCelsius: Double? = null,
    @SerialName("outside_temp") val outsideTempCelsius: Double? = null,
    @SerialName("odometer") val odometerMeters: Double? = null,
    @SerialName("is_charging") val isCharging: Boolean? = null,
    @SerialName("charger_power") val chargerPowerKw: Double? = null,
    @SerialName("time_to_full_charge") val timeToFullChargeHours: Double? = null,
    @SerialName("sentry_mode") val sentryMode: Boolean? = null,
)

/**
 * Stable identity of each tile, in the exact order the web component emits them. The view maps each key onto
 * its i18n label and glyph; keeping the key separate from the resolved label keeps the projection free of any
 * Android / i18n dependency.
 */
enum class TelemetryTileKey {
    BATTERY,
    SPEED,
    INSIDE,
    ODOMETER,
    CHARGER,
    SENTRY,
}

/**
 * The accent a tile's value renders in — the native analogue of the web `color` prop the `InfoTile` receives.
 * Decoupled from the concrete [androidx.compose.ui.graphics.Color] so the projection stays pure; the view
 * resolves each accent through the design tokens (P1/S9).
 *
 * Web mapping: [PRIMARY] -> `text-[var(--text-primary)]` (the `InfoTile` default), [SUCCESS] -> `emerald-300`,
 * [WARNING] -> `amber-300`, [DANGER] -> `rose-300`, [MUTED] -> `text-[var(--text-muted)]`.
 */
enum class TileAccent {
    PRIMARY,
    SUCCESS,
    WARNING,
    DANGER,
    MUTED,
}

/**
 * The render-ready primary value of a tile, decoupled from any localized text so the projection stays pure.
 * A [Text] carries an already-formatted figure (a percentage, a unit-suffixed number, or a `useUnits`
 * result) that is not itself translated; the three state variants are resolved through the i18n catalog by
 * the view — mirroring the web `is_charging ? … : 'Not charging'` and `sentry_mode ? 'Active' : 'Off'`
 * literals, which this port routes through the existing `common.*` keys rather than hard-coding English.
 */
sealed interface TileValue {
    /** An already-formatted, non-translated figure (e.g. "84%", "11 kW", "350 km", "21°C"). */
    data class Text(
        val text: String,
    ) : TileValue

    /** Web charger `'Not charging'` branch → `common.notCharging`. */
    data object NotCharging : TileValue

    /** Web sentry `'Active'` branch → `common.active`. */
    data object SentryActive : TileValue

    /** Web sentry `'Off'` branch → `common.off`. */
    data object SentryOff : TileValue
}

/**
 * The render-ready sub-line of a tile (the small caption under the value), decoupled from localized text so
 * the projection stays pure. Each variant carries only the already-formatted numeric fragment; the view
 * supplies the translated word(s) and composes the final string, mirroring the web template literals.
 */
sealed interface TileSub {
    /** No sub-line (web `sub` undefined — the Odometer and Sentry tiles). */
    data object None : TileSub

    /** Web `${formatDistance(rated_range)} ${t('common.range')}` → "{distance} range". */
    data class Range(
        val distance: String,
    ) : TileSub

    /** Web Speed `'Driving'` branch → `common.driving`. */
    data object Driving : TileSub

    /** Web Speed `'Parked'` branch → `common.parked`. */
    data object Parked : TileSub

    /** Web `${t('common.outside')}: ${formatTemperature(outside_temp)}` → "Outside: {temperature}". */
    data class Outside(
        val temperature: String,
    ) : TileSub

    /** Web `Full in ${fmtNumber(time_to_full_charge)}h` → "{fullIn} {hours}" with the hours glyph baked in. */
    data class FullIn(
        val hours: String,
    ) : TileSub
}

/**
 * One fully projected tile — the native analogue of one web `InfoTile` invocation (minus the JSX icon and
 * label, which the view supplies from [key]). Pure data so the projection is unit-tested without a UI host;
 * the per-state list of these doubles as the surface's snapshot.
 *
 * @property key the tile identity (drives label + glyph in the view).
 * @property value the render-ready primary value descriptor.
 * @property sub the render-ready sub-line descriptor.
 * @property accent the value's accent (web `InfoTile` `color`).
 */
data class TelemetryTile(
    val key: TelemetryTileKey,
    val value: TileValue,
    val sub: TileSub,
    val accent: TileAccent,
)

/**
 * The fully projected, render-ready view — everything the web component computes before returning JSX. When
 * a `state` is present this always holds all six tiles in web source order; an absent `state` selects the
 * empty branch and is modelled as a `null` [TelemetryGridDisplay], never an empty list, so the view's two
 * branches map 1:1 to the web `state ? grid : empty`.
 *
 * @property tiles the six tiles, in web source order (BATTERY, SPEED, INSIDE, ODOMETER, CHARGER, SENTRY).
 */
data class TelemetryGridDisplay(
    val tiles: List<TelemetryTile>,
)

/**
 * Pure projection from the surface's `state` prop to its render-ready [TelemetryGridDisplay] — a 1:1 port of
 * the formatting + conditional logic the web component performs. Stateless and side-effect-free so it is
 * fully covered by the off-device unit gate; the composable only resolves localized labels, glyphs, and
 * design-token accents and draws what these functions return.
 *
 * The [formatter] is the shared SI -> display boundary (the `useUnits` port), injected so the projection
 * performs no unit math of its own; it supplies the locale + precision for the raw `numberFormat` figures
 * too, mirroring the web `_globalLocale` / `_globalPrecision` the bare `fmtInt` / `fmtNumber` read.
 */
object TelemetryGridProjection {
    /**
     * Project the surface's `state` prop onto its render-ready view, or `null` when `state` is absent (the
     * native analogue of the web `state ? <grid/> : <empty/>` guard — `null` selects the empty branch).
     */
    fun project(
        state: VehicleStateTelemetry?,
        formatter: UnitFormatter,
    ): TelemetryGridDisplay? {
        if (state == null) return null
        return TelemetryGridDisplay(
            tiles =
                listOf(
                    battery(state, formatter),
                    speed(state, formatter),
                    inside(state, formatter),
                    odometer(state, formatter),
                    charger(state, formatter),
                    sentry(state),
                ),
        )
    }

    /**
     * Web Battery tile: `${fmtInt(battery_level)}%`, accent emerald / amber / rose by the `> 50` / `> 20`
     * thresholds, sub `${formatDistance(rated_range)} ${t('common.range')}`.
     */
    private fun battery(
        state: VehicleStateTelemetry,
        formatter: UnitFormatter,
    ): TelemetryTile {
        val level = safeNumber(state.batteryLevel)
        val accent =
            when {
                level > BATTERY_GOOD_THRESHOLD -> TileAccent.SUCCESS
                level > BATTERY_WARN_THRESHOLD -> TileAccent.WARNING
                else -> TileAccent.DANGER
            }
        return TelemetryTile(
            key = TelemetryTileKey.BATTERY,
            value = TileValue.Text(formatInteger(state.batteryLevel, locale(formatter)) + TELEMETRY_GRID_PERCENT),
            sub = TileSub.Range(formatter.distance(state.ratedRangeMeters)),
            accent = accent,
        )
    }

    /** Web Speed tile: `formatSpeed(speed)`, sub `speed > 0 ? 'Driving' : 'Parked'`. */
    private fun speed(
        state: VehicleStateTelemetry,
        formatter: UnitFormatter,
    ): TelemetryTile =
        TelemetryTile(
            key = TelemetryTileKey.SPEED,
            value = TileValue.Text(formatter.speed(state.speedMps)),
            sub = if (safeNumber(state.speedMps) > 0.0) TileSub.Driving else TileSub.Parked,
            accent = TileAccent.PRIMARY,
        )

    /** Web Inside tile: `formatTemperature(inside_temp)`, sub `Outside: ${formatTemperature(outside_temp)}`. */
    private fun inside(
        state: VehicleStateTelemetry,
        formatter: UnitFormatter,
    ): TelemetryTile =
        TelemetryTile(
            key = TelemetryTileKey.INSIDE,
            value = TileValue.Text(formatter.temperature(state.insideTempCelsius)),
            sub = TileSub.Outside(formatter.temperature(state.outsideTempCelsius)),
            accent = TileAccent.PRIMARY,
        )

    /** Web Odometer tile: `formatDistance(odometer, { precision: 0 })`, no sub. */
    private fun odometer(
        state: VehicleStateTelemetry,
        formatter: UnitFormatter,
    ): TelemetryTile =
        TelemetryTile(
            key = TelemetryTileKey.ODOMETER,
            value = TileValue.Text(formatter.distance(state.odometerMeters, precision = INTEGER_DECIMALS)),
            sub = TileSub.None,
            accent = TileAccent.PRIMARY,
        )

    /**
     * Web Charger tile: charging → `${fmtInt(charger_power)} kW` in emerald with a `Full in …h` sub when a
     * time-to-full is known; otherwise `'Not charging'` in the muted foreground with no sub.
     */
    private fun charger(
        state: VehicleStateTelemetry,
        formatter: UnitFormatter,
    ): TelemetryTile {
        val charging = state.isCharging == true
        if (!charging) {
            return TelemetryTile(
                key = TelemetryTileKey.CHARGER,
                value = TileValue.NotCharging,
                sub = TileSub.None,
                accent = TileAccent.MUTED,
            )
        }
        val power = formatInteger(state.chargerPowerKw, locale(formatter)) + " " + TELEMETRY_GRID_UNIT_KW
        val sub =
            if (state.timeToFullChargeHours != null) {
                val hours = formatNumber(state.timeToFullChargeHours, precision(formatter), locale(formatter))
                TileSub.FullIn(hours + TELEMETRY_GRID_UNIT_HOUR)
            } else {
                TileSub.None
            }
        return TelemetryTile(
            key = TelemetryTileKey.CHARGER,
            value = TileValue.Text(power),
            sub = sub,
            accent = TileAccent.SUCCESS,
        )
    }

    /** Web Sentry tile: `sentry_mode ? 'Active' : 'Off'`, accent rose when armed else muted, no sub. */
    private fun sentry(state: VehicleStateTelemetry): TelemetryTile {
        val armed = state.sentryMode == true
        return TelemetryTile(
            key = TelemetryTileKey.SENTRY,
            value = if (armed) TileValue.SentryActive else TileValue.SentryOff,
            sub = TileSub.None,
            accent = if (armed) TileAccent.DANGER else TileAccent.MUTED,
        )
    }

    /**
     * Web `safeNumber` (`@/lib/numberFormat`): a finite number passes through, anything else (NaN, ±∞, null)
     * becomes `0` so a sparse field never renders `NaN`.
     */
    fun safeNumber(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0

    /** Web `fmtInt(v)` — `fmtNumber(v, 0)`: a locale-grouped integer with `safeNumber` coercion. */
    fun formatInteger(
        value: Double?,
        locale: Locale,
    ): String = formatNumber(value, INTEGER_DECIMALS, locale)

    /**
     * Web `fmtNumber(v, decimals)` — `safeNumber(v).toLocaleString(locale, {min/maxFractionDigits})`. Groups
     * thousands and rounds half away from zero so the output matches ECMAScript `Intl.NumberFormat`
     * (`halfExpand`) rather than Java's default banker's rounding (HALF_EVEN).
     */
    fun formatNumber(
        value: Double?,
        decimals: Int,
        locale: Locale,
    ): String =
        NumberFormat
            .getNumberInstance(locale)
            .apply {
                minimumFractionDigits = decimals
                maximumFractionDigits = decimals
                isGroupingUsed = true
                roundingMode = RoundingMode.HALF_UP
            }.format(safeNumber(value))

    /** Resolve the BCP-47 locale tag the formatter carries into a [Locale], falling back to en-US. */
    private fun locale(formatter: UnitFormatter): Locale {
        val tag = formatter.prefs.locale
        return if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)
    }

    /** The user's decimal precision (web `_globalPrecision`), defaulting to 2 before settings load. */
    private fun precision(formatter: UnitFormatter): Int = formatter.prefs.precision ?: TELEMETRY_GRID_DEFAULT_PRECISION
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a battery
 * level, speed, temperature, odometer, charger power, or sentry posture — so a diagnostics line can never
 * leak the vehicle's live telemetry.
 */
object TelemetryGridDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = TELEMETRY_GRID_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
