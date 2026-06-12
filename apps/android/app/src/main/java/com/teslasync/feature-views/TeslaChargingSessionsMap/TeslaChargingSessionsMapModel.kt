// Pure, framework-free model + projection for the TeslaChargingSessionsMap feature view — the native
// analogue of everything the web component derives before it returns JSX
// (web/src/features/charging/pages/TeslaChargingSessionsMap.tsx). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays
// a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the Fleet Charging Sessions page) calls
// `useTeslaChargingSessions` and passes the rows down as `sessions`. From those it derives two `useMemo`
// values: the map `center` (the average of every session's coordinates, treating a missing coordinate as 0,
// or a San-Francisco fallback for an empty list) and the `clusterPoints` (one marker per session that has a
// finite numeric coordinate, each carrying the popup content — site name, local start time, energy added in
// kWh, total cost, and charger type — plus the `markerLabel` accessible name). This file owns those
// derivations: the `center`, the per-marker projection (title, info-window snippet, accessible label), the
// `useFormatting` currency contract (`currencySymbol + fmtNumber`), the SI energy conversion
// (`convertEnergyFromSI(wh, 'kWh')` = `wh / 1000`), the localized date/time, and the screen-reader summary
// lines. `fmtNumber` mirrors the web `Intl.NumberFormat` half-away-from-zero rounding rather than Java's
// default banker's rounding.
//
// The web escapes the popup HTML before injecting it into a Leaflet popup; that escaping is a web-DOM safety
// measure, not a data transformation, so it has no analogue here — Compose `Text` renders plain strings and
// never interprets markup. The displayed values are otherwise identical to the web.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TeslaChargingSessionsMap — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.teslachargingsessionsmap

import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash shown for an absent local start time — the web `formatDateTime` `—` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Separator joining the info-window detail parts — a single line in place of the web stacked `<p>`s. */
internal const val SNIPPET_SEPARATOR: String = " \u2022 "

/** Separator between a marker's accessible name and its details in a summary line. */
internal const val SUMMARY_SEPARATOR: String = " \u2014 "

/** Default currency symbol when the settings document has none (web `useFormatting` `'$'`). */
internal const val DEFAULT_CURRENCY: String = "$"

/** Energy fraction digits — the web `fmtNumber(convertEnergyFromSI(wh, 'kWh'), 1)` precision. */
internal const val ENERGY_DECIMALS: Int = 1

/** Cost fraction digits — the web `formatCurrency(s.total_cost, 2)` literal precision. */
internal const val COST_DECIMALS: Int = 2

/** Energy unit symbol appended to the energy detail — the web literal `kWh`. */
internal const val UNIT_KWH: String = "kWh"

/** Watt-hours per kilowatt-hour — the web `convertEnergyFromSI(wh, 'kWh')` divisor. */
private const val WH_PER_KWH: Double = 1000.0

/** Map zoom level — the web `<MapContainer zoom={5}>`. */
internal const val MAP_ZOOM: Float = 5f

/** Fallback center latitude for an empty list — the web `{ lat: 37.77, lng: -122.42 }`. */
internal const val FALLBACK_LATITUDE: Double = 37.77

/** Fallback center longitude for an empty list — the web `{ lat: 37.77, lng: -122.42 }`. */
internal const val FALLBACK_LONGITUDE: Double = -122.42

/**
 * One Tesla fleet charging session narrowed to the fields this map reads — the native mirror of the web
 * `TeslaChargingSession` rows (web `api/hooks/useCharging.ts`). Energy is SI watt-hours on the wire and is
 * converted to kWh only for display; coordinates are WGS-84 degrees and are never converted. Every optional
 * field is nullable so a partial payload never throws (the web optional-chaining / `!= null` reads).
 *
 * @property sessionId the stable per-session id used as the marker key (web `s.session_id`).
 * @property siteLocationName the charging site name (web `s.site_location_name`); blank ⇒ "Unknown".
 * @property chargeStartDatetime the ISO-8601 UTC start instant (web `s.charge_start_datetime`).
 * @property totalEnergyAddedWh energy added in SI watt-hours (web `s.total_energy_added_wh`).
 * @property totalCost the total session cost in the user's currency (web `s.total_cost`).
 * @property chargerType the charger kind, shown uppercased (web `s.charger_type`).
 * @property latitude the site latitude in degrees (web `s.latitude`).
 * @property longitude the site longitude in degrees (web `s.longitude`).
 */
data class TeslaChargingSession(
    val sessionId: Long,
    val siteLocationName: String?,
    val chargeStartDatetime: String?,
    val totalEnergyAddedWh: Double?,
    val totalCost: Double?,
    val chargerType: String?,
    val latitude: Double?,
    val longitude: Double?,
)

/**
 * The user's currency display preference this surface needs — the native port of the web `useFormatting`
 * read of the `/settings` document. Only the [currencySymbol] is needed: the cost detail formats with the
 * literal 2-digit precision (web `formatCurrency(x, 2)`), so the user's `decimal_precision` does not apply.
 */
data class ChargingSessionsCurrencyPrefs(
    val currencySymbol: String,
) {
    companion object {
        /** The `$` default used before settings load (matches the web default). */
        val DEFAULT: ChargingSessionsCurrencyPrefs = ChargingSessionsCurrencyPrefs(DEFAULT_CURRENCY)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Resolves the currency symbol from the raw `/settings` document (web `useFormatting`). */
        fun fromSettings(settings: kotlinx.serialization.json.JsonElement?): ChargingSessionsCurrencyPrefs {
            val raw = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = raw?.contentOrNull?.trim()
            return ChargingSessionsCurrencyPrefs(if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY)
        }
    }
}

/**
 * The already-localized strings this surface renders — resolved through the P1/S10 i18n facade at the
 * Compose boundary and passed in so the projection stays pure and JVM-testable. The keys mirror the web
 * `t('tesla_sessions.*')` calls verbatim.
 *
 * @property mapLabel web `tesla_sessions.mapLabel` ("Charging sessions map") — the map's accessible name.
 * @property unknown web `tesla_sessions.unknown` ("Unknown") — the missing-site-name fallback.
 * @property markerLabel web `tesla_sessions.markerLabel` ("{{name}} charging session") — the per-marker
 *   accessible name; the lambda applies the `{{name}}` interpolation.
 * @property noData the empty-surface message (web `tesla_sessions.noMapData`, "No location data available
 *   yet."); the web always draws the map, but the native surface shows this when nothing can be plotted.
 */
data class ChargingSessionsMapStrings(
    val mapLabel: String,
    val unknown: String,
    val markerLabel: (String) -> String,
    val noData: String,
)

/**
 * One projected, render-ready marker — the native analogue of a web `clusterPoints` entry. [point] is the
 * validated coordinate; [title] is the info-window header (the site name, web popup bold line); [snippet]
 * is the single-line detail (local time • energy • cost • charger, the web popup body); [accessibleLabel]
 * is the web `ariaLabel` ("{name} charging session"). [id] keys the marker (web `s.session_id`).
 */
data class SessionMarker(
    val id: String,
    val point: GeoPoint,
    val title: String,
    val snippet: String,
    val accessibleLabel: String,
)

/**
 * The fully projected, render-ready view of one charging-sessions response — the native analogue of
 * everything the web component computes before returning JSX (the `center`, the `clusterPoints`, and the
 * map's accessible name). Pure data so the projection is unit-tested without a UI host.
 *
 * @property center the map center (web `center`).
 * @property zoom the map zoom level (web `zoom={5}`).
 * @property markers the render-ready markers (web `clusterPoints`).
 * @property hasMarkers whether any marker resolved; `false` surfaces the empty map.
 * @property mapLabel the localized accessible-summary panel label (web map `aria-label`).
 * @property mapContentDescription the TalkBack name announced for the opaque map node (web `aria-label`).
 * @property summaryLines one screen-reader line per marker — the non-visual list alternative for the map.
 * @property noDataText the empty-surface message shown when no marker can be plotted.
 */
data class ChargingSessionsMapDisplay(
    val center: GeoPoint,
    val zoom: Float,
    val markers: List<SessionMarker>,
    val hasMarkers: Boolean,
    val mapLabel: String,
    val mapContentDescription: String,
    val summaryLines: List<String>,
    val noDataText: String,
)

/**
 * Pure projection from the decoded sessions (+ currency + locale) to the surface's render state — a 1:1
 * port of the web component's inline `useMemo` derivations and popup formatting. Stateless and
 * side-effect-free so it is fully covered by the off-device unit gate; the composable only resolves
 * localized strings, builds map markers, and draws what these return.
 */
object TeslaChargingSessionsMapProjection {
    /**
     * The map center — a verbatim port of the web `center` memo: a San-Francisco fallback for an empty
     * list, otherwise the mean of every session's coordinates with a missing coordinate counted as 0 (web
     * `s.latitude ?? 0`). All sessions participate, not just the ones with renderable coordinates, exactly
     * as the web does.
     */
    fun center(sessions: List<TeslaChargingSession>): GeoPoint {
        if (sessions.isEmpty()) return GeoPoint(FALLBACK_LATITUDE, FALLBACK_LONGITUDE)
        val avgLat = sessions.sumOf { it.latitude ?: 0.0 } / sessions.size
        val avgLng = sessions.sumOf { it.longitude ?: 0.0 } / sessions.size
        return GeoPoint(avgLat, avgLng)
    }

    /**
     * Whether [session] has a renderable coordinate — the native analogue of the web `clusterPoints`
     * filter (`typeof lat === 'number' && !Number.isNaN(lat) && …`). Uses the shared maps
     * [GeoPoint.isValid] (finite AND inside the valid lat/lng envelope), which is the same contract the
     * cluster layer applies, so the accessible summary lists exactly what the map renders.
     */
    fun hasRenderableLocation(session: TeslaChargingSession): Boolean = geoPointOf(session) != null

    /** Whether any session can be plotted — the native empty-map gate (web has none; it always draws). */
    fun hasAnyRenderableLocation(sessions: List<TeslaChargingSession>): Boolean = sessions.any { hasRenderableLocation(it) }

    /**
     * The render-ready markers, preserving source order — the native port of the web `clusterPoints` map.
     * Each session with a valid coordinate becomes one [SessionMarker]; sessions without are dropped (web
     * `.filter(...)`).
     */
    fun markers(
        sessions: List<TeslaChargingSession>,
        strings: ChargingSessionsMapStrings,
        currency: ChargingSessionsCurrencyPrefs,
        locale: Locale,
        zone: ZoneId = ZoneId.systemDefault(),
    ): List<SessionMarker> = sessions.mapNotNull { markerFor(it, strings, currency, locale, zone) }

    /**
     * One screen-reader line per marker — its accessible name followed by the same details the info window
     * shows, so a TalkBack user gets everything the visible popup conveys. A marker with no details renders
     * its name alone.
     */
    fun summaryLines(markers: List<SessionMarker>): List<String> =
        markers.map { marker ->
            if (marker.snippet.isEmpty()) marker.accessibleLabel else "${marker.accessibleLabel}$SUMMARY_SEPARATOR${marker.snippet}"
        }

    /**
     * Project [sessions] for [locale] using [strings] + [currency] — the native analogue of everything the
     * web component derives before returning JSX. The map is centered on the web `center`, carries one
     * marker per renderable session, and announces the web `mapLabel` accessible name.
     */
    fun project(
        sessions: List<TeslaChargingSession>,
        strings: ChargingSessionsMapStrings,
        currency: ChargingSessionsCurrencyPrefs,
        locale: Locale,
        zone: ZoneId = ZoneId.systemDefault(),
    ): ChargingSessionsMapDisplay {
        val markerList = markers(sessions, strings, currency, locale, zone)
        return ChargingSessionsMapDisplay(
            center = center(sessions),
            zoom = MAP_ZOOM,
            markers = markerList,
            hasMarkers = markerList.isNotEmpty(),
            mapLabel = strings.mapLabel,
            mapContentDescription = strings.mapLabel,
            summaryLines = summaryLines(markerList),
            noDataText = strings.noData,
        )
    }

    /**
     * Locale-aware fixed-precision formatting — the native mirror of the web `fmtNumber(value, decimals)`
     * (`Intl.NumberFormat` with equal min/max fraction digits). Groups thousands and rounds half away from
     * zero so the output matches ECMAScript's `halfExpand` rather than Java's default banker's rounding. A
     * non-finite value is coerced to 0 (web `safeNumber`).
     */
    fun fmtNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String {
        val safeDecimals = decimals.coerceAtLeast(0)
        val pattern = if (safeDecimals > 0) "#,##0." + "0".repeat(safeDecimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(locale))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(safe(value))
    }

    /**
     * Currency formatting — the web `useFormatting` `currencySymbol + fmtNumber(amount, decimals)` contract.
     * A blank symbol falls back to `$`; a non-finite amount is normalized to 0 (web `safeNumber`).
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        decimals: Int,
        locale: Locale,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${fmtNumber(amount, decimals, locale)}"

    /** Watt-hours → kilowatt-hours — the web `convertEnergyFromSI(wh, 'kWh')` (`wh / 1000`). */
    fun energyKwh(wh: Double): Double = wh / WH_PER_KWH

    /**
     * Localized "MMM d, y, h:mm a"-style date/time — the native mirror of the web `formatDateTime`
     * (`Date#toLocaleString` with `{ year, month: 'short', day, hour: '2-digit', minute: '2-digit' }`).
     * Renders [iso] (ISO-8601 UTC from the backend) in [zone]; returns the em dash for a blank or
     * unparseable value (web `'—'` fallback), never throwing.
     */
    fun formatDateTime(
        iso: String?,
        locale: Locale,
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val instant = iso?.takeIf { it.isNotBlank() }?.let { parseInstant(it) } ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    private fun markerFor(
        session: TeslaChargingSession,
        strings: ChargingSessionsMapStrings,
        currency: ChargingSessionsCurrencyPrefs,
        locale: Locale,
        zone: ZoneId,
    ): SessionMarker? {
        val point = geoPointOf(session) ?: return null
        val name = siteName(session, strings)
        return SessionMarker(
            id = session.sessionId.toString(),
            point = point,
            title = name,
            snippet = snippetOf(session, currency, locale, zone),
            accessibleLabel = strings.markerLabel(name),
        )
    }

    /**
     * The info-window detail line — the web popup body folded into one string: the local start time
     * (always present, em dash when missing), then the energy added, the total cost, and the charger type
     * when each is present (web `s.total_energy_added_wh != null ? … : ''`, etc.). The charger type is
     * uppercased like the web `text-transform:uppercase`.
     */
    private fun snippetOf(
        session: TeslaChargingSession,
        currency: ChargingSessionsCurrencyPrefs,
        locale: Locale,
        zone: ZoneId,
    ): String {
        val parts =
            buildList {
                add(formatDateTime(session.chargeStartDatetime, locale, zone))
                session.totalEnergyAddedWh?.let {
                    add("${fmtNumber(energyKwh(it), ENERGY_DECIMALS, locale)} $UNIT_KWH")
                }
                session.totalCost?.let { add(formatCurrency(it, currency.currencySymbol, COST_DECIMALS, locale)) }
                session.chargerType?.takeIf { it.isNotEmpty() }?.let { add(it.uppercase(locale)) }
            }
        return parts.filter { it.isNotEmpty() }.joinToString(SNIPPET_SEPARATOR)
    }

    /** The site name, or the localized "Unknown" fallback (web `s.site_location_name || unknown`). */
    private fun siteName(
        session: TeslaChargingSession,
        strings: ChargingSessionsMapStrings,
    ): String = session.siteLocationName?.takeIf { it.isNotEmpty() } ?: strings.unknown

    /** The validated coordinate for [session], or `null` when it cannot be plotted. */
    private fun geoPointOf(session: TeslaChargingSession): GeoPoint? {
        val lat = session.latitude
        val lng = session.longitude
        return if (lat != null && lng != null) GeoPoint(lat, lng).takeIf { it.isValid() } else null
    }

    /** Parses an ISO-8601 instant (UTC `Z`, an offset, or a zone-less local time) to an [Instant], or null. */
    private fun parseInstant(iso: String): Instant? =
        runCatching { Instant.parse(iso) }
            .recoverCatching { OffsetDateTime.parse(iso).toInstant() }
            .recoverCatching { LocalDateTime.parse(iso).toInstant(ZoneOffset.UTC) }
            .getOrNull()

    /** Web `safeNumber(v)`: the value when finite, otherwise 0 — so a format never emits `NaN`. */
    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a site
 * name, coordinate, cost, or vin — so a diagnostics line can never leak where or what the fleet charges.
 */
object TeslaChargingSessionsMapDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "TeslaChargingSessionsMap"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
