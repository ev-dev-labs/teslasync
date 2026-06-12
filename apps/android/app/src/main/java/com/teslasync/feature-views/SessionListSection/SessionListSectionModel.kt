// Pure, framework-free model + projection for the SessionListSection feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/charging/components/charging-list/SessionListSection.tsx together with its sibling
// `helpers.ts` + `@/lib/chargingAggregation` predicates it leans on). No Compose, no Android framework, no
// HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web component is purely presentational: its parent (the Charging page) owns the filtered/sorted/paged
// `ChargingSession[]`, the search/charger/sort/page state, and the bulk-selection plumbing, and passes them
// down. From those props the component renders a search bar + active-filter chips, a charger-filter + sort +
// export control row, a bulk-actions toolbar, the list of session cards, and pagination. This file owns the
// parts the web expresses inline or borrows from its helpers: the charger categorization, the per-session
// duration / average-power / cost-per-kWh / battery-friendly score, the already-formatted row strings each
// card shows, the web pagination `total` formula, and the lifecycle projection onto the shared
// cache-then-network [UiState] (P1/S8) so the surface renders every state that layer can carry.
// `fmtNumber` mirrors the web `Intl.NumberFormat` half-away-from-zero rounding rather than Java's default
// banker's rounding.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SessionListSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.sessionlistsection

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/** Em dash shown for an absent value — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Default currency symbol when the settings document has none (web `useFormatting` `'$'`). */
internal const val DEFAULT_CURRENCY: String = "$"

/** Energy unit symbol — the web literal `kWh` (a unit symbol, never translated). */
internal const val UNIT_KWH: String = "kWh"

/** Power unit symbol — the web literal `kW` (a unit symbol, never translated). */
internal const val UNIT_KW: String = "kW"

/** Energy fraction digits — the web `fmtWithUnit(energyKwh, 'kWh')` precision. */
internal const val ENERGY_DECIMALS: Int = 1

/** Power fraction digits — the web `fmtNumber(power / 1000)` precision. */
internal const val POWER_DECIMALS: Int = 1

/** Cost fraction digits — the web `formatCurrency(cost)` literal precision. */
internal const val COST_DECIMALS: Int = 2

private const val WH_PER_KWH: Double = 1000.0
private const val W_PER_KW: Double = 1000.0
private const val MILLIS_PER_MINUTE: Double = 60_000.0
private const val MINUTES_PER_HOUR: Double = 60.0
private const val APPROX_PREFIX: String = "~"
private const val PER_KWH_SUFFIX: String = "/$UNIT_KWH"

// ── Battery-friendly score thresholds (web ChargingSessionCard inline score) ────────────────────────────
private const val SCORE_BASE: Int = 50
private const val SCORE_MIN: Int = 0
private const val SCORE_MAX: Int = 100
private const val SOC_LOW: Double = 30.0
private const val SOC_MID: Double = 50.0
private const val SOC_HIGH: Double = 70.0
private const val SOC_SWEET_END: Double = 80.0
private const val SOC_HIGH_END: Double = 90.0
private const val SOC_FULL: Double = 100.0
private const val START_LOW_BONUS: Int = 30
private const val START_MID_BONUS: Int = 15
private const val START_HIGH_PENALTY: Int = 10
private const val END_SWEET_BONUS: Int = 20
private const val END_HIGH_PENALTY: Int = 10
private const val END_FULL_PENALTY: Int = 25

/** The coarse charger category — a verbatim port of web `@/lib/chargingAggregation` `ChargerCategory`. */
enum class ChargerCategory { Home, Supercharger, Dc, Unknown }

/** The sortable session field — the web `SortKey` (`'date' | 'energy' | 'cost' | 'duration' | 'power'`). */
enum class SortKey(
    val wire: String,
) {
    Date("date"),
    Energy("energy"),
    Cost("cost"),
    Duration("duration"),
    Power("power"),
    ;

    companion object {
        /** Resolves a [SortKey] from its [wire] value, defaulting to [Date] for any unknown token. */
        fun fromWire(value: String?): SortKey = entries.firstOrNull { it.wire == value } ?: Date
    }
}

/** The charger filter — the web `ChargerFilter` (`'all' | 'home' | 'supercharger' | 'dc'`). */
enum class ChargerFilter(
    val wire: String,
) {
    All("all"),
    Home("home"),
    Supercharger("supercharger"),
    Dc("dc"),
    ;

    companion object {
        /** Resolves a [ChargerFilter] from its [wire] value, defaulting to [All] for any unknown token. */
        fun fromWire(value: String?): ChargerFilter = entries.firstOrNull { it.wire == value } ?: All
    }
}

/**
 * The decoded slice of a web `ChargingSession` this surface renders — only the SI-canonical fields the list
 * row + the host's filter/sort read. Nullable fields mirror the web optionals; energy is watt-hours and
 * power is watts (Phase-48 SI canonical), converted to display units only at the projection boundary.
 */
data class ChargingSessionItem(
    val id: Long,
    val startedAt: String?,
    val endedAt: String?,
    val chargerType: String?,
    val totalEnergyAddedWh: Double,
    val peakPowerW: Double?,
    val avgPowerW: Double?,
    val costDecimal: Double?,
    val startSocPct: Double?,
    val endSocPct: Double?,
    val startPlace: String?,
    val startLat: Double?,
    val startLng: Double?,
)

/**
 * The already-formatted, framework-free projection of one [ChargingSessionItem] — the native mirror of the
 * web `ChargingSessionCard` content. The composable renders these verbatim plus the raw SoC/score/location
 * values (handed to the shared BatteryDelta / ScoreBadge / RouteDisplay composables), so all formatting is
 * covered off-device by the unit gate.
 *
 * @property timeText localized start timestamp (web `TimeStamp value={started_at}`), or "—".
 * @property durationText "Xh Ym" / "Zm" elapsed (web `formatDurationMinutes`), or null when not elapsed.
 * @property category the charger category driving the badge label + tone.
 * @property energyText "12.3 kWh" when energy was added (web energy badge), else null.
 * @property peakPowerText "48.6 kW" when a peak is known (web peak InlineMetric), else null.
 * @property avgPowerText "~32.0 kW" when an average is computable (web avg InlineMetric), else null.
 * @property costText currency-formatted cost when paid (web cost InlineMetric), else null.
 * @property costPerKwhText "$0.32/kWh" when computable (web cpk caption), else null.
 * @property score battery-friendly score 0–100 (web leading ScoreBadge), or null when SoC is missing.
 */
data class SessionRowView(
    val id: Long,
    val timeText: String,
    val durationText: String?,
    val category: ChargerCategory,
    val energyText: String?,
    val peakPowerText: String?,
    val avgPowerText: String?,
    val costText: String?,
    val costPerKwhText: String?,
    val score: Double?,
    val startSocPct: Double?,
    val endSocPct: Double?,
    val startPlace: String?,
    val startLat: Double?,
    val startLng: Double?,
)

/**
 * Pure projection from the surface's inputs to its render state — a 1:1 port of the web component's inline
 * derivations, the helpers it borrows, and its value formatting. Stateless and side-effect-free so it is
 * fully covered by the off-device unit gate; the composable only resolves localized strings, accents, and
 * glyphs and draws what these return.
 */
object SessionListProjection {
    /**
     * Maps the section's `(sessions, isLoading)` props onto the shared cache-then-network [UiState] (P1/S8),
     * preserving web precedence: loading wins outright; otherwise a null/empty source is the "no charging
     * sessions yet" empty; otherwise content (where an empty *filtered* result renders the "no matches"
     * empty inside the populated controls).
     */
    fun projectUiState(
        sessions: List<ChargingSessionItem>?,
        isLoading: Boolean,
    ): UiState<List<ChargingSessionItem>> =
        when {
            isLoading -> UiState.loading()
            sessions.isNullOrEmpty() -> UiState(phase = UiPhase.Empty, data = sessions)
            else -> UiState(phase = UiPhase.Content, data = sessions)
        }

    /**
     * Maps a raw `charger_type` into a coarse [ChargerCategory] — a verbatim port of web
     * `getChargerCategory` (a null type historically means home AC).
     */
    fun getChargerCategory(type: String?): ChargerCategory {
        if (type.isNullOrEmpty()) return ChargerCategory.Home
        val t = type.lowercase(Locale.ROOT)
        return when {
            t.contains("super") || t.contains("tpc") -> ChargerCategory.Supercharger
            t.contains("dc") || t.contains("ccs") || t.contains("chademo") || t.contains("fast") -> ChargerCategory.Dc
            t.contains("home") || t.contains("ac") || t.contains("wall") -> ChargerCategory.Home
            else -> ChargerCategory.Unknown
        }
    }

    /**
     * Elapsed minutes between [startedAt] and [endedAt] — a verbatim port of web `durationMinutes`. Returns 0
     * for in-progress / malformed / non-positive ranges so nothing propagates `NaN`.
     */
    fun durationMinutes(
        startedAt: String?,
        endedAt: String?,
    ): Double {
        val start = parseEpochMillis(startedAt)
        val end = parseEpochMillis(endedAt)
        return if (start == null || end == null || end <= start) 0.0 else (end - start) / MILLIS_PER_MINUTE
    }

    /**
     * Average power in watts — a verbatim port of web `avgPowerW`: energy added over elapsed hours, falling
     * back to the API `avg_power_w` and finally 0.
     */
    fun avgPowerW(item: ChargingSessionItem): Double {
        val minutes = durationMinutes(item.startedAt, item.endedAt)
        if (minutes > 0.0 && item.totalEnergyAddedWh > 0.0) {
            return item.totalEnergyAddedWh / (minutes / MINUTES_PER_HOUR)
        }
        return item.avgPowerW ?: 0.0
    }

    /**
     * Cost per kWh for a single session — a verbatim port of web `costPerKwh`; null when free / unknown /
     * zero-energy.
     */
    fun costPerKwh(item: ChargingSessionItem): Double? {
        val cost = item.costDecimal
        return if (item.totalEnergyAddedWh <= 0.0 || cost == null || cost <= 0.0) {
            null
        } else {
            cost / (item.totalEnergyAddedWh / WH_PER_KWH)
        }
    }

    /**
     * Battery-friendly score 0–100 for one session — a verbatim port of the web `ChargingSessionCard` inline
     * heuristic (reward a low start + a sweet-spot ≤80% end; penalise high starts and a 100% finish). Null
     * when either SoC endpoint is missing.
     */
    fun sessionScore(
        startPct: Double?,
        endPct: Double?,
    ): Double? {
        if (startPct == null || endPct == null) return null
        var score = SCORE_BASE
        score +=
            when {
                startPct <= SOC_LOW -> START_LOW_BONUS
                startPct <= SOC_MID -> START_MID_BONUS
                startPct <= SOC_HIGH -> 0
                else -> -START_HIGH_PENALTY
            }
        score +=
            when {
                endPct <= SOC_SWEET_END -> END_SWEET_BONUS
                endPct <= SOC_HIGH_END -> 0
                endPct < SOC_FULL -> -END_HIGH_PENALTY
                else -> -END_FULL_PENALTY
            }
        return score.coerceIn(SCORE_MIN, SCORE_MAX) + 0.0
    }

    /**
     * The pagination `total` a `page`-sized window implies — a verbatim port of the web component's formula:
     * a short final page reports the exact count seen so far, otherwise it reports one past the current page
     * so a "next" affordance stays enabled (the host owns true server-side paging).
     */
    fun paginationTotal(
        page: Int,
        pageSize: Int,
        filteredCount: Int,
    ): Int {
        val safePage = page.coerceAtLeast(1)
        val safeSize = pageSize.coerceAtLeast(1)
        return if (filteredCount < safeSize) {
            (safePage - 1) * safeSize + filteredCount
        } else {
            safePage * safeSize + 1
        }
    }

    /**
     * Filters by charger category + a case-insensitive location/charger-type query, then sorts — a verbatim
     * port of web `helpers.ts::filterAndSortSessions`. The base comparator orders each metric descending;
     * [sortDesc] keeps that order, otherwise it is reversed (web `sortDesc ? cmp : -cmp`).
     */
    fun filterAndSort(
        sessions: List<ChargingSessionItem>,
        chargerFilter: ChargerFilter,
        sortBy: SortKey,
        sortDesc: Boolean,
        query: String,
    ): List<ChargingSessionItem> {
        val category = chargerFilter.toCategory()
        val q = query.trim().lowercase(Locale.ROOT)
        val filtered =
            sessions.filter { item ->
                (category == null || getChargerCategory(item.chargerType) == category) &&
                    (q.isEmpty() || matchesQuery(item, q))
            }
        val comparator = sortComparator(sortBy)
        return filtered.sortedWith(if (sortDesc) comparator else comparator.reversed())
    }

    /** The current page window of [items] — a stable sublist for the 1-based [page] at [pageSize]. */
    fun pageItems(
        items: List<ChargingSessionItem>,
        page: Int,
        pageSize: Int,
    ): List<ChargingSessionItem> {
        val safeSize = pageSize.coerceAtLeast(1)
        val from = ((page.coerceAtLeast(1) - 1) * safeSize).coerceIn(0, items.size)
        val to = (from + safeSize).coerceAtMost(items.size)
        return items.subList(from, to)
    }

    /**
     * Projects one [ChargingSessionItem] into its already-formatted [SessionRowView] — the native mirror of
     * the web `ChargingSessionCard`. [currencySymbol] formats the cost (web `useFormatting`), [locale] every
     * number, and [formatTime] the start timestamp (web `TimeStamp`; injected so the projection stays
     * zone-free and deterministic under test).
     */
    fun row(
        item: ChargingSessionItem,
        currencySymbol: String,
        locale: Locale,
        formatTime: (String) -> String,
    ): SessionRowView {
        val minutes = durationMinutes(item.startedAt, item.endedAt)
        val energyKwh = item.totalEnergyAddedWh / WH_PER_KWH
        val peak = item.peakPowerW
        val avg = avgPowerW(item)
        val cost = item.costDecimal
        val cpk = costPerKwh(item)
        return SessionRowView(
            id = item.id,
            timeText = item.startedAt?.let(formatTime)?.takeIf { it.isNotBlank() } ?: EM_DASH,
            durationText = if (minutes > 0.0) formatDurationMinutes(minutes, locale) else null,
            category = getChargerCategory(item.chargerType),
            energyText = if (energyKwh > 0.0) "${fmtNumber(energyKwh, ENERGY_DECIMALS, locale)} $UNIT_KWH" else null,
            peakPowerText = peak?.let { "${fmtNumber(it / W_PER_KW, POWER_DECIMALS, locale)} $UNIT_KW" },
            avgPowerText =
                if (avg > 0.0) "$APPROX_PREFIX${fmtNumber(avg / W_PER_KW, POWER_DECIMALS, locale)} $UNIT_KW" else null,
            costText = if (cost != null && cost > 0.0) formatCurrency(cost, currencySymbol, COST_DECIMALS, locale) else null,
            costPerKwhText = cpk?.let { "${formatCurrency(it, currencySymbol, COST_DECIMALS, locale)}$PER_KWH_SUFFIX" },
            score = sessionScore(item.startSocPct, item.endSocPct),
            startSocPct = item.startSocPct,
            endSocPct = item.endSocPct,
            startPlace = item.startPlace,
            startLat = item.startLat,
            startLng = item.startLng,
        )
    }

    /**
     * Decodes a raw `/charging` document into the typed [ChargingSessionItem] list this surface reads — the
     * native port of the web prop wiring. Accepts a bare array or an object wrapping the rows under
     * `sessions` / `data` / `items`; any missing/malformed field degrades to a null/zero so a partial payload
     * never throws, and the received order is preserved.
     */
    fun parse(document: JsonElement?): List<ChargingSessionItem> {
        val array =
            when (document) {
                is JsonArray -> document
                is JsonObject ->
                    document.array(KEY_SESSIONS)
                        ?: document.array(KEY_DATA)
                        ?: document.array(KEY_ITEMS)
                        ?: JsonArray(emptyList())
                else -> JsonArray(emptyList())
            }
        return array.mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val id = obj.long(KEY_ID) ?: return@mapNotNull null
            ChargingSessionItem(
                id = id,
                startedAt = obj.string(KEY_STARTED_AT),
                endedAt = obj.string(KEY_ENDED_AT),
                chargerType = obj.string(KEY_CHARGER_TYPE),
                totalEnergyAddedWh = obj.double(KEY_TOTAL_ENERGY_ADDED_WH) ?: 0.0,
                peakPowerW = obj.double(KEY_PEAK_POWER_W),
                avgPowerW = obj.double(KEY_AVG_POWER_W),
                costDecimal = obj.double(KEY_COST_DECIMAL),
                startSocPct = obj.double(KEY_START_SOC_PCT),
                endSocPct = obj.double(KEY_END_SOC_PCT),
                startPlace = obj.string(KEY_START_PLACE),
                startLat = obj.double(KEY_START_LAT),
                startLng = obj.double(KEY_START_LNG),
            )
        }
    }

    /**
     * Locale-aware "Xh Ym" / "Zm" elapsed-minutes label — a port of the web `formatDurationMinutes`. Minutes
     * are rounded to whole numbers (web `formatRoundedInt`); a negative/non-finite input yields the em dash.
     */
    fun formatDurationMinutes(
        minutes: Double,
        locale: Locale,
    ): String {
        if (!minutes.isFinite() || minutes < 0.0) return EM_DASH
        val whole = minutes.roundToInt()
        val hours = whole / MINUTES_PER_HOUR.toInt()
        val mins = whole % MINUTES_PER_HOUR.toInt()
        return if (hours > 0) {
            String.format(locale, "%dh %dm", hours, mins)
        } else {
            String.format(locale, "%dm", mins)
        }
    }

    /**
     * Locale-aware fixed-precision formatting — the native mirror of the web `fmtNumber(value, decimals)`
     * (`Intl.NumberFormat` with equal min/max fraction digits, grouped thousands, half away from zero). A
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
            .format(if (value.isFinite()) value else 0.0)
    }

    /**
     * Currency formatting — the web `useFormatting` `currencySymbol + fmtNumber(amount, decimals)` contract.
     * A blank symbol falls back to `$`; a non-finite amount normalizes to 0.
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        decimals: Int,
        locale: Locale,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${fmtNumber(amount, decimals, locale)}"

    /**
     * Resolves the user's currency symbol from the raw `/settings` document — the native port of the web
     * `useFormatting` read (defaulting to `$` before settings load).
     */
    fun currencySymbol(settings: JsonElement?): String {
        val raw = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
        val symbol = raw?.contentOrNull?.trim()
        return if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY
    }

    private fun parseEpochMillis(iso: String?): Long? {
        if (iso.isNullOrBlank()) return null
        return runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()
    }

    private fun matchesQuery(
        item: ChargingSessionItem,
        query: String,
    ): Boolean {
        val place = item.startPlace?.lowercase(Locale.ROOT) ?: ""
        val type = item.chargerType?.lowercase(Locale.ROOT) ?: ""
        return place.contains(query) || type.contains(query)
    }

    private fun sortComparator(sortBy: SortKey): Comparator<ChargingSessionItem> =
        when (sortBy) {
            SortKey.Date -> compareByDescending { parseEpochMillis(it.startedAt) ?: Long.MIN_VALUE }
            SortKey.Energy -> compareByDescending { it.totalEnergyAddedWh }
            SortKey.Cost -> compareByDescending { it.costDecimal ?: 0.0 }
            SortKey.Duration -> compareByDescending { durationMinutes(it.startedAt, it.endedAt) }
            SortKey.Power -> compareByDescending { it.peakPowerW ?: 0.0 }
        }

    private fun ChargerFilter.toCategory(): ChargerCategory? =
        when (this) {
            ChargerFilter.All -> null
            ChargerFilter.Home -> ChargerCategory.Home
            ChargerFilter.Supercharger -> ChargerCategory.Supercharger
            ChargerFilter.Dc -> ChargerCategory.Dc
        }

    private fun JsonObject.array(key: String): JsonArray? = this[key] as? JsonArray

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

    private fun JsonObject.double(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

    private fun JsonObject.long(key: String): Long? {
        val primitive = this[key] as? JsonPrimitive ?: return null
        return primitive.longOrNull ?: primitive.doubleOrNull?.roundToLong()
    }

    private const val KEY_SESSIONS = "sessions"
    private const val KEY_DATA = "data"
    private const val KEY_ITEMS = "items"
    private const val KEY_ID = "id"
    private const val KEY_STARTED_AT = "started_at"
    private const val KEY_ENDED_AT = "ended_at"
    private const val KEY_CHARGER_TYPE = "charger_type"
    private const val KEY_TOTAL_ENERGY_ADDED_WH = "total_energy_added_wh"
    private const val KEY_PEAK_POWER_W = "peak_power_w"
    private const val KEY_AVG_POWER_W = "avg_power_w"
    private const val KEY_COST_DECIMAL = "cost_decimal"
    private const val KEY_START_SOC_PCT = "start_soc_pct"
    private const val KEY_END_SOC_PCT = "end_soc_pct"
    private const val KEY_START_PLACE = "start_place"
    private const val KEY_START_LAT = "start_lat"
    private const val KEY_START_LNG = "start_lng"
    private const val KEY_CURRENCY_SYMBOL = "currency_symbol"
}

/**
 * Localized start-timestamp formatting for a session row — the native analogue of the web `TimeStamp`. Kept
 * out of the pure projection (which receives it as a function) because it depends on the device [ZoneId];
 * still framework-free (java.time) so it is unit-testable off-device.
 */
object SessionListTimeFormatting {
    /** Formats an ISO-8601 instant as a localized short date+time in [zoneId], or "—" when unparseable. */
    fun format(
        iso: String?,
        zoneId: ZoneId,
        locale: Locale,
    ): String {
        val instant = iso?.takeIf { it.isNotBlank() }?.let { runCatching { Instant.parse(it) }.getOrNull() }
        return instant?.let {
            DateTimeFormatter
                .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
                .withLocale(locale)
                .withZone(zoneId)
                .format(it)
        } ?: EM_DASH
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * location, energy, cost, or session id — so a diagnostics line can never leak the fleet's charging habits.
 */
object SessionListSectionDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "SessionListSection"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
