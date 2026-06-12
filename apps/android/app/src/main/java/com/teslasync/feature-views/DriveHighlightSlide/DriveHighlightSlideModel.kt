// Pure, framework-free model + projection for the DriveHighlightSlide feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/analytics/components/review/DriveHighlightSlide.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// DriveHighlightSlide is a purely presentational surface — the web component takes its `drive`, `label`, and
// `emoji` as props from the Year-in-Review slide deck that owns the TanStack query, so this surface binds NO
// data hook of its own. Its only hooks are `useTranslation` (the i18n catalog, P1/S10) and `useUnits` (the
// live [io.teslasync.android.data.UnitFormatter] from the shared data layer, P1/S8). As in the sibling
// AchievementBadge / SummaryStatsRow ports, the cache-then-network lifecycle (loading / error / stale /
// offline) lives on the OWNING page, not here; modelling those states would invent behaviour the spec does
// not have. The branches the web source actually defines — the `!drive` empty state vs the populated card,
// and the `efficiency_wh_km > 0 ? value : em-dash` guard — are the complete state set this surface renders,
// and each is projected here.
//
// Values stay SI on the wire ([DriveHighlight.distanceKm] is km, [DriveHighlight.efficiencyWhKm] is Wh/km);
// the SI -> display conversion happens here through the injected [DistanceUnitPref] (the web `useUnits`
// boundary), never by mutating the source — the Phase-48 SI-canonical rule.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DriveHighlightSlide — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivehighlightslide

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.floor
import kotlin.math.roundToLong

/** Em dash shown wherever a value is absent — the web `start_address || '—'` / `'—'` empty marker. */
internal const val DRIVE_HIGHLIGHT_EM_DASH: String = "\u2014"

/** 1 mile = 1.609344 km exactly — the web `KM_PER_MILE` constant used to scale Wh/km into Wh/mi. */
internal const val KM_PER_MILE: Double = 1.609344

/** Metres per kilometre — the web multiplies SI km by 1000 before `convertDistanceFromSI`. */
internal const val METERS_PER_KM: Double = 1000.0

/** Minutes per hour — the web `Math.floor(duration_min / 60)` / `duration_min % 60` split. */
private const val MINUTES_PER_HOUR: Double = 60.0

/**
 * One year-in-review drive highlight — the native mirror of the web `YearReviewDriveHighlight` interface
 * (web/src/api/types.ts). Wire field names keep their snake_case via @SerialName and every field defaults so
 * a partial payload decodes without error (a decoder configured with `ignoreUnknownKeys` ignores extra
 * columns). [distanceKm] and [efficiencyWhKm] are SI (kilometres, watt-hours per kilometre); converting them
 * to the user's unit is the projection's job, never this type's.
 */
@Serializable
data class DriveHighlight(
    @SerialName("drive_id") val driveId: Long = 0,
    val date: String = "",
    @SerialName("distance_km") val distanceKm: Double = 0.0,
    @SerialName("duration_min") val durationMin: Double = 0.0,
    @SerialName("start_address") val startAddress: String = "",
    @SerialName("end_address") val endAddress: String = "",
    @SerialName("efficiency_wh_km") val efficiencyWhKm: Double = 0.0,
)

/**
 * The fully projected, render-ready view of a populated drive — the native analogue of everything the web
 * component computes before returning JSX: the route endpoints (with the `'—'` fallback), the rounded
 * distance + its unit label, the `Hh Mm` / `Mm` duration string, the rounded efficiency (or `'—'` when the
 * source is non-positive) + its unit label, and the raw date. Pure data (no Compose types) so the projection
 * is unit-tested without a UI host.
 *
 * @property routeStart the start address, or an em dash when the source is blank (web `start_address || '—'`).
 * @property routeEnd the end address, or an em dash when the source is blank (web `end_address || '—'`).
 * @property distanceValue the rounded display distance as a plain (un-grouped) integer string, matching the
 *   web `{Math.round(distDisplay)}` template interpolation.
 * @property distanceUnit the distance unit label shown beneath the value (web `{distanceUnit}`).
 * @property durationValue the `Hh Mm` (or `Mm` when under an hour) duration string (web `durationStr`).
 * @property efficiencyValue the rounded display efficiency, or an em dash when `efficiency_wh_km <= 0`.
 * @property efficiencyUnit the efficiency unit label (web `'Wh/mi'` for miles, else `'Wh/km'`).
 * @property date the raw drive date passed straight through (web `{drive.date}`).
 */
data class DriveHighlightDisplay(
    val routeStart: String,
    val routeEnd: String,
    val distanceValue: String,
    val distanceUnit: String,
    val durationValue: String,
    val efficiencyValue: String,
    val efficiencyUnit: String,
    val date: String,
)

/**
 * Pure projection from a [DriveHighlight] (+ the user's [DistanceUnitPref], the `useUnits` boundary) to its
 * render-ready [DriveHighlightDisplay] — a 1:1 port of the derivations the web component performs before
 * returning JSX. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object DriveHighlightSlideProjection {
    /**
     * Projects [drive] for the user's [distance] preference into the render-ready [DriveHighlightDisplay].
     * Mirrors the web verbatim: distance converts SI metres (`distance_km * 1000`) through the shared
     * `convertDistanceFromSI`; efficiency is the SI Wh/km value, scaled by [KM_PER_MILE] into Wh/mi only when
     * the user prefers miles; both display numbers are rounded with `Math.round` semantics; the efficiency
     * value falls back to an em dash when `efficiency_wh_km <= 0`.
     */
    fun project(
        drive: DriveHighlight,
        distance: DistanceUnitPref,
    ): DriveHighlightDisplay {
        val distanceDisplay = convertDistanceFromSI(drive.distanceKm * METERS_PER_KM, distance)
        val isMiles = distance == DistanceUnitPref.MI
        val efficiencyDisplay = if (isMiles) drive.efficiencyWhKm * KM_PER_MILE else drive.efficiencyWhKm
        return DriveHighlightDisplay(
            routeStart = drive.startAddress.ifEmpty { DRIVE_HIGHLIGHT_EM_DASH },
            routeEnd = drive.endAddress.ifEmpty { DRIVE_HIGHLIGHT_EM_DASH },
            distanceValue = roundedDisplay(distanceDisplay),
            distanceUnit = distance.label,
            durationValue = durationString(drive.durationMin),
            efficiencyValue = if (drive.efficiencyWhKm > 0) roundedDisplay(efficiencyDisplay) else DRIVE_HIGHLIGHT_EM_DASH,
            efficiencyUnit = efficiencyUnitLabel(distance),
            date = drive.date,
        )
    }

    /**
     * The `Hh Mm` / `Mm` duration string the web builds from `Math.floor(duration_min / 60)` and
     * `duration_min % 60` (web `durationStr`). The hours segment is dropped when the drive is under an hour
     * (web `hours > 0 ? ... : ...`). Each numeric segment is rendered with JavaScript `Number`-to-string
     * semantics so a whole-minute count never gains a trailing `.0`.
     */
    fun durationString(durationMin: Double): String {
        val hours = floor(durationMin / MINUTES_PER_HOUR)
        val minutes = durationMin % MINUTES_PER_HOUR
        return if (hours > 0) {
            "${jsNumber(hours)}h ${jsNumber(minutes)}m"
        } else {
            "${jsNumber(minutes)}m"
        }
    }

    /** The efficiency unit label — web `distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`. */
    fun efficiencyUnitLabel(distance: DistanceUnitPref): String = if (distance == DistanceUnitPref.MI) "Wh/mi" else "Wh/km"

    /**
     * Rounds a display value to its nearest integer and renders it as a plain, un-grouped string — the web
     * `{Math.round(value)}` template interpolation (no `Intl.NumberFormat`, so no thousands separators).
     * Kotlin's [roundToLong] rounds ties towards positive infinity, matching JavaScript's `Math.round`.
     */
    fun roundedDisplay(value: Double): String = value.roundToLong().toString()

    /**
     * Renders [value] the way a JavaScript template literal renders a `Number`: a whole number prints without
     * a fractional part (`30`, not `30.0`); a fractional value keeps its shortest decimal form (`30.5`).
     */
    private fun jsNumber(value: Double): String =
        if (value.isFinite() && value == floor(value)) {
            value.toLong().toString()
        } else {
            value.toString()
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the route
 * addresses, distance, or date — so a diagnostics line can never leak where or when a user drove.
 */
object DriveHighlightSlideDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "DriveHighlightSlide"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
