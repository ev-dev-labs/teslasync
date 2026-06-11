// Pure, framework-free model + projection for the Odometer Counter dashboard widget — the native
// analogue of the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/OdometerCounterWidget.tsx). No Compose, no Android framework, no
// HTTP: every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The odometer arrives as SI metres (VehicleState.odometer) and is
// converted to the user's display unit here, at the single render-boundary seam (Phase-48 SI-canonical
// rule; web `convertDistanceFromSI` + `useUnits`).
//
// PARITY NOTE — the "Total Driven" field. The web component reads `stats.totalDistanceKm` (the
// `GET /drives/stats` document, camelCaseKeys of the wire field `total_distance_km`) and passes it
// VERBATIM through `convertDistanceFromSI`, exactly like the odometer. The native layer is served the raw
// snake_case document (no camelCaseKeys transform), so this reads `total_distance_km` and applies the same
// converter. The wire field name is a legacy-compatibility misnomer (the Go `/drives/stats` handler emits
// `SUM(distance_m)` already scaled to miles under the `total_distance_km` key — an R2-style identifier
// paradox), but reproducing the web's exact transform is the binding mandate (the web source is THE
// specification): this surface mirrors the web's data derivation rather than silently "correcting" the
// upstream unit semantics, which would be drift from the spec.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/OdometerCounterWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling ChargeStatus/DrivetrainHealth
// widgets do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.odometercounter

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** Em dash shown for a missing "Total Driven" reading — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Odometer + "Total Driven" distances render as whole display units (web `<AnimatedNumber decimals={0}>`
 * for the odometer and `fmtNumber(totalDriven, 0)` for the breakdown metric).
 */
private const val DISTANCE_DECIMALS: Int = 0

/**
 * The raw `GET /drives/stats` field the web widget reads as `stats.totalDistanceKm`. The web client's
 * `camelCaseKeys()` exposes both `total_distance_km` and `totalDistanceKm`; the native shared layer serves
 * the document verbatim, so the snake_case key is the one on the wire (see the PARITY NOTE above).
 */
private const val FIELD_TOTAL_DISTANCE_KM: String = "total_distance_km"

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * `OdometerCounterWidget` reads `size.cols`/`size.rows` to choose the compact (number-only) vs expanded vs
 * wide (expanded + breakdown grid) layout, so this type carries the same axes the registry constrains.
 */
data class OdometerCounterSize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/vehicle.ts (`odometer-counter`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object OdometerCounterRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "odometer-counter"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "OdometerCounterWidget"

    /** Default footprint: 1 column × 2 rows (web `defaultSize`). */
    val defaultSize: OdometerCounterSize = OdometerCounterSize(cols = 1, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize: OdometerCounterSize = OdometerCounterSize(cols = 1, rows = 2)

    /** Maximum footprint: 2 columns × 40 rows (web `maxSize`). */
    val maxSize: OdometerCounterSize = OdometerCounterSize(cols = 2, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: OdometerCounterSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: OdometerCounterSize): OdometerCounterSize =
        OdometerCounterSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )

    /** True when [size] selects the compact (number-only, no title/breakdown) layout — web `size.cols === 1 && size.rows === 1`. */
    fun isCompact(size: OdometerCounterSize): Boolean = size.cols == 1 && size.rows == 1

    /** True when [size] shows the breakdown metric grid — web `size.cols >= 2`. */
    fun isWide(size: OdometerCounterSize): Boolean = size.cols >= 2
}

/**
 * Localized labels the surface folds into its output (web `t('widget.odometer.*')` calls). The composable
 * builds this from `stringResource`; tests pass a deterministic instance. Keeping i18n out of the
 * projection lets the projection stay a pure, locale-stable function.
 */
data class OdometerCounterStrings(
    val title: String,
    val noData: String,
    val total: String,
    val totalDriven: String,
    val unit: String,
)

/**
 * The two raw values the widget composes, decoded to the minimum it renders. [odometerMeters] is the SI
 * odometer reading (web `stateData?.state?.odometer`); `null` means no decodable vehicle state, which is
 * the web's `convertedOdometer != null ? … : <EmptyState/>` gate. [totalDistanceKm] is the raw
 * `total_distance_km` figure from `GET /drives/stats` (web `stats?.totalDistanceKm`); `null` when the stats
 * feed produced no usable document, rendering the breakdown's em-dash fallback.
 */
data class OdometerSnapshot(
    val odometerMeters: Double?,
    val totalDistanceKm: Double?,
)

/**
 * The fully projected, render-ready view of the odometer — the native analogue of everything the web
 * component computes before returning JSX. Pure data (no Compose types) so every branch is unit-tested
 * directly.
 *
 * @property odometerValue the odometer converted to the user's display distance unit — the value the
 *   rolling [io.teslasync.android.components.datadisplay.AnimatedNumber] animates to (web
 *   `convertedOdometer`).
 * @property odometerText the settled odometer figure as a whole-number string (web `fmtNumber(odometer,
 *   0)`), used for the deterministic TalkBack phrase that does not depend on the animation frame.
 * @property unit the distance unit label suffix (web `unitPrefs.distance`, e.g. `km`/`mi`/`ft`).
 * @property totalDrivenText the breakdown "Total Driven" value already formatted with its unit (web
 *   `${fmtNumber(totalDriven, 0)} ${unit}`), or [EM_DASH] when the stats feed produced no figure.
 */
data class OdometerCounterDisplay(
    val odometerValue: Double,
    val odometerText: String,
    val unit: String,
    val totalDrivenText: String,
)

/**
 * Pure projection + state-fold for the Odometer Counter surface — the native port of the inline data
 * derivation in `OdometerCounterWidget.tsx`. [project] turns a decoded [OdometerSnapshot] into the
 * render-ready [OdometerCounterDisplay]; [foldState] composes the two cache-then-network feeds the web
 * component reads (`useVehicleState` + `useDrivingStats`) onto the shared [UiState] surface.
 */
object OdometerCounterProjection {
    /**
     * Project [snapshot] into the render model using the user's [prefs] (distance unit + precision). SI
     * distances are converted at this boundary via [convertDistanceFromSI], reproducing the web
     * `toDistanceDisplay = convertDistanceFromSI(value, unitPrefs.distance)` for BOTH the odometer and the
     * "Total Driven" breakdown (see this file's PARITY NOTE). Numbers reproduce the web `fmtNumber` en-US
     * display contract (grouped thousands, half-expand rounding) so the output matches the web truth.
     */
    fun project(
        snapshot: OdometerSnapshot,
        prefs: UnitPref,
    ): OdometerCounterDisplay {
        val unit = prefs.distance.label
        val odometerValue = snapshot.odometerMeters?.let { convertDistanceFromSI(it, prefs.distance) } ?: 0.0
        val totalDriven = snapshot.totalDistanceKm?.let { convertDistanceFromSI(it, prefs.distance) }
        return OdometerCounterDisplay(
            odometerValue = odometerValue,
            odometerText = formatNumber(odometerValue, DISTANCE_DECIMALS),
            unit = unit,
            totalDrivenText = totalDriven?.let { "${formatNumber(it, DISTANCE_DECIMALS)} $unit" } ?: EM_DASH,
        )
    }

    /**
     * Folds the vehicle-state feed ([stateRes], the odometer source) and the driving-stats feed
     * ([statsRes], the "Total Driven" source) onto one lifecycle-aware [UiState]. Mirrors the web shell
     * precedence: a first load of EITHER query renders the skeleton (web `isLoading = stateLoading ||
     * statsLoading`); a hard vehicle-state failure with nothing cached renders the error surface (web
     * `WidgetShell isError={isError}` is wired to `useVehicleState`); otherwise the content / empty surface
     * is chosen by `convertedOdometer != null` (i.e. a decodable odometer).
     *
     * Vehicle state is the PRIMARY feed (it alone drives the error/stale/refresh chrome, exactly as the web
     * `WidgetShell` only receives the vehicle-state `isFetching`/`isStale`/`isError`/`dataUpdatedAt`); the
     * driving-stats feed is supplementary — it contributes only the "Total Driven" figure and the first-load
     * skeleton, and its failures are intentionally NOT surfaced as the widget's error state (a stats error
     * simply renders the breakdown's em-dash, exactly as the web `stats?.totalDistanceKm ?? null` does).
     *
     * Divergence (non-silent — ADR-013 honest freshness): where the web shell blanks to its error surface on
     * ANY vehicle-state error, this keeps a cached state visible as the stale "offline / last known" content
     * branch (error + cache) and only shows the hard error surface when there is nothing cached to keep — so
     * the surface honours both the spec's mandated `offline` state and its `error` state.
     */
    fun foldState(
        stateRes: Resource<VehicleStateEnvelope>,
        statsRes: Resource<JsonElement>,
    ): UiState<OdometerSnapshot> {
        val odometerMeters = stateRes.cached?.state?.odometer
        val snapshot = OdometerSnapshot(odometerMeters, parseTotalDistanceKm(statsRes.cached))

        val firstLoading =
            (stateRes is Resource.Loading && stateRes.cached == null) ||
                (statsRes is Resource.Loading && statsRes.cached == null)

        // Web shell precedence is loading → error → content (`if (loading) Skeleton; if (error) QueryError`),
        // so a still-loading sibling feed keeps the skeleton even after the state feed has resolved.
        return when {
            firstLoading -> UiState.loading()
            stateRes is Resource.Error && odometerMeters == null -> errorState(stateRes)
            else -> contentState(snapshot, stateRes)
        }
    }

    /** The "no vehicle resolved" surface (web's `id = 0` ⇒ no odometer ⇒ friendly empty state). */
    fun emptyState(): UiState<OdometerSnapshot> =
        UiState(phase = UiPhase.Empty, data = OdometerSnapshot(odometerMeters = null, totalDistanceKm = null))

    /**
     * Locale-stable decimal formatter (web `fmtNumber`): grouped thousands and a fixed number of fraction
     * digits, half-expand rounding. Uses [Locale.US] grouping/decimal symbols so the output is
     * deterministic and matches the web default (en-US) instead of Java's banker's rounding.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
    ): String = groupedFormat(decimals).format(value)

    /** Locale-stable integer formatter (web `fmtInt`). */
    fun formatInt(value: Double): String = groupedFormat(decimals = 0).format(value)

    /** Reads [FIELD_TOTAL_DISTANCE_KM] off the stats document, or `null` when absent / JSON `null` / non-numeric. */
    private fun parseTotalDistanceKm(stats: JsonElement?): Double? {
        val obj = stats?.takeIf { it !is JsonNull } as? JsonObject ?: return null
        return (obj[FIELD_TOTAL_DISTANCE_KM] as? JsonPrimitive)?.doubleOrNull
    }

    private fun errorState(res: Resource.Error<*>): UiState<OdometerSnapshot> =
        UiState(
            phase = UiPhase.Error,
            fetchedAt = res.fetchedAt,
            stale = res.stale,
            errorKind = errorKindOf(res.error),
            httpStatus = httpStatusOf(res.error),
        )

    private fun contentState(
        snapshot: OdometerSnapshot,
        stateRes: Resource<VehicleStateEnvelope>,
    ): UiState<OdometerSnapshot> {
        val stateError = stateRes as? Resource.Error<*>
        return UiState(
            phase = if (snapshot.odometerMeters != null) UiPhase.Content else UiPhase.Empty,
            data = snapshot,
            fetchedAt = fetchedAtOf(stateRes).takeIf { it > 0L },
            stale = stateRes.stale || stateError != null,
            refreshing = stateRes is Resource.Loading,
            errorKind = stateError?.let { errorKindOf(it.error) },
            httpStatus = stateError?.let { httpStatusOf(it.error) },
        )
    }

    private fun fetchedAtOf(res: Resource<*>): Long =
        when (res) {
            is Resource.Loading -> res.fetchedAt ?: 0L
            is Resource.Success -> res.fetchedAt
            is Resource.Error -> res.fetchedAt ?: 0L
        }

    private fun groupedFormat(decimals: Int): DecimalFormat {
        val pattern = if (decimals > 0) "#,##0." + "0".repeat(decimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US)).apply {
            // ECMAScript `Intl.NumberFormat` rounds half away from zero (`halfExpand`); match it so the
            // native output equals the web truth instead of Java's default banker's rounding (HALF_EVEN).
            roundingMode = RoundingMode.HALF_UP
        }
    }
}
