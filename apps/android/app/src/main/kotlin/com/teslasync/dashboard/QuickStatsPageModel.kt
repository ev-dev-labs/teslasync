// Pure, framework-free model + projections for the QuickStatsPage dashboard surface — the native analogue of
// everything the web page derives before composing its card (web/src/features/dashboard/pages/QuickStatsPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only references the framework-free
// UiState projection, the shared-core Resource/units, and the generated Vehicle/VehicleState models), so the
// composable stays a thin render layer and all of this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the merge of the `useVehicles` + `useAnalyticsSummary`
// reads into the single loading/empty/error/success surface the page renders (web `isLoading = vehiclesLoading ||
// analyticsLoading`, `error = vehiclesError || analyticsError`, `vehicle = vehicles?.[0]`); (2) the decode of the
// raw `/analytics/fleet` SI JSON envelope into a typed [QuickStatsSummary] (web optional-chaining `?? 0`); (3) the
// display-boundary unit + currency derivation from the `/settings` document ([QuickStatsDisplayPrefs], web
// `useUnits`/`useFormatting`); and (4) the `useVehicleState` subtitle label (web `stateData?.state?.state ?? 'offline'`).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): the fleet summary reports distance in SI kilometres (per
// the web page's own `* 1000` bridge + internal/api/analytics/queries.go `total_distance_km`), so it is floored to
// the SI base (metres) before conversion via the shared [convertDistanceFromSI] — exactly as the web does. Energy
// (kWh), cost and counts are raw on the wire and rendered verbatim, mirroring the web.
//
// Empty-state divergence (Honesty Covenant #9 — documented, not silent): the web shows the noVehicle EmptyState
// inside the vehicle GlassPanel when `vehicles?.[0]` is absent, while still rendering the four metric cards from the
// (independent, fleet-wide) analytics feed. The native surface mirrors this exactly: a no-vehicle merged payload
// routes to UiPhase.Empty (via [QuickStats.hasVehicle]) so the vehicle panel shows its friendly empty-state, and the
// metric grid still renders its (possibly zero) totals in both the Empty and Content phases.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling analytics/admin pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.dashboard.quickstats

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/** The default fiat symbol — the web `useFormatting` fallback when `settings.currency_symbol` is blank/absent. */
private const val DEFAULT_CURRENCY_SYMBOL = "$"

/** Default currency / number fraction digits (web `useFormatting` `decimal_precision ?? 2`). */
private const val DEFAULT_PRECISION = 2

/** 1 km = 1000 m — the SI bridge the fleet distance floors on before conversion (web `* 1000`). */
private const val METERS_PER_KM = 1000.0

/**
 * The vehicle state shown when no `/vehicles/{id}/state` reading is available — the web `?? 'offline'` data fallback
 * for `stateData?.state?.state`. It is a raw Tesla vehicle-state value (online / offline / asleep), not a UI string:
 * the backend serves these verbatim and the web hard-codes the same literal fallback, so it is deliberately NOT one
 * of the nine i18n keys this surface localizes.
 */
const val DEFAULT_VEHICLE_STATE: String = "offline"

/** The dashboard deep-link the footer "Open Dashboard" link opens (web `<Link to="/">`). Resolves to `dashboard`. */
const val DASHBOARD_DEEP_LINK: String = "teslasync://app/"

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `QuickStatsPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `standalone("quickStats", "/quick-stats", …)`, so the host binds this surface to that destination (and its
 * `/quick-stats` deep link) without the nav module depending on it.
 */
object QuickStatsPageRegistration {
    /** The navigation destination id (Destinations.kt `standalone("quickStats", "/quick-stats", …)`). */
    const val ROUTE_ID: String = "quickStats"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/quick-stats"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "QuickStatsPage"
}

/**
 * The first enrolled vehicle the card describes — the native mirror of the web `vehicles?.[0]` read. [displayName]
 * is raw off the wire (blank → the `quickStats.defaultName` "Tesla" fallback is applied at the render boundary), and
 * [model] is the nullable Tesla model line (web `vehicle.model`).
 */
data class QuickVehicle(
    val displayName: String,
    val model: String?,
)

/**
 * The decoded `/analytics/fleet?days=30` summary the four metric cards read (web `AnalyticsSummary`).
 * [totalDistanceKm] is SI kilometres (converted at the render boundary); [totalDrives], [totalEnergyKwh] (kWh) and
 * [totalCost] are raw on the wire. Missing / JSON-null fields collapse to zero, exactly like the web `?? 0`.
 */
data class QuickStatsSummary(
    val totalDistanceKm: Double,
    val totalDrives: Double,
    val totalEnergyKwh: Double,
    val totalCost: Double,
) {
    companion object {
        /** The all-zero snapshot, surfaced for a null / non-object analytics payload. */
        val EMPTY: QuickStatsSummary = QuickStatsSummary(0.0, 0.0, 0.0, 0.0)
    }
}

/**
 * The merged page state the loaded body renders: the optional first [vehicle] (web `vehicles?.[0]`) and the
 * fleet-wide [summary] (web `useAnalyticsSummary`). The vehicle and the summary are independent reads — the metric
 * cards render from [summary] regardless of whether a vehicle exists — so [hasVehicle] only gates which face the
 * vehicle panel shows (the card vs the noVehicle empty-state), never the metric grid.
 */
data class QuickStats(
    val vehicle: QuickVehicle?,
    val summary: QuickStatsSummary,
) {
    /** Whether a first vehicle is present; an absent vehicle routes the merged state to UiPhase.Empty (web noVehicle). */
    val hasVehicle: Boolean get() = vehicle != null

    companion object {
        /** The no-vehicle / all-zero snapshot used as the content fallback. */
        val EMPTY: QuickStats = QuickStats(vehicle = null, summary = QuickStatsSummary.EMPTY)
    }
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` + `useFormatting` reads
 * from the `/settings` document: the [distanceUnit] (the "{unit} Driven" label + the distance figure), the
 * [currencySymbol] (blank → "$"), the currency/number [precision] (web `decimal_precision`, floored & non-negative,
 * else 2), and the [locale] used for grouped-number formatting.
 */
data class QuickStatsDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    /** The distance unit's display label (e.g. "km" / "mi") — the web `unitPrefs.distance` interpolated into the label. */
    val distanceLabel: String get() = distanceUnit.label

    /** SI km → the user's display distance (web `convertDistanceFromSI(km * 1000, unit)`). */
    fun fromKm(km: Double): Double = convertDistanceFromSI(km * METERS_PER_KM, distanceUnit)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    /**
     * Currency as the web `formatCurrency` renders it — the user's [currencySymbol] (blank → "$") followed by a
     * [decimals]-digit grouped number in the user's locale. The cost card passes 0 decimals (web `formatCurrency(…, 0)`).
     */
    fun currency(
        amount: Double,
        decimals: Int,
    ): String = currencySymbol.ifBlank { DEFAULT_CURRENCY_SYMBOL } + ChartFormat.number(amount, decimals.coerceAtLeast(0), locale)

    companion object {
        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Metric + `$` + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: QuickStatsDisplayPrefs =
            QuickStatsDisplayPrefs(
                distanceUnit = DistanceUnitPref.KM,
                currencySymbol = DEFAULT_CURRENCY_SYMBOL,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`/`useFormatting`). */
        fun fromSettings(settings: JsonElement?): QuickStatsDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject)?.stringField(KEY_CURRENCY_SYMBOL)?.trim()
            return QuickStatsDisplayPrefs(
                distanceUnit = unit.distance,
                currencySymbol = if (!rawSymbol.isNullOrEmpty()) rawSymbol else DEFAULT_CURRENCY_SYMBOL,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
            )
        }
    }
}

/** Projects the generated [Vehicle] onto the card DTO (web `vehicles?.[0]` → `{ display_name, model }`). */
fun toQuickVehicle(vehicle: Vehicle): QuickVehicle = QuickVehicle(displayName = vehicle.displayName, model = vehicle.model)

/**
 * Decodes the raw `/analytics/fleet?days=30` [json] (SI, snake_case on the wire) into a [QuickStatsSummary]. A
 * non-object input, a missing field, or a JSON-null field all collapse to zero — reproducing the web `?? 0`. Each
 * field is read by both its snake_case wire name and its camelCase alias so the surface is robust to either shape
 * (mirroring the sibling AnalyticsSummaryWidget's dual read).
 */
fun parseQuickStatsSummary(json: JsonElement?): QuickStatsSummary {
    val obj = json as? JsonObject ?: return QuickStatsSummary.EMPTY
    return QuickStatsSummary(
        totalDistanceKm = obj.number("total_distance_km", "totalDistanceKm"),
        totalDrives = obj.number("total_drives", "totalDrives"),
        totalEnergyKwh = obj.number("total_energy_kwh", "totalEnergyKwh"),
        totalCost = obj.number("total_cost", "totalCost"),
    )
}

/**
 * The subtitle vehicle-state label (web `stateData?.state?.state ?? 'offline'`). A null / blank reading collapses to
 * [DEFAULT_VEHICLE_STATE], so the card always shows a state line. The value is a raw Tesla vehicle-state, rendered
 * verbatim like the web (not localized).
 */
fun vehicleStateLabelOf(envelope: VehicleStateEnvelope?): String =
    envelope?.state?.state?.takeIf { it.isNotBlank() } ?: DEFAULT_VEHICLE_STATE

/**
 * Merges the cache-then-network `useVehicles` + `useAnalyticsSummary` reads into the single lifecycle-aware
 * [UiState] the page renders — the native analogue of the web page's combined gating
 * (`isLoading = vehiclesLoading || analyticsLoading`, `error = vehiclesError || analyticsError`,
 * `vehicle = vehicles?.[0]`).
 *
 * Both reads are first projected onto their own [UiState] (reusing the shared ADR-013 mapping so the cached/stale/
 * offline tiers are folded honestly), then merged:
 *  - either still first-loading (no cache) → [UiPhase.Loading] (web spinner);
 *  - either a hard error (no cache) → [UiPhase.Error] carrying the first error kind (web error panel + retry);
 *  - otherwise → the merged [QuickStats], with [UiPhase.Empty] when no first vehicle exists (web noVehicle inside the
 *    vehicle panel; the metric grid still renders) and [UiPhase.Content] otherwise. The freshness stamp / stale /
 *    refreshing / error flags are folded across both reads so a degraded tier still surfaces.
 *
 * Pure (no Compose/coroutines), so every state transition is unit-testable off-device.
 */
fun mergeQuickStats(
    vehicles: Resource<List<Vehicle>>,
    analytics: Resource<JsonElement>,
): UiState<QuickStats> {
    val vehiclesUi = vehicles.toUiState { false }
    val analyticsUi = analytics.toUiState { false }

    if (vehiclesUi.isLoading || analyticsUi.isLoading) return UiState.loading()

    if (vehiclesUi.isError || analyticsUi.isError) {
        val errored = if (vehiclesUi.isError) vehiclesUi else analyticsUi
        return UiState(
            phase = UiPhase.Error,
            fetchedAt = errored.fetchedAt,
            stale = errored.stale,
            errorKind = errored.errorKind,
            httpStatus = errored.httpStatus,
        )
    }

    val vehicle = vehiclesUi.data?.firstOrNull()?.let(::toQuickVehicle)
    val stats = QuickStats(vehicle = vehicle, summary = parseQuickStatsSummary(analyticsUi.data))
    return UiState(
        phase = if (vehicle == null) UiPhase.Empty else UiPhase.Content,
        data = stats,
        fetchedAt = maxOfNullable(vehiclesUi.fetchedAt, analyticsUi.fetchedAt),
        stale = vehiclesUi.stale || analyticsUi.stale,
        refreshing = vehiclesUi.refreshing || analyticsUi.refreshing,
        errorKind = vehiclesUi.errorKind ?: analyticsUi.errorKind,
    )
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [QuickStatsPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no vehicle id, distance or cost payload.
 */
fun recordQuickStatsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to QuickStatsPageRegistration.SLUG))
}

/** Reads the first present numeric field among [keys] (snake_case wire name + camelCase alias), else 0.0. */
private fun JsonObject.number(vararg keys: String): Double {
    for (key in keys) {
        val value = (this[key] as? JsonPrimitive)?.doubleOrNull
        if (value != null) return value
    }
    return 0.0
}

/** The string content of [key], or null when absent / not a primitive (web optional-chaining). */
private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/** The larger of two nullable epoch stamps (null is treated as "no stamp"), for folding the merged freshness. */
private fun maxOfNullable(
    a: Long?,
    b: Long?,
): Long? =
    when {
        a == null -> b
        b == null -> a
        else -> maxOf(a, b)
    }
