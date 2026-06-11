// Pure, framework-free model + projection for the Drivetrain Health dashboard widget — the native
// analogue of the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/DrivetrainHealthWidget.tsx). No Compose, no Android framework, no
// HTTP: every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. Motor/inverter/stator temperatures arrive as SI degrees Celsius and are
// converted to the user's display unit here, at the single render-boundary seam (Phase-48 SI-canonical
// rule; web `convertTempFromSI` + `useUnits`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/DrivetrainHealthWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling ChargeStatus/ClimateStatus
// widgets do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivetrainhealth

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** Em dash shown for a missing reading — the web `'—'` fallback for an absent temperature / drive state. */
internal const val EM_DASH: String = "\u2014"

// Raw `/drivetrain/health` document keys (snake_case, served verbatim by the Go handler — no camelCaseKeys
// transform in the shared layer, so the native reads match the wire contract, not the web camelCase type).
private const val FIELD_FRONT_MOTOR_TEMP_C = "front_motor_temp_c"
private const val FIELD_REAR_MOTOR_TEMP_C = "rear_motor_temp_c"
private const val FIELD_INVERTER_TEMP_C = "inverter_temp_c"
private const val FIELD_MOTOR_STATUS = "motor_status"
private const val FIELD_OVERALL_HEALTH = "overall_health"

// Raw `/motor/latest` (MotorSnapshot) document keys read by the widget.
private const val FIELD_MOTOR_TEMP_C_FRONT = "motor_temp_c_front"
private const val FIELD_DI_STATOR_TEMP = "di_stator_temp"
private const val FIELD_STATE_FRONT = "state_front"

// Health-score buckets — the web `healthScore(overall)` map (good → 95, warning → 60, critical → 25,
// otherwise 0). Doubles so the radial gauge sweep and the centered figure share one source.
private const val SCORE_GOOD = 95.0
private const val SCORE_WARNING = 60.0
private const val SCORE_CRITICAL = 25.0
private const val SCORE_UNKNOWN = 0.0

// Color-band thresholds — the web `healthColor(score)` map (≥80 green, ≥50 amber, else red).
private const val BAND_GOOD_MIN = 80.0
private const val BAND_WARNING_MIN = 50.0

private const val OVERALL_GOOD = "good"
private const val OVERALL_WARNING = "warning"
private const val OVERALL_CRITICAL = "critical"

/** Temperatures render as whole degrees (web `fmtNumber(convertTempFromSI(value), 0)`). */
private const val TEMP_DECIMALS = 0

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * component reads `size.cols` to choose the compact (gauge-only) vs standard (gauge + stat grid) layout,
 * so this type carries the same axis the registry constrains.
 */
data class DrivetrainHealthSize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/vehicle.ts (`drivetrain-health`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object DrivetrainHealthRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "drivetrain-health"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DrivetrainHealthWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val DEFAULT_SIZE: DrivetrainHealthSize = DrivetrainHealthSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val MIN_SIZE: DrivetrainHealthSize = DrivetrainHealthSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: DrivetrainHealthSize = DrivetrainHealthSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: DrivetrainHealthSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: DrivetrainHealthSize): DrivetrainHealthSize =
        DrivetrainHealthSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )

    /** True when [size] selects the compact (gauge-only, no stat grid) layout — web `size.cols <= 1`. */
    fun isCompact(size: DrivetrainHealthSize): Boolean = size.cols <= 1
}

/**
 * Localized labels the surface folds into its output (web `t('widget.drivetrainHealth.*')` calls). The
 * composable builds this from `stringResource`; tests pass a deterministic instance. Keeping i18n out of
 * the projection lets the projection stay a pure, locale-stable function.
 */
data class DrivetrainHealthStrings(
    val title: String,
    val score: String,
    val motorTemp: String,
    val statorTemp: String,
    val inverterHealth: String,
    val driveState: String,
    val noData: String,
)

/** The gauge color band derived from the overall score — the render layer resolves the theme color. */
enum class HealthBand {
    /** Score ≥ 80 (web green `#10b981`). */
    Good,

    /** 50 ≤ score < 80 (web amber `#f59e0b`). */
    Warning,

    /** Score < 50, including the unknown/zero score (web red `#ef4444`). */
    Critical,
}

/** One already-formatted gauge-hero stat (web `GaugeHeroStat`): a [label] over a [value] with optional [unit]. */
data class DrivetrainStat(
    val label: String,
    val value: String,
    val unit: String?,
)

/**
 * The fully projected, render-ready view of the drivetrain — the native analogue of everything the web
 * component computes before returning JSX. Pure data (no Compose types) so every branch is unit-tested
 * directly.
 *
 * @property hasData whether a drivetrain-health or motor snapshot was decoded (web `hasData = !!health ||
 *   !!motor`); when false the surface renders its empty state instead of the gauge.
 * @property score the 0–100 powertrain score driving the gauge sweep (web `healthScore(overallHealth)`).
 * @property scoreText the score as a whole-number string — the gauge's centered figure / label
 *   (web `fmtInt(score)`).
 * @property scoreUnit the gauge unit suffix (web `t('widget.drivetrainHealth.score', 'health')`).
 * @property band the color band the gauge arc uses (web `healthColor(score)`).
 * @property stats the four gauge-hero stats (Motor Temp, Stator Temp, Inverter, Drive State), shown only
 *   on the standard footprint (web `!compact && stats`).
 */
data class DrivetrainHealthDisplay(
    val hasData: Boolean,
    val score: Double,
    val scoreText: String,
    val scoreUnit: String,
    val band: HealthBand,
    val stats: List<DrivetrainStat>,
)

/**
 * The two raw cache-then-network documents the widget composes, kept as decoded [JsonElement]s exactly as
 * the shared layer serves `/drivetrain/health` and `/motor/latest`. `null` (or a JSON `null`) means that
 * feed produced no usable document. Mirrors the web `{ health, motor }` pair the component reads.
 */
data class DrivetrainHealthSnapshot(
    val health: JsonElement?,
    val motor: JsonElement?,
)

/**
 * Pure projection + state-fold for the Drivetrain Health surface — the native port of the inline data
 * derivation in `DrivetrainHealthWidget.tsx`. [project] turns a decoded [DrivetrainHealthSnapshot] into
 * the render-ready [DrivetrainHealthDisplay]; [foldState] composes the two cache-then-network feeds the
 * web component reads (`useDrivetrainHealth` + `useMotorLatest`) onto the shared [UiState] surface.
 */
object DrivetrainHealthProjection {
    /**
     * Project [snapshot] into the render model using the user's [prefs] (temperature unit + locale) and
     * the localized [strings]. SI Celsius temperatures are converted at this boundary via
     * [convertTempFromSI]; the field-fallback chains reproduce the web nullish-coalescing
     * (`health?.frontMotorTempC ?? motor?.motor_temp_c_front`, …) verbatim against the snake_case wire
     * contract.
     */
    fun project(
        snapshot: DrivetrainHealthSnapshot,
        prefs: UnitPref,
        strings: DrivetrainHealthStrings,
    ): DrivetrainHealthDisplay {
        val healthObj = snapshot.health as? JsonObject
        val motorObj = snapshot.motor as? JsonObject

        val motorTemp = healthObj?.doubleField(FIELD_FRONT_MOTOR_TEMP_C) ?: motorObj?.doubleField(FIELD_MOTOR_TEMP_C_FRONT)
        val statorTemp = motorObj?.doubleField(FIELD_DI_STATOR_TEMP) ?: healthObj?.doubleField(FIELD_REAR_MOTOR_TEMP_C)
        val inverterTemp = healthObj?.doubleField(FIELD_INVERTER_TEMP_C) ?: motorObj?.doubleField(FIELD_INVERTER_TEMP_C)
        val driveState = motorObj?.stringField(FIELD_STATE_FRONT) ?: healthObj?.stringField(FIELD_MOTOR_STATUS) ?: EM_DASH

        val score = healthScore(healthObj?.stringField(FIELD_OVERALL_HEALTH))
        val tempUnit = prefs.temperature.label

        return DrivetrainHealthDisplay(
            hasData = isPresent(snapshot.health) || isPresent(snapshot.motor),
            score = score,
            scoreText = formatInt(score),
            scoreUnit = strings.score,
            band = bandFor(score),
            stats =
                listOf(
                    DrivetrainStat(strings.motorTemp, tempText(motorTemp, prefs), tempUnit),
                    DrivetrainStat(strings.statorTemp, tempText(statorTemp, prefs), tempUnit),
                    DrivetrainStat(strings.inverterHealth, tempText(inverterTemp, prefs), tempUnit),
                    DrivetrainStat(strings.driveState, driveState, unit = null),
                ),
        )
    }

    /**
     * Folds the drivetrain-health feed ([healthRes]) and the latest-motor feed ([motorRes]) onto one
     * lifecycle-aware [UiState]. Mirrors the web shell precedence: a first load of EITHER query renders the
     * skeleton (web `isLoading = healthLoading || motorLoading`); a hard health failure with nothing cached
     * renders the error surface (web `error={healthError}`); otherwise the content / empty surface is chosen
     * by `hasData = !!health || !!motor`.
     *
     * Health is the primary feed (it alone drives the error/stale chrome, exactly as the web shell only
     * receives `healthError`/`healthStale`); the motor feed is supplementary — it contributes the
     * stator/drive-state fall-backs, the combined freshness stamp, and the background-refresh flag, and its
     * failures are intentionally not surfaced as the widget's error state.
     *
     * Divergence (non-silent — ADR-013 honest freshness): where the web shell blanks to its error surface on
     * ANY `healthError`, this keeps a cached health document visible as the stale "offline / last known"
     * content branch (error + cache) and only shows the hard error surface when there is nothing cached to
     * keep — so the surface honours both the spec's mandated `offline` state and its `error` state.
     */
    fun foldState(
        healthRes: Resource<JsonElement>,
        motorRes: Resource<JsonElement>,
    ): UiState<DrivetrainHealthSnapshot> {
        val health = present(healthRes.cached)
        val motor = present(motorRes.cached)
        val snapshot = DrivetrainHealthSnapshot(health, motor)

        val firstLoading =
            (healthRes is Resource.Loading && healthRes.cached == null) ||
                (motorRes is Resource.Loading && motorRes.cached == null)

        // Web shell precedence is loading → error → content (`if (loading) Skeleton; if (error) QueryError`),
        // so a still-loading sibling feed keeps the skeleton even after the health feed has hard-failed.
        return when {
            firstLoading -> UiState.loading()
            healthRes is Resource.Error && health == null -> errorState(healthRes)
            else -> contentState(snapshot, health != null || motor != null, healthRes, motorRes)
        }
    }

    /** The "no vehicle / no document" surface (web's disabled queries ⇒ `hasData` false ⇒ empty state). */
    fun emptyState(): UiState<DrivetrainHealthSnapshot> =
        UiState(phase = UiPhase.Empty, data = DrivetrainHealthSnapshot(health = null, motor = null))

    /** The web `healthScore(overall)` map — the 0–100 figure the gauge sweep and centered value share. */
    fun healthScore(overall: String?): Double =
        when (overall) {
            OVERALL_GOOD -> SCORE_GOOD
            OVERALL_WARNING -> SCORE_WARNING
            OVERALL_CRITICAL -> SCORE_CRITICAL
            else -> SCORE_UNKNOWN
        }

    /** The web `healthColor(score)` thresholds, expressed as a color band the render layer resolves. */
    fun bandFor(score: Double): HealthBand =
        when {
            score >= BAND_GOOD_MIN -> HealthBand.Good
            score >= BAND_WARNING_MIN -> HealthBand.Warning
            else -> HealthBand.Critical
        }

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

    private fun errorState(res: Resource.Error<*>): UiState<DrivetrainHealthSnapshot> =
        UiState(
            phase = UiPhase.Error,
            fetchedAt = res.fetchedAt,
            stale = res.stale,
            errorKind = errorKindOf(res.error),
            httpStatus = httpStatusOf(res.error),
        )

    private fun contentState(
        snapshot: DrivetrainHealthSnapshot,
        hasData: Boolean,
        healthRes: Resource<JsonElement>,
        motorRes: Resource<JsonElement>,
    ): UiState<DrivetrainHealthSnapshot> {
        val healthError = healthRes as? Resource.Error<*>
        return UiState(
            phase = if (hasData) UiPhase.Content else UiPhase.Empty,
            data = snapshot,
            fetchedAt = maxFetchedAt(healthRes, motorRes),
            stale = healthRes.stale || healthError != null,
            refreshing = healthRes is Resource.Loading || motorRes is Resource.Loading,
            errorKind = healthError?.let { errorKindOf(it.error) },
            httpStatus = healthError?.let { httpStatusOf(it.error) },
        )
    }

    private fun tempText(
        celsius: Double?,
        prefs: UnitPref,
    ): String {
        val finite = celsius?.takeIf { it.isFinite() } ?: return EM_DASH
        return formatNumber(convertTempFromSI(finite, prefs.temperature), TEMP_DECIMALS)
    }

    private fun maxFetchedAt(
        a: Resource<*>,
        b: Resource<*>,
    ): Long? = maxOf(fetchedAtOf(a), fetchedAtOf(b)).takeIf { it > 0L }

    private fun fetchedAtOf(res: Resource<*>): Long =
        when (res) {
            is Resource.Loading -> res.fetchedAt ?: 0L
            is Resource.Success -> res.fetchedAt
            is Resource.Error -> res.fetchedAt ?: 0L
        }

    /** A JSON value that is genuinely present (web truthy): non-null and not the JSON `null` literal. */
    private fun isPresent(element: JsonElement?): Boolean = element != null && element !is JsonNull

    private fun present(element: JsonElement?): JsonElement? = element?.takeIf { it !is JsonNull }

    private fun groupedFormat(decimals: Int): DecimalFormat {
        val pattern = if (decimals > 0) "#,##0." + "0".repeat(decimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US)).apply {
            roundingMode = RoundingMode.HALF_UP
        }
    }
}

/** Read a numeric field, or `null` when absent / JSON `null` / not a JSON number (web typed `number`). */
private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Read a JSON string field, or `null` when absent / JSON `null` / not a quoted string (web typed `string`). */
private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }
