// Pure, framework-free model + projection + diagnostics for the JourneyDetailsPanel feature view — the native
// analogue of everything the web component derives from its props before returning JSX
// (web/src/features/driving/components/drive-detail/JourneyDetailsPanel.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable
// a thin render layer.
//
// JourneyDetailsPanel is a presentational panel — the web component renders a "Journey Details" GlassPanel with
// two columns (Start, Destination), each showing a location (a reverse-geocoded address, a formatted lat/lon
// pair, or a localized fallback), a timestamp, and a battery percentage. Its ONLY web hook is `useTranslation`;
// it binds NO data hook and performs NO fetch (the fully-loaded DriveDetail arrives as a prop from the owning
// page). As in the sibling DriveDetailHeader port (the other zero-data-source drive-detail surface), there is
// therefore no loading / error / stale / offline lifecycle to model — inventing those states would fabricate
// behaviour the web spec does not have (honesty covenant: no silent drift). What this surface genuinely varies,
// and what this pure file owns, are the web component's real conditional branches:
//   • the location — web `address ? address : (lat && lon) ? "{lat}°N/S, {|lon|}°E/W" : fallback`; the start
//     fallback is always "No address data", the destination fallback is "No address data" when the drive has an
//     end timestamp else "In progress" (web `endTs ? noAddress : inProgress`);
//   • the destination time — web `endTs ? <DateTime endTs> : "In progress"` (the start always renders a
//     timestamp, em-dash when absent/unparseable);
//   • the battery — web `{batteryPct ?? '?'}%`.
//
// Coordinate parity: the web renders `fmtNumber(lat)°{lat>=0?N:S}, fmtNumber(|lon|)°{lon>=0?E:W}` ONLY when both
// `lat && lon` are truthy (JS truthiness ⇒ non-null AND non-zero). The latitude is NOT absolute-valued (only the
// longitude is), so a southern latitude renders with its sign (e.g. "-33.86°S") — a faithful reproduction of the
// web expression, not a transcription slip. `fmtNumber` formats with the web default precision (2 fraction
// digits), locale-aware, mirroring `@/lib/numberFormat`.
//
// Timezone parity: the web renders each timestamp through `<DateTime in="vehicle">`, which resolves the car's
// IANA zone from a provider OUTSIDE this component's data sources. This surface keeps that separation — the
// owning page resolves the zone and hands it in; the projection formats in whatever [java.time.ZoneId] +
// [java.util.Locale] it is given (defaulting, at the Compose boundary, to the device zone/locale). Formatting
// uses `ofLocalizedDateTime(MEDIUM, SHORT)` ≙ the web `formatDateTime` options
// ({year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}), and the em-dash fallback
// ("—") mirrors the web `@/lib/dateFormat` contract for nullish / unparseable input.
//
// i18n parity: the web `t('driveDetail.journeyDetails' | 'start' | 'destination' | 'noAddress' | 'inProgress' |
// 'battery')` keys all exist in the generated catalog (P1/S10); they resolve at the Compose boundary (no English
// literal in native code).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/JourneyDetailsPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment is illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling DriveDetailHeader surface does. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.journeydetailspanel

import io.teslasync.shared.core.diagnostics.Logger
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor

/**
 * The raw panel inputs — the native analogue of the `DriveDetail` fields the web JourneyDetailsPanel reads. Pure
 * data so the projection is fully covered by the off-device unit gate; every optional field is nullable and
 * tolerated, exactly as the web reads `drive.startAddress` / `drive.startLat` / `drive.startBatteryPct` / … and
 * `drive.endTs` defensively.
 *
 * @property startAddress the reverse-geocoded start address, or null/blank when unknown (web `drive.startAddress`).
 * @property endAddress the reverse-geocoded end address, or null/blank when unknown (web `drive.endAddress`).
 * @property startLat the start latitude in degrees, or null (web `drive.startLat`).
 * @property startLon the start longitude in degrees, or null (web `drive.startLon`).
 * @property endLat the end latitude in degrees, or null (web `drive.endLat`).
 * @property endLon the end longitude in degrees, or null (web `drive.endLon`).
 * @property startBatteryPct the start state-of-charge percent, or null when unknown (web `drive.startBatteryPct`).
 * @property endBatteryPct the end state-of-charge percent, or null when unknown (web `drive.endBatteryPct`).
 * @property startTsIso the ISO-8601 drive start instant (web `drive.startTs`), or null.
 * @property endTsIso the ISO-8601 drive end instant (web `drive.endTs`), or null while the drive is live.
 */
data class JourneyDetailsData(
    val startAddress: String?,
    val endAddress: String?,
    val startLat: Double?,
    val startLon: Double?,
    val endLat: Double?,
    val endLon: Double?,
    val startBatteryPct: Double?,
    val endBatteryPct: Double?,
    val startTsIso: String?,
    val endTsIso: String?,
)

/**
 * Which localized fallback the composable resolves when an endpoint has no concrete location. The start endpoint
 * always falls back to [NoAddress]; the destination falls back to [NoAddress] once the drive has ended, else
 * [InProgress] (web `endTs ? t('driveDetail.noAddress') : t('driveDetail.inProgress')`). The enum keeps the
 * literal in the catalog — the projection stays free of English text.
 */
enum class LocationFallback { NoAddress, InProgress }

/**
 * A resolved primary-location line: the [text] to paint plus whether it is a [monospace] coordinate string (web
 * `font-mono`) rather than a plain address. Null is reserved at the [JourneyEndpoint] level to signal "render the
 * localized fallback".
 */
data class LocationDisplay(
    val text: String,
    val monospace: Boolean,
)

/**
 * One projected endpoint (Start or Destination) — the render-ready values for a single web column. Pure data so
 * it is asserted directly in the unit gate; the composable only resolves the i18n label/fallback and paints these
 * strings.
 *
 * @property location the resolved address or coordinate line, or null so the composable substitutes
 *   [locationFallback]'s localized string (web `address ? … : (lat && lon) ? … : fallback`).
 * @property locationFallback which localized fallback to render when [location] is null.
 * @property timeText the formatted timestamp line, or null so the composable renders the "In progress" string
 *   (the live-destination case, web `endTs ? <DateTime> : t('driveDetail.inProgress')`). Always non-null for the
 *   start endpoint (em-dash when the start timestamp is absent/unparseable).
 * @property batteryValue the battery percent value to interpolate into "Battery: {value}%", or
 *   [JourneyDetailsPanelProjection.UNKNOWN_BATTERY] ("?") when unknown (web `{batteryPct ?? '?'}`).
 */
data class JourneyEndpoint(
    val location: LocationDisplay?,
    val locationFallback: LocationFallback,
    val timeText: String?,
    val batteryValue: String,
) {
    /**
     * True when this endpoint carries no concrete data — no location, an unknown battery, and no real timestamp
     * (null or the em-dash fallback). Drives the model-level [JourneyDetailsUiModel.isEmpty] predicate; the
     * composable still renders the label, the localized fallback line, and the battery row, so the panel is never
     * a blank box.
     */
    val isEmpty: Boolean
        get() =
            location == null &&
                batteryValue == JourneyDetailsPanelProjection.UNKNOWN_BATTERY &&
                (timeText == null || timeText == JourneyDetailsPanelProjection.FALLBACK)
}

/**
 * The fully projected, render-ready model — the native analogue of the values the web component computes inline
 * before returning JSX. Pure data (no Compose/Android types) so it is asserted directly in the unit gate.
 *
 * @property start the projected Start column (web green "Start" block).
 * @property destination the projected Destination column (web red "Destination" block).
 */
data class JourneyDetailsUiModel(
    val start: JourneyEndpoint,
    val destination: JourneyEndpoint,
) {
    /**
     * True only for a fully-degenerate drive (both endpoints empty). The panel still renders its chrome — title,
     * both labels, the localized fallback lines, and the battery rows — so the surface is never a blank box; this
     * flag exists for the never-a-blank-box test contract, not to gate rendering.
     */
    val isEmpty: Boolean get() = start.isEmpty && destination.isEmpty
}

/**
 * Pure projection from the raw [JourneyDetailsData] to the render-ready [JourneyDetailsUiModel] — the native port
 * of the web component's inline location / timestamp / battery derivation. The [zone] and [locale] are injected
 * (the owning page resolves the vehicle zone, mirroring web `<DateTime in="vehicle">`), keeping formatting
 * deterministic in tests. All formatting tolerates null/blank/unparseable input by returning the em-dash
 * fallback, matching the web `@/lib/dateFormat` contract.
 */
object JourneyDetailsPanelProjection {
    /** Universal em-dash fallback for nullish / unparseable timestamps (web `@/lib/dateFormat` FALLBACK). */
    const val FALLBACK: String = "—"

    /** The "?" marker for an unknown battery percent (web `{batteryPct ?? '?'}`). */
    const val UNKNOWN_BATTERY: String = "?"

    /** Web `fmtNumber` default precision (`_globalPrecision = 2`) — coordinates render with two fraction digits. */
    private const val COORDINATE_FRACTION_DIGITS: Int = 2

    /**
     * Project [data] into the render-ready model, formatting every timestamp in [zone] using [locale].
     *
     * Start: the location resolves to the address, else the coordinate pair, else the [LocationFallback.NoAddress]
     * fallback; the time always formats the start timestamp (em-dash when absent/unparseable); the battery is the
     * start percent or "?".
     *
     * Destination: the location resolves to the address, else the coordinate pair, else — keyed on whether the
     * drive has an end timestamp — [LocationFallback.NoAddress] (ended) or [LocationFallback.InProgress] (live).
     * The time formats the end timestamp when present, else is null so the composable renders "In progress" (web
     * `endTs ? <DateTime> : t('driveDetail.inProgress')`); the battery is the end percent or "?".
     */
    fun project(
        data: JourneyDetailsData,
        zone: ZoneId,
        locale: Locale,
    ): JourneyDetailsUiModel {
        val hasEnd = !data.endTsIso.isNullOrEmpty()
        return JourneyDetailsUiModel(
            start =
                JourneyEndpoint(
                    location = location(data.startAddress, data.startLat, data.startLon, locale),
                    locationFallback = LocationFallback.NoAddress,
                    timeText = formatDateTime(data.startTsIso, zone, locale),
                    batteryValue = battery(data.startBatteryPct),
                ),
            destination =
                JourneyEndpoint(
                    location = location(data.endAddress, data.endLat, data.endLon, locale),
                    locationFallback = if (hasEnd) LocationFallback.NoAddress else LocationFallback.InProgress,
                    timeText = if (hasEnd) formatDateTime(data.endTsIso, zone, locale) else null,
                    batteryValue = battery(data.endBatteryPct),
                ),
        )
    }

    /**
     * Web `address ? address : (lat && lon) ? coords : null`. A non-empty address wins (web string truthiness,
     * so an empty string falls through); otherwise the coordinate pair when present; otherwise null so the
     * composable resolves the localized fallback.
     */
    fun location(
        address: String?,
        lat: Double?,
        lon: Double?,
        locale: Locale,
    ): LocationDisplay? {
        if (!address.isNullOrEmpty()) return LocationDisplay(address, monospace = false)
        return coordinates(lat, lon, locale)?.let { LocationDisplay(it, monospace = true) }
    }

    /**
     * Web `(lat && lon) ? "{fmtNumber(lat)}°{lat>=0?N:S}, {fmtNumber(|lon|)}°{lon>=0?E:W}" : null`. Reproduces the
     * JS truthiness guard — both coordinates must be present, finite, AND non-zero (zero is falsy) — and the web
     * asymmetry where the latitude keeps its sign while only the longitude is absolute-valued.
     */
    fun coordinates(
        lat: Double?,
        lon: Double?,
        locale: Locale,
    ): String? {
        val safeLat = lat?.takeIf { it.isFinite() && it != 0.0 }
        val safeLon = lon?.takeIf { it.isFinite() && it != 0.0 }
        if (safeLat == null || safeLon == null) return null
        return "${fmtNumber(safeLat, locale)}°${hemisphere(safeLat, "N", "S")}, " +
            "${fmtNumber(abs(safeLon), locale)}°${hemisphere(safeLon, "E", "W")}"
    }

    /** Picks the [positive] or [negative] hemisphere letter for a signed coordinate (web `value >= 0 ? … : …`). */
    private fun hemisphere(
        value: Double,
        positive: String,
        negative: String,
    ): String = if (value >= 0) positive else negative

    /**
     * Web `{batteryPct ?? '?'}` — the percent value with no locale grouping or forced decimals (a whole number
     * renders without a fractional part, e.g. 87 ⇒ "87", 87.5 ⇒ "87.5"), or "?" when null/non-finite.
     */
    fun battery(pct: Double?): String {
        if (pct == null || !pct.isFinite()) return UNKNOWN_BATTERY
        return if (pct == floor(pct)) pct.toLong().toString() else pct.toString()
    }

    /**
     * Web `formatDateTime` — the localized date + short time ("Jan 15, 2026, 10:30 AM" in en-US) in [zone], or the
     * em-dash fallback for nullish / unparseable input.
     */
    fun formatDateTime(
        iso: String?,
        zone: ZoneId,
        locale: Locale,
    ): String =
        format(
            iso,
            DateTimeFormatter
                .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
                .withLocale(locale)
                .withZone(zone),
        )

    /** Web `fmtNumber` — locale-aware, fixed two-fraction-digit formatting (the global default precision). */
    private fun fmtNumber(
        value: Double,
        locale: Locale,
    ): String {
        val formatter = NumberFormat.getNumberInstance(locale)
        formatter.minimumFractionDigits = COORDINATE_FRACTION_DIGITS
        formatter.maximumFractionDigits = COORDINATE_FRACTION_DIGITS
        return formatter.format(value)
    }

    private fun format(
        iso: String?,
        formatter: DateTimeFormatter,
    ): String {
        val instant = parseInstant(iso) ?: return FALLBACK
        return runCatching { formatter.format(instant) }.getOrDefault(FALLBACK)
    }

    private fun parseInstant(iso: String?): Instant? {
        val raw = iso?.trim().orEmpty()
        if (raw.isEmpty()) return null
        return runCatching { Instant.parse(raw) }.getOrNull()
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any drive
 * data, address, coordinate, battery level, or timestamp — so a diagnostics line can never leak anything about
 * the user or their vehicle.
 */
object JourneyDetailsPanelDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "journey-details-panel"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "JourneyDetailsPanel"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
