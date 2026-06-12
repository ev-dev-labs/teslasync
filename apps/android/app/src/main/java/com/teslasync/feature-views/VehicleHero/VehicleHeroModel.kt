// Pure, framework-free model + projection for the dashboard Vehicle Hero feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/dashboard/components/VehicleHero.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable
// a thin render layer.
//
// The web component is purely presentational — its parent (VehicleHeroWidget) loads the vehicle + its state
// and passes them down with SI->display converters; VehicleHero then renders context-aware radial gauges, a
// charging banner, a context-aware stat grid, and quick-action buttons, or a "wake to see live data" card
// when the vehicle is asleep (`state == null`). This file owns the parts the web derives from those props:
// the resolved name/subtitle/status, the gauge specs, the charging-detail strings, the three context stat-card
// layouts (driving / charging / idle) plus the always-visible cards, and the accessible summary. Values stay
// SI on the wire; the SI->display conversion happens here through the injected [UnitFormatter] (the web
// `useUnits` boundary), never by mutating the source.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/VehicleHero — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclehero

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import io.teslasync.shared.core.units.convertTempFromSI
import java.util.Locale

/** Em dash shown wherever a value is unknown — the web `'\u2014'` empty marker. */
internal const val HERO_EM_DASH: String = "\u2014"

/** The web `state?.state ?? 'offline'` fallback when no decodable state is available. */
internal const val HERO_OFFLINE: String = "offline"

/** Universal unit symbols the web renders verbatim regardless of locale (`kW`, `%`, `/h`). */
internal const val HERO_KW: String = "kW"
internal const val HERO_PERCENT: String = "%"
internal const val HERO_PER_HOUR: String = "/h"

/** Battery health threshold — web `state.battery_level > 50 ? emerald : amber`. */
internal const val HERO_BATTERY_HIGH_THRESHOLD: Int = 50

/** Gauge maxima — web `RadialGauge max=…` values. */
internal const val HERO_BATTERY_MAX: Double = 100.0
internal const val HERO_RANGE_MAX: Double = 600.0
internal const val HERO_SPEED_MAX: Double = 250.0
internal const val HERO_POWER_MAX: Double = 250.0
internal const val HERO_TEMP_MAX_C: Double = 50.0
internal const val HERO_TEMP_MAX_F: Double = 122.0

/** Hours -> milliseconds, for the "done at ~time" charge projection (web `* 3_600_000`). */
internal const val HERO_MILLIS_PER_HOUR: Double = 3_600_000.0

/** Per-call render precision, mirroring the web `fmtNumber(…, n)` / `fmtInt` calls verbatim. */
internal const val HERO_WHOLE_DECIMALS: Int = 0
internal const val HERO_HOURS_DECIMALS: Int = 1
internal const val HERO_TEMP_DECIMALS: Int = 1

/** The web `fmtNumber(x)` default precision (its global precision, default 2) when no per-call digits given. */
internal const val HERO_DEFAULT_DECIMALS: Int = 2

/**
 * Sentinel for the drivetrain-power card label. The same card appears in two web layouts (driving + the
 * always-visible row); carrying this marker keeps the projection locale-pure while letting the Compose
 * boundary swap in the localized "Power" label (`stringResource(hero.power)`).
 */
internal const val HERO_POWER_LABEL_SENTINEL: String = "@power"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object VehicleHeroRegistration {
    /** Stable surface id. */
    const val ID: String = "vehicle-hero"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehicleHero"
}

/**
 * The two props the web component composes, folded into one render payload: the resolved [vehicle] (web
 * `vehicle` — the source of the name / model / trim / vin) and its last-known [state] (web `state`, the
 * source of battery / range / temps / speed / charge). A `null` [vehicle] is the surface's empty state (web
 * parent `{vehicle && <VehicleHero/>}`); a `null` [state] is the "asleep" card (web `state ? … : <asleep/>`).
 * [firmwareVersion] is the web `firmwareVersion` prop (live version, else state's software version, else `\u2014`).
 */
data class VehicleHeroData(
    val vehicle: Vehicle?,
    val state: VehicleState?,
    val firmwareVersion: String,
)

/** The accent role a gauge / stat resolves to at the render boundary (mapped to a design token by the view). */
enum class HeroAccent { Green, Amber, Cyan, Purple, Blue, Red, Neutral, Primary }

/** Which line-style glyph a stat card renders (mapped to an `ImageVector` by the view). */
enum class HeroGlyph { Gauge, Bolt, Navigation, Activity, Thermometer, Clock, Lock, Unlock, Shield }

/**
 * One context-aware radial gauge spec — the native mirror of a web `<RadialGauge value max label unit
 * color>`. [value] is already converted to the user's display unit (the gauge renders it rounded to whole
 * units, web `Math.round`); [max] and [unit] reproduce the web props; [accent] selects the arc color.
 */
data class HeroGauge(
    val key: String,
    val value: Double,
    val max: Double,
    val unit: String,
    val accent: HeroAccent,
)

/** One stat-grid cell — the native mirror of a web `buildStatCards` item (`{ icon, label, value, color }`). */
data class HeroStat(
    val key: String,
    val label: String,
    val value: String,
    val accent: HeroAccent,
    val glyph: HeroGlyph,
)

/**
 * The charging banner's three figures (web shows them only when `is_charging`): the [powerText] (web
 * `fmtNumber(charger_power) kW`), the [rateText] (web `fmtInt(toDistance(charge_rate)) unit/h`), the
 * [timeToFullText] (web `time_to_full_charge > 0 ? "{h}h" : "\u2014"`), and the optional [doneAtText] (web
 * `Done ~{formatTime(now + h)}`), `null` when the charge has no finite estimate.
 */
data class HeroChargingDetails(
    val powerText: String,
    val rateText: String,
    val timeToFullText: String,
    val doneAtText: String?,
)

/**
 * The fully projected, render-ready view of a vehicle — the native analogue of everything the web component
 * computes before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI
 * host. [charging] / [gauges] / [stats] are empty/null when the vehicle is asleep (`state == null`), in which
 * case the composable renders the wake card; the header ([name] / [subtitle] / [status]) renders regardless.
 */
data class VehicleHeroDisplay(
    val name: String,
    val subtitle: String,
    val status: String,
    val asleep: Boolean,
    val gauges: List<HeroGauge>,
    val charging: HeroChargingDetails?,
    val stats: List<HeroStat>,
    val accessibleSummary: String,
)

/**
 * The already-localized microcopy the surface folds into its output — every `t(...)` key the web component
 * resolves, plus the few stat-card labels the web renders as literals (re-localized here from the existing
 * catalog so no English literal reaches native code). The lifecycle chrome (loading / empty / error / retry /
 * offline / freshness) is resolved inline at the Compose boundary, so this holder stays a thin content carrier.
 */
data class VehicleHeroStrings(
    val battery: String,
    val range: String,
    val speed: String,
    val power: String,
    val inside: String,
    val outside: String,
    val charging: String,
    val chargePower: String,
    val rate: String,
    val timeToFull: String,
    val doneAt: String,
    val odometer: String,
    val idealRange: String,
    val chargeRate: String,
    val firmware: String,
    val status: String,
    val locked: String,
    val unlocked: String,
    val sentry: String,
    val active: String,
    val off: String,
    val details: String,
    val commands: String,
    val liveMap: String,
    val digitalTwin: String,
)

/** Resolves the rendered name — web `vehicle.display_name || vehicle.vin`. */
internal fun heroName(vehicle: Vehicle): String = vehicle.displayName.ifBlank { vehicle.vin }

/** Resolves the model/trim/vin subtitle — web `{model} {trim_badging} \u00B7 {vin}`. */
internal fun heroSubtitle(vehicle: Vehicle): String {
    val modelTrim =
        listOf(vehicle.model?.trim().orEmpty(), vehicle.trimLevel?.trim().orEmpty())
            .filter { it.isNotEmpty() }
            .joinToString(" ")
    return if (modelTrim.isEmpty()) vehicle.vin else "$modelTrim \u00B7 ${vehicle.vin}"
}

/** Resolves the status string — web `state?.state ?? 'offline'`. */
internal fun heroStatus(state: VehicleState?): String = state?.state ?: HERO_OFFLINE

/** True when the stat grid uses the driving layout — web `s.state === 'driving' || s.speed > 0`. */
internal fun heroIsDriving(state: VehicleState): Boolean = state.state == "driving" || state.speed > 0.0

/** The signed-power accent — web amber when discharging, emerald when regenerating, muted at rest. */
internal fun heroPowerAccent(powerKilowatts: Double): HeroAccent =
    when {
        powerKilowatts > 0.0 -> HeroAccent.Amber
        powerKilowatts < 0.0 -> HeroAccent.Green
        else -> HeroAccent.Neutral
    }

/**
 * Locale-stable `fmtNumber(value, decimals)` — the web grouped/fixed-digit number contract. Delegates to the
 * shared [ChartFormat.number] the sibling surfaces use so grouping + half-expand rounding match the web.
 */
internal fun fmtNumber(
    value: Double,
    decimals: Int,
    locale: Locale,
): String = ChartFormat.number(value, decimals, locale)

/**
 * The pure projection the composable renders — the native mirror of the web component's derivations. Stateless
 * and side-effect-free so it is fully covered by the off-device unit gate. The SI->display conversion uses the
 * injected [UnitFormatter] (the web `useUnits` boundary): distance/speed/temperature through the shared
 * `convert*FromSI`, formatted via the shared, golden-tested [ChartFormat]; charger-power and drivetrain power
 * are kW on the wire (the API field unit, mirrored from the sibling VehicleHeroCard) so they format as-is.
 */
object VehicleHeroProjection {
    /**
     * Projects [vehicle] + (nullable) [state] for the live [formatter] into the render-ready
     * [VehicleHeroDisplay]. A `null` [state] yields the asleep header-only display (web `state ? … :
     * <asleep/>`). [nowMillis] + [formatClockTime] back the charge "done at" estimate (web `Date.now()` +
     * `formatTime`); [locale] formats the numeric values (web `Intl.NumberFormat`).
     */
    @Suppress("LongParameterList")
    fun project(
        vehicle: Vehicle,
        state: VehicleState?,
        firmwareVersion: String,
        formatter: UnitFormatter,
        strings: VehicleHeroStrings,
        nowMillis: Long,
        locale: Locale,
        formatClockTime: (Long) -> String,
    ): VehicleHeroDisplay {
        val name = heroName(vehicle)
        val subtitle = heroSubtitle(vehicle)
        val status = heroStatus(state)
        if (state == null) {
            return VehicleHeroDisplay(
                name = name,
                subtitle = subtitle,
                status = status,
                asleep = true,
                gauges = emptyList(),
                charging = null,
                stats = emptyList(),
                accessibleSummary = listOf(name, status).joinToString(SEPARATOR),
            )
        }
        val ctx = StatContext(state, formatter, strings, locale)
        val gauges = buildGauges(state, formatter)
        val charging = if (state.isCharging) buildCharging(ctx, nowMillis, formatClockTime) else null
        val stats = buildStatCards(ctx, firmwareVersion)
        return VehicleHeroDisplay(
            name = name,
            subtitle = subtitle,
            status = status,
            asleep = false,
            gauges = gauges,
            charging = charging,
            stats = stats,
            accessibleSummary = buildAccessibleSummary(name, status, gauges, charging, strings),
        )
    }

    /** Context-aware gauges — battery + range + (driving?) speed + (charging?) power + inside + outside. */
    private fun buildGauges(
        state: VehicleState,
        formatter: UnitFormatter,
    ): List<HeroGauge> {
        val p = formatter.prefs
        val tempMax = if (p.temperature == TemperatureUnitPref.FAHRENHEIT) HERO_TEMP_MAX_F else HERO_TEMP_MAX_C
        val batteryAccent = if (state.batteryLevel > HERO_BATTERY_HIGH_THRESHOLD) HeroAccent.Green else HeroAccent.Amber
        return buildList {
            add(HeroGauge("battery", state.batteryLevel * 1.0, HERO_BATTERY_MAX, HERO_PERCENT, batteryAccent))
            add(HeroGauge("range", convertDistanceFromSI(state.ratedRange, p.distance), HERO_RANGE_MAX, p.distance.label, HeroAccent.Cyan))
            if (heroIsDriving(state)) {
                add(HeroGauge("speed", convertSpeedFromSI(state.speed, p.speed), HERO_SPEED_MAX, p.speed.label, HeroAccent.Purple))
            }
            if (state.isCharging) {
                add(HeroGauge("chargePower", state.chargerPower, HERO_POWER_MAX, HERO_KW, HeroAccent.Green))
            }
            add(HeroGauge("inside", convertTempFromSI(state.insideTemp, p.temperature), tempMax, p.temperature.label, HeroAccent.Amber))
            add(HeroGauge("outside", convertTempFromSI(state.outsideTemp, p.temperature), tempMax, p.temperature.label, HeroAccent.Blue))
        }
    }

    /** Bundles the inputs every stat layout needs, keeping each layout helper a small, focused function. */
    private data class StatContext(
        val state: VehicleState,
        val formatter: UnitFormatter,
        val strings: VehicleHeroStrings,
        val locale: Locale,
    ) {
        val prefs get() = formatter.prefs
    }

    /** A whole-unit distance string in the user's unit (web `fmtInt(toDistance(...)) unit`). */
    private fun distanceWhole(
        ctx: StatContext,
        meters: Double,
    ): String =
        "${fmtNumber(convertDistanceFromSI(meters, ctx.prefs.distance), HERO_WHOLE_DECIMALS, ctx.locale)} ${ctx.prefs.distance.label}"

    /** A whole-unit speed string in the user's unit (web `fmtNumber(toSpeed(speed), 0) unit`). */
    private fun speedWhole(ctx: StatContext): String =
        "${fmtNumber(convertSpeedFromSI(ctx.state.speed, ctx.prefs.speed), HERO_WHOLE_DECIMALS, ctx.locale)} ${ctx.prefs.speed.label}"

    /** A one-decimal temperature string in the user's unit (web `fmtNumber(toTemp(c), 1)unit`). */
    private fun tempText(
        ctx: StatContext,
        celsius: Double,
    ): String =
        "${fmtNumber(convertTempFromSI(celsius, ctx.prefs.temperature), HERO_TEMP_DECIMALS, ctx.locale)}${ctx.prefs.temperature.label}"

    /** The charging banner figures (web charging detail block). */
    private fun buildCharging(
        ctx: StatContext,
        nowMillis: Long,
        formatClockTime: (Long) -> String,
    ): HeroChargingDetails {
        val state = ctx.state
        val rate = convertDistanceFromSI(state.chargeRate, ctx.prefs.distance)
        val hasEstimate = state.timeToFullCharge > 0.0
        return HeroChargingDetails(
            powerText = "${fmtNumber(state.chargerPower, defaultDecimals(ctx.formatter), ctx.locale)} $HERO_KW",
            rateText = "${fmtNumber(rate, HERO_WHOLE_DECIMALS, ctx.locale)} ${ctx.prefs.distance.label}$HERO_PER_HOUR",
            timeToFullText =
                if (hasEstimate) {
                    "${fmtNumber(state.timeToFullCharge, HERO_HOURS_DECIMALS, ctx.locale)}h"
                } else {
                    HERO_EM_DASH
                },
            doneAtText =
                if (hasEstimate) {
                    val doneMillis = nowMillis + (state.timeToFullCharge * HERO_MILLIS_PER_HOUR).toLong()
                    "${ctx.strings.doneAt} ~${formatClockTime(doneMillis)}"
                } else {
                    null
                },
        )
    }

    /** The context stat grid (driving / charging / idle) plus the always-visible cards (web `buildStatCards`). */
    private fun buildStatCards(
        ctx: StatContext,
        firmwareVersion: String,
    ): List<HeroStat> {
        val odometer = odometerStat(ctx)
        val idealRange = idealRangeStat(ctx)
        val context =
            when {
                heroIsDriving(ctx.state) -> drivingStats(ctx, odometer, idealRange)
                ctx.state.isCharging -> chargingStats(ctx, odometer, idealRange)
                else -> idleStats(ctx, odometer, idealRange)
            }
        return context + alwaysVisibleStats(ctx, firmwareVersion)
    }

    /** The odometer card (web `Navigation` accent), shown in every layout. */
    private fun odometerStat(ctx: StatContext): HeroStat =
        HeroStat("odometer", ctx.strings.odometer, distanceWhole(ctx, ctx.state.odometer), HeroAccent.Purple, HeroGlyph.Navigation)

    /** The ideal-range card (web `Activity` accent), shown in every layout. */
    private fun idealRangeStat(ctx: StatContext): HeroStat =
        HeroStat("idealRange", ctx.strings.idealRange, distanceWhole(ctx, ctx.state.idealRange), HeroAccent.Cyan, HeroGlyph.Activity)

    private fun drivingStats(
        ctx: StatContext,
        odometer: HeroStat,
        idealRange: HeroStat,
    ): List<HeroStat> =
        listOf(
            HeroStat("stat-speed", ctx.strings.speed, speedWhole(ctx), HeroAccent.Purple, HeroGlyph.Gauge),
            powerStat(ctx.state, ctx.locale),
            odometer,
            idealRange,
        )

    private fun chargingStats(
        ctx: StatContext,
        odometer: HeroStat,
        idealRange: HeroStat,
    ): List<HeroStat> {
        val rate = convertDistanceFromSI(ctx.state.chargeRate, ctx.prefs.distance)
        return listOf(
            HeroStat(
                key = "stat-chargeRate",
                label = ctx.strings.chargeRate,
                value = "${fmtNumber(rate, HERO_WHOLE_DECIMALS, ctx.locale)} ${ctx.prefs.distance.label}$HERO_PER_HOUR",
                accent = HeroAccent.Green,
                glyph = HeroGlyph.Bolt,
            ),
            HeroStat(
                key = "stat-timeToFull",
                label = ctx.strings.timeToFull,
                value =
                    if (ctx.state.timeToFullCharge > 0.0) {
                        "${fmtNumber(ctx.state.timeToFullCharge, HERO_HOURS_DECIMALS, ctx.locale)}h"
                    } else {
                        HERO_EM_DASH
                    },
                accent = HeroAccent.Amber,
                glyph = HeroGlyph.Clock,
            ),
            idealRange,
            odometer,
        )
    }

    private fun idleStats(
        ctx: StatContext,
        odometer: HeroStat,
        idealRange: HeroStat,
    ): List<HeroStat> =
        listOf(
            HeroStat(
                key = "stat-inside",
                label = ctx.strings.inside,
                value = tempStatValue(ctx, ctx.state.insideTemp),
                accent = HeroAccent.Amber,
                glyph = HeroGlyph.Thermometer,
            ),
            HeroStat(
                key = "stat-outside",
                label = ctx.strings.outside,
                value = tempStatValue(ctx, ctx.state.outsideTemp),
                accent = HeroAccent.Blue,
                glyph = HeroGlyph.Thermometer,
            ),
            odometer,
            idealRange,
        )

    private fun alwaysVisibleStats(
        ctx: StatContext,
        firmwareVersion: String,
    ): List<HeroStat> =
        listOf(
            HeroStat(
                key = "stat-status",
                label = ctx.strings.status,
                value = if (ctx.state.isLocked) ctx.strings.locked else ctx.strings.unlocked,
                accent = if (ctx.state.isLocked) HeroAccent.Green else HeroAccent.Amber,
                glyph = if (ctx.state.isLocked) HeroGlyph.Lock else HeroGlyph.Unlock,
            ),
            HeroStat(
                key = "stat-sentry",
                label = ctx.strings.sentry,
                value = if (ctx.state.sentryMode) ctx.strings.active else ctx.strings.off,
                accent = if (ctx.state.sentryMode) HeroAccent.Red else HeroAccent.Neutral,
                glyph = HeroGlyph.Shield,
            ),
            HeroStat(
                key = "stat-firmware",
                label = ctx.strings.firmware,
                value = firmwareVersion,
                accent = HeroAccent.Primary,
                glyph = HeroGlyph.Gauge,
            ),
            powerStat(ctx.state, ctx.locale),
        )

    /** A temperature stat value (web idle layout); non-finite readings render the em dash. */
    private fun tempStatValue(
        ctx: StatContext,
        celsius: Double,
    ): String = if (celsius.isFinite()) tempText(ctx, celsius) else HERO_EM_DASH

    /** The signed drivetrain-power card, shared by the driving + always-visible layouts (web `s.power kW`). */
    private fun powerStat(
        state: VehicleState,
        locale: Locale,
    ): HeroStat =
        HeroStat(
            key = "stat-power",
            label = HERO_POWER_LABEL_SENTINEL,
            value = "${fmtNumber(state.power, HERO_DEFAULT_DECIMALS, locale)} $HERO_KW",
            accent = heroPowerAccent(state.power),
            glyph = HeroGlyph.Bolt,
        )

    /** The hero's spoken summary (web equivalent of the visible name/status/battery/charging cues). */
    private fun buildAccessibleSummary(
        name: String,
        status: String,
        gauges: List<HeroGauge>,
        charging: HeroChargingDetails?,
        strings: VehicleHeroStrings,
    ): String =
        buildList {
            add(name)
            add(status)
            gauges.firstOrNull { it.key == "battery" }?.let {
                add("${strings.battery} ${ChartFormat.number(it.value, HERO_WHOLE_DECIMALS, Locale.US)}$HERO_PERCENT")
            }
            if (charging != null) add(strings.charging)
        }.joinToString(SEPARATOR)

    /** The web `fmtNumber` default precision (its global precision) resolved from the user's settings. */
    private fun defaultDecimals(formatter: UnitFormatter): Int = formatter.prefs.precision ?: HERO_DEFAULT_DECIMALS

    private const val SEPARATOR = ", "
}

/** The mutually-exclusive surface drawn for a given [UiState] phase (web empty/content + the added chrome). */
enum class VehicleHeroSurface { Loading, Error, Empty, Content }

/**
 * Maps a [UiState] onto the surface to render. Stale/offline cached data stays [VehicleHeroSurface.Content]
 * (plus a freshness chip), never a blanked surface — the honest "last known" contract the sibling surfaces
 * follow.
 */
fun vehicleHeroSurface(state: UiState<*>): VehicleHeroSurface =
    when (state.phase) {
        UiPhase.Loading -> VehicleHeroSurface.Loading
        UiPhase.Error -> VehicleHeroSurface.Error
        UiPhase.Empty -> VehicleHeroSurface.Empty
        UiPhase.Content -> VehicleHeroSurface.Content
    }

/**
 * Builds the cache-then-network [UiState] for the web-parity entry that takes the loaded [data] + the
 * WidgetShell flags (web `VehicleHeroWidget`: `loading={!vehicle}`, `isFetching`, `isStale`, `isError`,
 * `updatedAt`). With no vehicle a first load is [UiPhase.Loading], a hard failure is [UiPhase.Error], and a
 * resolved-but-empty payload is [UiPhase.Empty]; with a vehicle the hero stays [UiPhase.Content], carrying the
 * refreshing / stale / error freshness so cached data is shown as honest "last known" rather than blanked.
 */
fun vehicleHeroStateOf(
    data: VehicleHeroData?,
    loading: Boolean,
    isStale: Boolean = false,
    isError: Boolean = false,
    fetchedAt: Long? = null,
): UiState<VehicleHeroData> {
    val vehicle = data?.vehicle
    val resolvedError = if (isError) ErrorKind.Unknown else null
    return when {
        vehicle == null && isError ->
            UiState(phase = UiPhase.Error, fetchedAt = fetchedAt, stale = isStale, errorKind = resolvedError)
        vehicle == null && loading -> UiState(phase = UiPhase.Loading)
        vehicle == null -> UiState(phase = UiPhase.Empty, data = data)
        else ->
            UiState(
                phase = UiPhase.Content,
                data = data,
                fetchedAt = fetchedAt,
                stale = isStale || isError,
                refreshing = loading,
                errorKind = resolvedError,
            )
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [VehicleHeroRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect. Carries no battery / range / location payload, so a diagnostics line can never
 * leak the vehicle's state.
 */
fun recordVehicleHeroOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf("surface" to VehicleHeroRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
