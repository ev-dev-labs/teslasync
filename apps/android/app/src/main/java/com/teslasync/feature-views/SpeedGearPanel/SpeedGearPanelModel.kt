// Pure, framework-free model + projection for the SpeedGearPanel feature view — the native analogue of every
// derivation the web component performs before it returns JSX
// (web/src/features/driving/components/driving-dynamics/SpeedGearPanel.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, so the composable stays
// a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the Driving Dynamics page) owns the `/motor/latest`
// query and the `/drives` query, then hands this panel the latest `MotorSnapshot` and the date-filtered
// `Drive[]`. From those it derives four cells: the shift letter (with a semantic color + a status badge), the
// motor power in kW, and the average / top drive speed. Speed is the regression-sensitive part: the web
// computes the aggregates in SI metres-per-second and converts to the user's display unit EXACTLY ONCE at the
// render site (the historical bug double-applied the m/s→mph factor, turning a real ~31 mph top into "154
// mph"). This port reproduces the single-conversion invariant: [avgDriveSpeedMps] / [topDriveSpeedMps] stay in
// SI and the conversion happens once inside [SpeedGearPanelProjection.display].
//
// [MotorShift] mirrors the slice of `MotorSnapshot` the web reads in snake_case (the Go JSON tags served
// verbatim, no camelCaseKeys transform in the shared layer), so the projection runs straight off the cached
// API JSON. Power arrives already in kW (the backend `injectDerivedMotorPower` derivation the web renders
// verbatim) and is shown with a literal `kW` suffix, exactly like the web; the drive speeds arrive as SI m/s
// and are converted at the single render-boundary seam (Phase-48 SI-canonical rule; web `toSpeedDisplay` =
// `convertSpeedFromSI`). `formatNumber` mirrors the web global `fmtNumber` precision (the user's
// `decimal_precision`, default 2) for power and pins 0 decimals for the two speeds (web `fmtNumber(_, 0)`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SpeedGearPanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.speedgearpanel

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertSpeedFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/** The em-dash the web renders for any null / absent value (`'—'`). */
internal const val DASH: String = "\u2014"

/** Web `fmtNumber`'s global precision default — the user's `decimal_precision`, 2 when unset (motor power). */
internal const val DEFAULT_DECIMAL_PRECISION: Int = 2

/** The two drive speeds render as whole numbers in display units (web `fmtNumber(toSpeedDisplay(v), 0)`). */
private const val SPEED_DECIMALS: Int = 0

/** Power unit suffix (web literal `'kW'`); power is shown raw — the backend already derives kW. */
internal const val KW_UNIT: String = "kW"

// Shift-state codes from `MotorSnapshot.shift_state` (web `motorLatest.shift_state`), driving the cell color
// and the status-badge variant.
private const val SHIFT_DRIVE = "D"
private const val SHIFT_REVERSE = "R"
private const val SHIFT_NEUTRAL = "N"
private const val SHIFT_PARK = "P"

// Raw `/motor/latest` (MotorSnapshot) document keys read by the surface — snake_case, served verbatim by the
// Go handler (no camelCaseKeys transform in the shared layer), so the native reads match the wire contract.
private const val FIELD_SHIFT_STATE = "shift_state"
private const val FIELD_POWER_KW = "power_kw"

/**
 * The slice of a web `Drive` (web/src/types/driving.ts) the panel reduces over: the per-drive average and
 * maximum speed, both SI metres-per-second and both nullable (the backend omits a figure when a drive has no
 * speed telemetry). The web reducer coerces a null to 0 (`d.avgSpeedMps ?? 0` / `d.maxSpeedMps ?? 0`), so the
 * native [SpeedGearPanelProjection] reproduces that exact coercion.
 */
data class DriveSpeedSample(
    val avgSpeedMps: Double?,
    val maxSpeedMps: Double?,
)

/**
 * The slice of `/motor/latest` (`MotorSnapshot`) this surface reads — the native mirror of the two fields the
 * web `SpeedGearPanel` consumes. Field names keep their snake_case wire form so the projection runs directly
 * off the cached API JSON, and both fields are nullable because the backend omits a reading whenever the
 * underlying telemetry has not reported (web reads each as `motorLatest?.<field> … '—'`). Power is already kW.
 */
data class MotorShift(
    val shiftState: String?,
    val powerKw: Double?,
) {
    public companion object {
        /**
         * Decode a `/motor/latest` body into a tolerant snapshot, or `null` when the body is absent / not a
         * JSON object — web parity: `motorLatest` is `MotorSnapshot | null` and the panel then renders the
         * shift cell's `'—'`. A present object — even one whose fields are all null — decodes to a snapshot so
         * the cells render with the web `'—'` fallbacks.
         */
        public fun fromJson(element: JsonElement?): MotorShift? {
            val obj = element as? JsonObject ?: return null
            return MotorShift(
                shiftState = obj.stringField(FIELD_SHIFT_STATE),
                powerKw = obj.doubleField(FIELD_POWER_KW),
            )
        }
    }
}

/**
 * The native "snapshot" the host supplies — the union of the web component's two props (`motorLatest` +
 * `filteredDrives`). A present snapshot (even one with a null [motor] and an empty [drives]) renders the four
 * cells with the web `'—'` fallbacks; a null snapshot selects the friendly empty state so the panel never
 * collapses to a blank box. The host owns the feed lifecycle (P1/S8); this type carries no Compose/HTTP.
 */
data class SpeedGearSnapshot(
    val motor: MotorShift?,
    val drives: List<DriveSpeedSample>,
)

/**
 * The semantic accent the shift letter is tinted with — the native analogue of the web `shiftColor` ternary
 * (`D`→emerald, `R`→red, `N`→yellow, `P`→muted, else→secondary). The render layer resolves each to a design
 * token so no hex literal leaks into the view.
 */
enum class ShiftAccent { Drive, Reverse, Neutral, Park, Unknown }

/**
 * The status-badge variant beneath the shift letter — the native analogue of the web `shiftBadgeVariant`
 * ternary (`D`→success, `R`→danger, `N`→warning, else→neutral). Note `P` (and any other code) falls to
 * [Neutral] for the badge even though the letter itself tints [ShiftAccent.Park], matching the web's two
 * separate mappings.
 */
enum class ShiftBadge { Success, Danger, Warning, Neutral }

/** Stable identity of each non-shift metric cell, in the order the web grid emits them. */
enum class SpeedGearMetric { Power, AvgDriveSpeed, TopDriveSpeed }

/**
 * One render-ready metric cell — its [metric] identity, the already-formatted [value] (or the em-dash
 * fallback), and the [unit] suffix shown beneath it. The localized label is resolved at the Compose boundary
 * from [metric], keeping this type free of any i18n dependency so it stays unit-testable off-device.
 */
data class SpeedGearMetricValue(
    val metric: SpeedGearMetric,
    val value: String,
    val unit: String,
)

/**
 * The fully projected, render-ready view — everything the web component computes before returning JSX. Pure
 * data (no Compose types) so the projection is unit-tested without a UI host, and each instance doubles as the
 * surface's per-state snapshot.
 *
 * @property shift the shift letter to render (web `motorLatest?.shift_state ?? '—'`).
 * @property shiftAccent the color the shift letter is tinted with (web `shiftColor`).
 * @property shiftBadge the status-badge variant beneath the letter (web `shiftBadgeVariant`).
 * @property metrics the three non-shift cells (motor power, average drive speed, top drive speed).
 */
data class SpeedGearDisplay(
    val shift: String,
    val shiftAccent: ShiftAccent,
    val shiftBadge: ShiftBadge,
    val metrics: List<SpeedGearMetricValue>,
)

/**
 * Pure projection from the panel's inputs to its render state — a 1:1 port of the web component's
 * derivations: the SI drive-speed aggregation, the SINGLE m/s→display conversion at the render site (the
 * double-conversion regression the web test pins), the per-cell `… != null ? … : '—'` formatting, and the
 * `shiftColor` / `shiftBadgeVariant` ternaries. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate; the composable only resolves localized strings + token colors and draws what these
 * return.
 */
object SpeedGearPanelProjection {
    /**
     * Maps the panel's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins outright (skeleton chrome), a present snapshot renders [UiPhase.Content], and an absent snapshot
     * renders [UiPhase.Empty] (a friendly no-data state). The host's stateful binding can additionally carry
     * refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        snapshot: SpeedGearSnapshot?,
        isLoading: Boolean,
    ): UiState<SpeedGearSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The render-ready [SpeedGearDisplay] for the given [snapshot], [prefs] (the user's display units, web
     * `useUnits`), and [locale] (the grouping/separator locale, web `fmtNumber`'s active locale). The two
     * speeds are aggregated in SI then converted once via [convertSpeedFromSI] (web `toSpeedDisplay`) and
     * formatted at 0 decimals; power is shown raw in kW at the user's precision; the shift cell maps the
     * `shift_state` onto its color + badge.
     */
    fun display(
        snapshot: SpeedGearSnapshot,
        prefs: UnitPref,
        locale: Locale,
    ): SpeedGearDisplay {
        val shift = snapshot.motor?.shiftState
        val precision = (prefs.precision ?: DEFAULT_DECIMAL_PRECISION).coerceAtLeast(0)
        val speedLabel = prefs.speed.label
        return SpeedGearDisplay(
            shift = shift ?: DASH,
            shiftAccent = shiftAccent(shift),
            shiftBadge = shiftBadge(shift),
            metrics =
                listOf(
                    SpeedGearMetricValue(
                        metric = SpeedGearMetric.Power,
                        value = powerValue(snapshot.motor?.powerKw, precision, locale),
                        unit = KW_UNIT,
                    ),
                    SpeedGearMetricValue(
                        metric = SpeedGearMetric.AvgDriveSpeed,
                        value = speedValue(avgDriveSpeedMps(snapshot.drives), prefs, locale),
                        unit = speedLabel,
                    ),
                    SpeedGearMetricValue(
                        metric = SpeedGearMetric.TopDriveSpeed,
                        value = speedValue(topDriveSpeedMps(snapshot.drives), prefs, locale),
                        unit = speedLabel,
                    ),
                ),
        )
    }

    /**
     * Web `filteredDrives.length > 0 ? filteredDrives.reduce((s, d) => s + (d.avgSpeedMps ?? 0), 0) / length :
     * null` — the mean of the per-drive average speeds in SI m/s, with a null per-drive figure coerced to 0
     * (so a null-only drive pulls the mean down, exactly like the web). `null` when no drives match the
     * filter, which renders the em-dash.
     */
    fun avgDriveSpeedMps(drives: List<DriveSpeedSample>): Double? =
        if (drives.isEmpty()) null else drives.sumOf { it.avgSpeedMps ?: 0.0 } / drives.size

    /**
     * Web `filteredDrives.length > 0 ? Math.max(...filteredDrives.map((d) => d.maxSpeedMps ?? 0)) : null` —
     * the largest per-drive maximum speed in SI m/s, with a null per-drive figure coerced to 0. `null` when no
     * drives match the filter, which renders the em-dash.
     */
    fun topDriveSpeedMps(drives: List<DriveSpeedSample>): Double? = if (drives.isEmpty()) null else drives.maxOf { it.maxSpeedMps ?: 0.0 }

    /** Web `shiftColor`: `D`→Drive, `R`→Reverse, `N`→Neutral, `P`→Park, anything else (incl. null)→Unknown. */
    fun shiftAccent(shift: String?): ShiftAccent =
        when (shift) {
            SHIFT_DRIVE -> ShiftAccent.Drive
            SHIFT_REVERSE -> ShiftAccent.Reverse
            SHIFT_NEUTRAL -> ShiftAccent.Neutral
            SHIFT_PARK -> ShiftAccent.Park
            else -> ShiftAccent.Unknown
        }

    /** Web `shiftBadgeVariant`: `D`→success, `R`→danger, `N`→warning, anything else (incl. `P`/null)→neutral. */
    fun shiftBadge(shift: String?): ShiftBadge =
        when (shift) {
            SHIFT_DRIVE -> ShiftBadge.Success
            SHIFT_REVERSE -> ShiftBadge.Danger
            SHIFT_NEUTRAL -> ShiftBadge.Warning
            else -> ShiftBadge.Neutral
        }

    /**
     * Web `avg/top != null ? fmtNumber(toSpeedDisplay(value), 0) : '—'`. The SI aggregate is converted to the
     * user's display unit ONCE here (web `toSpeedDisplay` = `convertSpeedFromSI`) and formatted at 0 decimals;
     * a null aggregate (no drives) yields the em-dash.
     */
    private fun speedValue(
        mps: Double?,
        prefs: UnitPref,
        locale: Locale,
    ): String = if (mps != null) formatNumber(convertSpeedFromSI(mps, prefs.speed), SPEED_DECIMALS, locale) else DASH

    /** Web `motorLatest?.power_kw != null ? fmtNumber(power_kw) : '—'` — raw kW at the user's precision. */
    private fun powerValue(
        kw: Double?,
        precision: Int,
        locale: Locale,
    ): String = if (kw != null) formatNumber(kw, precision, locale) else DASH

    /**
     * Format a number the way the web `fmtNumber(value, decimals)` does:
     * `Number.toLocaleString(locale, { minimumFractionDigits, maximumFractionDigits })` with grouping
     * separators and ECMAScript `halfExpand` rounding (round half away from zero). A non-finite input is
     * coerced to 0 (web `safeNumber`) and a signed zero normalized to positive zero so a `-0.0` renders "0",
     * matching `Intl.NumberFormat`.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String {
        val finite = if (value.isFinite()) value else 0.0
        val normalized = if (finite == 0.0) 0.0 else finite
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = decimals
                maximumFractionDigits = decimals
                roundingMode = RoundingMode.HALF_UP
                isGroupingUsed = true
            }
        return formatter.format(normalized)
    }
}

/**
 * Resolve the BCP-47 [tag] from the user's settings (web `useUnits` locale) to a [Locale], falling back to
 * en-US for a blank/absent tag — the same default the web `fmtNumber` applies when no locale is configured.
 */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a motor
 * reading, a drive speed, or the unit preference — so a diagnostics line can never leak fleet telemetry.
 */
object SpeedGearPanelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "SpeedGearPanel"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Read a numeric field, or `null` when absent / JSON `null` / not a JSON number (web typed `number`). */
private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Read a JSON string field, or `null` when absent / JSON `null` / not a quoted string (web typed `string`). */
private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }
