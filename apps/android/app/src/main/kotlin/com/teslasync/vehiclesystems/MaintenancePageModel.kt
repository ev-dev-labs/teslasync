// Pure, framework-free model + projections for the MaintenancePage vehicle-systems surface (P3-ANDROID A7) — the
// native analogue of everything web/src/features/vehicle-systems/pages/MaintenancePage.tsx derives before composing
// its panels. No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the
// shared-core net JSON, the framework-free ChartFormat number helper, the android UnitPreferences settings reader,
// and java.time), so the composable stays a thin render layer and all of this stays unit-testable off-device.
//
// The web page reads two backend feeds — `request('/maintenance')` (items) and `request('/maintenance/records')`
// (service records), both gated on a selected vehicle — then renders: four summary metric cards (total / due-soon /
// overdue / completed), a category + sort toolbar, a grid of per-item progress cards, a cost-summary panel (total /
// annual-estimate / avg-per-service) with an EV-savings note, a service-projections panel, and a service-records
// table. This file ports the page's value derivations verbatim: the per-item progress math, the status derivation,
// the summary reduction, the category/sort transforms, the cost statistics, and the projection ranking.
//
// Labels stay at the Compose boundary (they resolve from the generated res/values i18n catalog, ADR-014); this model
// produces only the formatted values + the semantic enums (status / accent) the render layer maps to design tokens.
// Mileage values are rendered verbatim with the localized "mi" label exactly as the web page does (it applies no SI
// conversion on this surface); currency is symbol + grouped number at the user's precision (web `formatCurrency`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.maintenance

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.defaultApiJson
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics — the native mirror of the web `MaintenancePage`
 * route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("maintenance", "/maintenance", NavGroup.VehicleSystems)`, so [io.teslasync.android.navigation.PageHosts] binds
 * this surface to that destination (and its `/maintenance` deep link) without the nav module depending on it.
 */
object MaintenancePageRegistration {
    /** The navigation destination id (Destinations.kt `page("maintenance", "/maintenance", …)`). */
    const val ROUTE_ID: String = "maintenance"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/maintenance"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "MaintenancePage"

    /** The maintenance-items feed path (web `request('/maintenance')`); the client adds `/api/v1` once. */
    const val ITEMS_PATH: String = "/maintenance"

    /** The service-records feed path (web `request('/maintenance/records')`). */
    const val RECORDS_PATH: String = "/maintenance/records"
}

// ── Wire DTOs (web MaintenanceItem / ServiceRecord) ───────────────────────────────────────────────────────────────

/**
 * One decoded `/maintenance` item (web `MaintenanceItem`). Mileage fields are rendered verbatim (the web surface
 * applies no SI conversion); nullable wire fields default so a sparse payload never fails to decode.
 */
@Serializable
data class MaintenanceItem(
    @SerialName("id") val id: Long = 0L,
    @SerialName("vehicle_id") val vehicleId: Long = 0L,
    @SerialName("category") val category: String = "",
    @SerialName("name") val name: String = "",
    @SerialName("description") val description: String = "",
    @SerialName("due_date") val dueDate: String? = null,
    @SerialName("due_mileage") val dueMileage: Double? = null,
    @SerialName("current_mileage") val currentMileage: Double = 0.0,
    @SerialName("last_service_date") val lastServiceDate: String? = null,
    @SerialName("last_service_mileage") val lastServiceMileage: Double? = null,
    @SerialName("interval_months") val intervalMonths: Double? = null,
    @SerialName("interval_miles") val intervalMiles: Double? = null,
    @SerialName("status") val status: String = "",
    @SerialName("created_at") val createdAt: String = "",
)

/** One decoded `/maintenance/records` service record (web `ServiceRecord`). */
@Serializable
data class ServiceRecord(
    @SerialName("id") val id: Long = 0L,
    @SerialName("vehicle_id") val vehicleId: Long = 0L,
    @SerialName("date") val date: String = "",
    @SerialName("description") val description: String = "",
    @SerialName("mileage") val mileage: Double = 0.0,
    @SerialName("cost") val cost: Double = 0.0,
    @SerialName("provider") val provider: String = "",
    @SerialName("notes") val notes: String = "",
    @SerialName("created_at") val createdAt: String = "",
)

// ── Semantic enums (status / badge tone / accents) ────────────────────────────────────────────────────────────────

/** The badge tone the render layer maps to a colored chip (web `Badge variant`). */
enum class MaintenanceBadgeTone { Success, Warning, Danger, Info }

/**
 * The maintenance status (web `MaintenanceStatus`). [sortOrder] reproduces the web `STATUS_SORT_ORDER`
 * (overdue → soon → good → completed); [tone] reproduces the web `STATUS_BADGE_MAP` variant.
 */
enum class MaintenanceStatus(val sortOrder: Int, val tone: MaintenanceBadgeTone) {
    Overdue(0, MaintenanceBadgeTone.Danger),
    Soon(1, MaintenanceBadgeTone.Warning),
    Good(2, MaintenanceBadgeTone.Success),
    Completed(3, MaintenanceBadgeTone.Info),
    ;

    companion object {
        /** Maps a raw wire status (`good`/`soon`/`overdue`/`completed`) to the enum; anything else is [Good]. */
        fun fromWire(raw: String?): MaintenanceStatus =
            when (raw?.trim()?.lowercase(Locale.US)) {
                "overdue" -> Overdue
                "soon" -> Soon
                "completed" -> Completed
                else -> Good
            }
    }
}

/** The category chip accent (web `CATEGORY_COLORS`); the render layer maps it to a design-token color. */
enum class MaintenanceCategoryAccent { Cyan, Red, Green, Amber, Purple, Neutral }

/** The progress-bar accent (web `progressBarColor`); the render layer maps it to a design-token color. */
enum class MaintenanceProgressAccent { Green, Amber, Red }

// ── Boundary constants ────────────────────────────────────────────────────────────────────────────────────────────

/** Em dash shown for a missing value (web `?? '—'`). */
const val MAINTENANCE_EM_DASH: String = "\u2014"

private const val PCT_FULL = 100.0
private const val PCT_OVERDUE = 90.0
private const val PCT_SOON = 70.0
private const val DAYS_PER_MONTH = 30.44
private const val MILLIS_PER_DAY = 24.0 * 60.0 * 60.0 * 1000.0
private const val MILLIS_PER_YEAR = 365.25 * 24.0 * 3600.0 * 1000.0
private const val MIN_SPAN_YEARS = 0.1
private const val MAX_PROJECTIONS = 8
private const val DATE_PREFIX_LENGTH = 10

/** The un-internationalized per-year suffix on the annual-estimate card (web `\`${…}/yr\``); no i18n key exists. */
private const val PER_YEAR_SUFFIX = "/yr"

/** The literal percent suffix on the progress readout (web `\`${fmtNumber(pct,0)}%\``); not an i18n key on the web. */
private const val PERCENT_SUFFIX = "%"

private val CATEGORY_ACCENTS: Map<String, MaintenanceCategoryAccent> =
    mapOf(
        "tires" to MaintenanceCategoryAccent.Cyan,
        "brakes" to MaintenanceCategoryAccent.Red,
        "battery" to MaintenanceCategoryAccent.Green,
        "filters" to MaintenanceCategoryAccent.Amber,
        "fluids" to MaintenanceCategoryAccent.Purple,
        "wipers" to MaintenanceCategoryAccent.Cyan,
        "alignment" to MaintenanceCategoryAccent.Amber,
        "general" to MaintenanceCategoryAccent.Neutral,
    )

/** The accent for a category chip (web `categoryBgClass`); an unknown category is [MaintenanceCategoryAccent.Neutral]. */
fun categoryAccentOf(category: String): MaintenanceCategoryAccent =
    CATEGORY_ACCENTS[category.trim().lowercase(Locale.US)] ?: MaintenanceCategoryAccent.Neutral

// ── Progress + status math (web computeProgress / statusFromPct) ──────────────────────────────────────────────────

/**
 * The completion percentage of [item] in 0–100 (web `computeProgress`): mileage interval first, then a months
 * interval against [nowMillis], then a bare due-mileage ratio, else 0. Always clamped to 0–100.
 */
fun computeProgress(
    item: MaintenanceItem,
    nowMillis: Long,
): Double {
    val intervalMiles = item.intervalMiles
    val lastMileage = item.lastServiceMileage
    if (intervalMiles != null && intervalMiles > 0.0 && lastMileage != null) {
        val elapsed = item.currentMileage - lastMileage
        return ((elapsed / intervalMiles) * PCT_FULL).coerceIn(0.0, PCT_FULL)
    }
    val intervalMonths = item.intervalMonths
    val lastDate = item.lastServiceDate
    if (intervalMonths != null && intervalMonths > 0.0 && !lastDate.isNullOrBlank()) {
        val lastMs = parseEpochMillis(lastDate)
        if (lastMs != null) {
            val intervalMs = intervalMonths * DAYS_PER_MONTH * MILLIS_PER_DAY
            return if (intervalMs > 0.0) {
                (((nowMillis - lastMs) / intervalMs) * PCT_FULL).coerceIn(0.0, PCT_FULL)
            } else {
                0.0
            }
        }
    }
    val dueMileage = item.dueMileage
    if (dueMileage != null && dueMileage > 0.0) {
        return ((item.currentMileage / dueMileage) * PCT_FULL).coerceIn(0.0, PCT_FULL)
    }
    return 0.0
}

/** Derives a status from a completion percentage (web `statusFromPct`): ≥90 overdue, ≥70 soon, else good. */
fun statusFromPct(pct: Double): MaintenanceStatus =
    when {
        pct >= PCT_OVERDUE -> MaintenanceStatus.Overdue
        pct >= PCT_SOON -> MaintenanceStatus.Soon
        else -> MaintenanceStatus.Good
    }

/** The progress-bar accent for a percentage (web `progressBarColor`): ≥90 red, ≥70 amber, else green. */
fun progressAccentOf(pct: Double): MaintenanceProgressAccent =
    when {
        pct >= PCT_OVERDUE -> MaintenanceProgressAccent.Red
        pct >= PCT_SOON -> MaintenanceProgressAccent.Amber
        else -> MaintenanceProgressAccent.Green
    }

/** The badge status of an item card (web `item.status === 'completed' ? 'completed' : statusFromPct(pct)`). */
fun cardStatus(
    item: MaintenanceItem,
    nowMillis: Long,
): MaintenanceStatus =
    if (MaintenanceStatus.fromWire(item.status) == MaintenanceStatus.Completed) {
        MaintenanceStatus.Completed
    } else {
        statusFromPct(computeProgress(item, nowMillis))
    }

// ── Summary, filtering, sorting (web summary / filteredItems) ─────────────────────────────────────────────────────

/** The four summary counts (web `summary`). Counts use the RAW wire status, exactly as the web reduction does. */
data class MaintenanceSummary(
    val total: Int,
    val soon: Int,
    val overdue: Int,
    val completed: Int,
) {
    companion object {
        val EMPTY: MaintenanceSummary = MaintenanceSummary(0, 0, 0, 0)
    }
}

/** Reduces items into the summary counts (web `items.reduce(...)`), keyed off the raw wire status. */
fun summarize(items: List<MaintenanceItem>): MaintenanceSummary {
    var soon = 0
    var overdue = 0
    var completed = 0
    for (item in items) {
        when (MaintenanceStatus.fromWire(item.status)) {
            MaintenanceStatus.Soon -> soon++
            MaintenanceStatus.Overdue -> overdue++
            MaintenanceStatus.Completed -> completed++
            MaintenanceStatus.Good -> Unit
        }
    }
    return MaintenanceSummary(total = items.size, soon = soon, overdue = overdue, completed = completed)
}

/** The sort keys the toolbar offers (web `SORT_OPTIONS`). */
enum class MaintenanceSortKey { Status, Name, DueDate, Category }

/** The category filter (web `categoryFilter`): all categories, or one specific category. */
sealed interface MaintenanceCategoryFilter {
    data object All : MaintenanceCategoryFilter

    data class Only(val category: String) : MaintenanceCategoryFilter
}

/** The toolbar's local UI state — the selected category filter + sort key (web `categoryFilter` + `sortBy`). */
data class MaintenanceFilterState(
    val category: MaintenanceCategoryFilter = MaintenanceCategoryFilter.All,
    val sort: MaintenanceSortKey = MaintenanceSortKey.Status,
)

/** The unique categories present, sorted ascending (web `categories`). */
fun categoriesOf(items: List<MaintenanceItem>): List<String> =
    items.map { it.category }.filter { it.isNotBlank() }.distinct().sorted()

/** Filters by the selected category (web `categoryFilter !== 'all'` guard). */
fun filterItems(
    items: List<MaintenanceItem>,
    filter: MaintenanceCategoryFilter,
): List<MaintenanceItem> =
    when (filter) {
        is MaintenanceCategoryFilter.All -> items
        is MaintenanceCategoryFilter.Only -> items.filter { it.category == filter.category }
    }

/** Sorts items by the selected key (web `sortItems`): status order, name, due-date (nulls last), or category. */
fun sortItems(
    items: List<MaintenanceItem>,
    key: MaintenanceSortKey,
): List<MaintenanceItem> =
    when (key) {
        MaintenanceSortKey.Status ->
            items.sortedBy { MaintenanceStatus.fromWire(it.status).sortOrder }

        MaintenanceSortKey.Name ->
            items.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })

        MaintenanceSortKey.DueDate ->
            items.sortedBy { parseEpochMillis(it.dueDate) ?: Long.MAX_VALUE }

        MaintenanceSortKey.Category ->
            items.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.category })
    }

// ── Cost statistics (web costStats) ───────────────────────────────────────────────────────────────────────────────

/** The cost summary derived from service records (web `costStats`), or null when there are no records. */
data class MaintenanceCostStats(
    val totalCost: Double,
    val annualCost: Double,
    val avgPerService: Double,
)

/**
 * The cost statistics over [records] (web `costStats`): the total, the per-year estimate (using the record date
 * span, floored at 0.1 yr; total when fewer than two dated records), and the per-service average. Null for no records.
 */
fun costStatsOf(records: List<ServiceRecord>): MaintenanceCostStats? {
    if (records.isEmpty()) return null
    val totalCost = records.sumOf { it.cost }
    val dates = records.mapNotNull { parseEpochMillis(it.date) }
    if (dates.size < 2) {
        return MaintenanceCostStats(
            totalCost = totalCost,
            annualCost = totalCost,
            avgPerService = totalCost / records.size,
        )
    }
    val spanYears = ((dates.max() - dates.min()) / MILLIS_PER_YEAR).coerceAtLeast(MIN_SPAN_YEARS)
    return MaintenanceCostStats(
        totalCost = totalCost,
        annualCost = totalCost / spanYears,
        avgPerService = totalCost / records.size,
    )
}

// ── Projections (web projections) ─────────────────────────────────────────────────────────────────────────────────

/** One upcoming-service projection (web `projections[]`), already ranked and capped to the top eight. */
data class MaintenanceProjection(
    val name: String,
    val category: String,
    val milesRemaining: Double?,
    val dueDateRaw: String?,
    val status: MaintenanceStatus,
)

/**
 * The ranked upcoming-service projections (web `projections`): non-completed items that carry an interval, mapped to
 * their remaining mileage + due date + status, sorted overdue-first then by ascending remaining mileage, top eight.
 */
fun projectionsOf(items: List<MaintenanceItem>): List<MaintenanceProjection> {
    if (items.isEmpty()) return emptyList()
    return items
        .filter { item ->
            MaintenanceStatus.fromWire(item.status) != MaintenanceStatus.Completed &&
                ((item.intervalMiles ?: 0.0) > 0.0 || (item.intervalMonths ?: 0.0) > 0.0)
        }
        .map { item ->
            val milesRemaining =
                item.dueMileage?.let { (it - item.currentMileage).coerceAtLeast(0.0) }
            MaintenanceProjection(
                name = item.name,
                category = item.category,
                milesRemaining = milesRemaining,
                dueDateRaw = item.dueDate?.takeIf { it.isNotBlank() },
                status = MaintenanceStatus.fromWire(item.status),
            )
        }
        .sortedWith(
            compareByDescending<MaintenanceProjection> { it.status == MaintenanceStatus.Overdue }
                .thenBy { it.milesRemaining ?: Double.MAX_VALUE },
        )
        .take(MAX_PROJECTIONS)
}

// ── Display preferences (web useUnits + useFormatting) ────────────────────────────────────────────────────────────

/**
 * The display-boundary helpers the page applies — the Kotlin port of the web page's `useFormatting` (currency symbol
 * + precision) + the locale used for number grouping. Mileage stays verbatim (no SI conversion on this surface, web
 * parity); only the currency symbol + grouping are user-derived.
 *
 * @property currencySymbol the configured currency symbol, never blank (web `currency_symbol` ?? "$").
 * @property precision the currency fraction digits (web `decimal_precision`, floored & >= 0, else 2).
 * @property locale the BCP-47 locale used for number grouping (web global locale).
 */
data class MaintenanceDisplayPrefs(
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    /** A finite number with [decimals] fraction digits + locale grouping (web `fmtNumber`; non-finite → 0). */
    fun number(
        value: Double,
        decimals: Int,
    ): String = ChartFormat.number(if (value.isFinite()) value else 0.0, decimals.coerceAtLeast(0), locale)

    /** Currency of an amount (web `formatCurrency`: symbol + grouped number at [decimals] digits). */
    fun currency(
        amount: Double,
        decimals: Int = precision,
    ): String = currencySymbol + number(amount, decimals)

    companion object {
        private const val DEFAULT_CURRENCY = "$"
        private const val DEFAULT_PRECISION = 2
        private const val DEFAULT_LOCALE_TAG = "en-US"
        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** `$` + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: MaintenanceDisplayPrefs =
            MaintenanceDisplayPrefs(DEFAULT_CURRENCY, DEFAULT_PRECISION, Locale.US)

        /** Resolves the display preferences from the raw `/settings` document (web `useFormatting`). */
        fun fromSettings(settings: JsonElement?): MaintenanceDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol =
                (settings as? JsonObject)?.let { (it[KEY_CURRENCY_SYMBOL] as? JsonPrimitive)?.contentOrNull?.trim() }
            return MaintenanceDisplayPrefs(
                currencySymbol = if (!rawSymbol.isNullOrEmpty()) rawSymbol else DEFAULT_CURRENCY,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = runCatching { Locale.forLanguageTag(unit.locale ?: DEFAULT_LOCALE_TAG) }.getOrDefault(Locale.US),
            )
        }
    }
}

// ── Folded views (the web panel render values) ────────────────────────────────────────────────────────────────────

/** The fully-formatted summary-card values the render layer shows (web summary MetricCards). */
data class MaintenanceSummaryView(
    val total: String,
    val soon: String,
    val overdue: String,
    val completed: String,
)

/** The fold of the summary counts to display strings (the four MetricCard values). */
fun summaryViewOf(summary: MaintenanceSummary): MaintenanceSummaryView =
    MaintenanceSummaryView(
        total = summary.total.toString(),
        soon = summary.soon.toString(),
        overdue = summary.overdue.toString(),
        completed = summary.completed.toString(),
    )

/**
 * The fully-formatted values of one maintenance item card (web `MaintenanceItemCard`). [dueDate] / [dueMileage] are
 * mutually exclusive (date wins, web order); [currentMileage] is null when zero; the bracketed labels ("Due:", "mi")
 * are added at the Compose boundary from the i18n catalog.
 */
data class MaintenanceItemView(
    val category: String,
    val categoryAccent: MaintenanceCategoryAccent,
    val status: MaintenanceStatus,
    val name: String,
    val description: String,
    val showProgress: Boolean,
    val percentText: String,
    val progressFraction: Double,
    val progressAccent: MaintenanceProgressAccent,
    val dueDate: String?,
    val dueMileage: String?,
    val currentMileage: String?,
    val lastServiceDate: String?,
)

/** Folds one SI/raw [item] into its display [MaintenanceItemView] under the user's [prefs] (web render derivations). */
fun deriveItemView(
    item: MaintenanceItem,
    prefs: MaintenanceDisplayPrefs,
    nowMillis: Long,
): MaintenanceItemView {
    val pct = computeProgress(item, nowMillis)
    val status = cardStatus(item, nowMillis)
    val showProgress = status != MaintenanceStatus.Completed
    val dueDate = item.dueDate?.takeIf { it.isNotBlank() }?.let { formatMaintenanceDate(it, prefs.locale) }
    val dueMileage =
        if (dueDate == null && (item.dueMileage ?: 0.0) > 0.0) prefs.number(item.dueMileage ?: 0.0, 0) else null
    return MaintenanceItemView(
        category = item.category,
        categoryAccent = categoryAccentOf(item.category),
        status = status,
        name = item.name,
        description = item.description,
        showProgress = showProgress,
        percentText = prefs.number(pct, 0) + PERCENT_SUFFIX,
        progressFraction = pct.coerceIn(0.0, PCT_FULL) / PCT_FULL,
        progressAccent = progressAccentOf(pct),
        dueDate = dueDate,
        dueMileage = dueMileage,
        currentMileage = if (item.currentMileage > 0.0) prefs.number(item.currentMileage, 0) else null,
        lastServiceDate = item.lastServiceDate?.takeIf { it.isNotBlank() }?.let { formatMaintenanceDate(it, prefs.locale) },
    )
}

/** The fully-formatted cost-summary values (web cost MetricCards). [annualEst] already carries the `/yr` suffix. */
data class MaintenanceCostView(
    val totalSpent: String,
    val annualEst: String,
    val avgService: String,
)

/** Folds the cost statistics to display strings (web `formatCurrency(...)`); the annual estimate gains `/yr`. */
fun costViewOf(
    stats: MaintenanceCostStats,
    prefs: MaintenanceDisplayPrefs,
): MaintenanceCostView =
    MaintenanceCostView(
        totalSpent = prefs.currency(stats.totalCost, 0),
        annualEst = prefs.currency(stats.annualCost, 0) + PER_YEAR_SUFFIX,
        avgService = prefs.currency(stats.avgPerService, 0),
    )

/** The fully-formatted values of one projection row (web projections list). [milesRemaining] omits the "mi" label. */
data class MaintenanceProjectionView(
    val name: String,
    val milesRemaining: String?,
    val dueDate: String?,
    val status: MaintenanceStatus,
)

/** Folds one [projection] to its display row under the user's [prefs] (web projection render derivations). */
fun deriveProjectionView(
    projection: MaintenanceProjection,
    prefs: MaintenanceDisplayPrefs,
): MaintenanceProjectionView =
    MaintenanceProjectionView(
        name = projection.name,
        milesRemaining = projection.milesRemaining?.let { prefs.number(it, 0) },
        dueDate = projection.dueDateRaw?.let { formatMaintenanceDate(it, prefs.locale) },
        status = projection.status,
    )

/** The fully-formatted values of one service-records table row (web `buildServiceColumns`). */
data class MaintenanceRecordRow(
    val id: Long,
    val date: String,
    val description: String,
    val mileage: String,
    val cost: String,
    val provider: String,
)

/** Folds one [record] to its table row under the user's [prefs] (web record column renders). */
fun deriveRecordRow(
    record: ServiceRecord,
    prefs: MaintenanceDisplayPrefs,
): MaintenanceRecordRow =
    MaintenanceRecordRow(
        id = record.id,
        date = formatMaintenanceDateTime(record.date, prefs.locale),
        description = record.description.ifBlank { MAINTENANCE_EM_DASH },
        mileage = prefs.number(record.mileage, 0),
        cost = prefs.currency(record.cost),
        provider = record.provider.ifBlank { MAINTENANCE_EM_DASH },
    )

/** The service-records table column keys (web DataTable `Column.key`), used for sort hoisting + headers. */
const val RECORD_COL_DATE: String = "date"
const val RECORD_COL_DESCRIPTION: String = "description"
const val RECORD_COL_MILEAGE: String = "mileage"
const val RECORD_COL_COST: String = "cost"
const val RECORD_COL_PROVIDER: String = "provider"

/**
 * Sorts service records by a hoisted column [key] + [ascending] direction (web DataTable internal sort): by date
 * instant, mileage, or cost. An unknown / null key leaves the API order untouched.
 */
fun sortServiceRecords(
    records: List<ServiceRecord>,
    key: String?,
    ascending: Boolean,
): List<ServiceRecord> {
    val sorted =
        when (key) {
            RECORD_COL_DATE -> records.sortedBy { parseEpochMillis(it.date) ?: Long.MIN_VALUE }
            RECORD_COL_MILEAGE -> records.sortedBy { it.mileage }
            RECORD_COL_COST -> records.sortedBy { it.cost }
            else -> return records
        }
    return if (ascending) sorted else sorted.reversed()
}

// ── Decoding (web request<MaintenanceItem[]> / request<ServiceRecord[]>) ──────────────────────────────────────────

/** Decodes the `/maintenance` payload into items; a non-array or malformed body decodes to an empty list. */
fun parseItems(json: JsonElement?): List<MaintenanceItem> =
    decodeList(json, ListSerializer(MaintenanceItem.serializer()))

/** Decodes the `/maintenance/records` payload into records; a non-array or malformed body decodes to an empty list. */
fun parseRecords(json: JsonElement?): List<ServiceRecord> =
    decodeList(json, ListSerializer(ServiceRecord.serializer()))

private fun <T> decodeList(
    json: JsonElement?,
    serializer: kotlinx.serialization.KSerializer<List<T>>,
): List<T> {
    val array = json as? JsonArray ?: return emptyList()
    return runCatching { defaultApiJson.decodeFromJsonElement(serializer, array) }.getOrDefault(emptyList())
}

// ── Date formatting (web formatDate / formatDateTime) ─────────────────────────────────────────────────────────────

/**
 * A localized medium-style date for [raw] (web `formatDate`). Accepts an ISO date or date-time; a null / blank /
 * unparseable input renders the em-dash fallback. The trailing-offset local date is taken so it never throws.
 */
fun formatMaintenanceDate(
    raw: String?,
    locale: Locale,
): String {
    val date = parseLocalDate(raw) ?: return MAINTENANCE_EM_DASH
    return date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
}

/**
 * A localized medium date + short time for [raw] (web `formatDateTime`). Falls back to a bare medium date when the
 * input carries no time component, and to the em-dash when it is null / blank / unparseable.
 */
fun formatMaintenanceDateTime(
    raw: String?,
    locale: Locale,
): String {
    if (raw.isNullOrBlank()) return MAINTENANCE_EM_DASH
    val dateTime = parseLocalDateTime(raw)
    if (dateTime != null) {
        return dateTime.format(
            DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale),
        )
    }
    val date = parseLocalDate(raw) ?: return MAINTENANCE_EM_DASH
    return date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
}

private fun parseLocalDate(raw: String?): LocalDate? {
    if (raw.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(raw).toLocalDate() }
        .recoverCatching { LocalDateTime.parse(raw).toLocalDate() }
        .recoverCatching { LocalDate.parse(raw) }
        .recoverCatching { LocalDate.parse(raw.take(DATE_PREFIX_LENGTH)) }
        .getOrNull()
}

private fun parseLocalDateTime(raw: String?): LocalDateTime? {
    if (raw.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(raw).toLocalDateTime() }
        .recoverCatching { LocalDateTime.parse(raw) }
        .getOrNull()
}

/** The epoch-millisecond instant of an ISO date / date-time [raw] (web `new Date(raw).getTime()`), or null. */
private fun parseEpochMillis(raw: String?): Long? {
    if (raw.isNullOrBlank()) return null
    runCatching { return OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
    val date = parseLocalDate(raw) ?: return null
    return date.atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli()
}

// ── Resource value mapping ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags, so the
 * view-model's `JsonElement → model` projection stays unit-testable off-device (sibling A7 precedent).
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }
