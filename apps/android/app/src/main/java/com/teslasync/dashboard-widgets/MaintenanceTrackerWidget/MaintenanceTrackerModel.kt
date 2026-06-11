// Pure, framework-free model + projection for the Maintenance Tracker dashboard widget — the native
// analogue of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/MaintenanceTrackerWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The maintenance schedule + service records arrive as raw SI JSON
// (`/maintenance`, `/maintenance/records`), so this file owns the decode (web optional-chaining →
// null-safe reads) plus the display-boundary distance + currency conversion (Phase-48 SI-canonical rule;
// web `useUnits`/`useFormatting`/`useDateFormat`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/MaintenanceTrackerWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling DrivetrainHealth/CostBreakdown
// widgets do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.maintenancetracker

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatDistance
import kotlinx.serialization.json.JsonArray
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

/** Em dash shown for a missing reading — the web `'—'` fallback for an absent name / record. */
internal const val EM_DASH: String = "\u2014"

/** Default currency symbol when `/settings` carries none (web `useFormatting` `currency_symbol ?? '$'`). */
private const val DEFAULT_CURRENCY: String = "$"

/** Default currency fraction digits (web `useFormatting` `decimal_precision ?? 2`). */
private const val DEFAULT_PRECISION: Int = 2

/** Distance renders as whole units (web `fmtNumber(convertDistanceFromSI(...), 0)`). */
private const val DISTANCE_DECIMALS: Int = 0

/** Recent-service feed cap (web `recentRecords = […].slice(0, 3)`). */
internal const val MAX_RECENT_RECORDS: Int = 3

// Urgency thresholds — the web `getUrgency(months)` map (<=0 overdue, <=3 soon, else good).
private const val URGENCY_OVERDUE_MAX_MONTHS: Double = 0.0
private const val URGENCY_SOON_MAX_MONTHS: Double = 3.0

/**
 * Web `(intervalKm ?? 0) * 0.621371` / `(odometerKm ?? 0) * 0.621371`: the kilometre→mile factor the web
 * applies before handing the value to `convertDistanceFromSI`. Reproduced verbatim for value-faithful
 * parity. Note: the Go `/maintenance` handler serves `interval_miles` (NOT `interval_km`) and never an
 * `estimated_cost_usd`, and `/maintenance/records` always returns `[]`; the web reads `intervalKm`/
 * `odometerKm` (absent on the wire) so it renders `0`, and this port reads the same absent keys so it
 * renders `0` too — exact parity with the deployed backend, not a silent divergence.
 */
private const val WEB_KM_TO_MI_FACTOR: Double = 0.621371

// Raw `/maintenance` item keys (snake_case, served verbatim by the Go handler — no camelCaseKeys
// transform in the shared layer, so the native reads match the wire contract, not the web camelCase type).
private const val FIELD_ID: String = "id"
private const val FIELD_NAME: String = "name"
private const val FIELD_INTERVAL_MONTHS: String = "interval_months"
private const val FIELD_INTERVAL_KM: String = "interval_km"
private const val FIELD_ESTIMATED_COST_USD: String = "estimated_cost_usd"

// Raw `/maintenance/records` (ServiceRecord) keys read by the widget.
private const val FIELD_ITEM_ID: String = "item_id"
private const val FIELD_DATE: String = "date"
private const val FIELD_ODOMETER_KM: String = "odometer_km"
private const val FIELD_NOTES: String = "notes"

// `/settings` document key for the currency symbol (web `useFormatting`).
private const val KEY_CURRENCY_SYMBOL: String = "currency_symbol"

// Locale-stable month abbreviations — the en-US `toLocaleDateString({ month: 'short' })` output the web
// `formatDate` produces by default. Used by [MaintenanceTrackerProjection.formatServiceDate].
private val SHORT_MONTHS: List<String> =
    listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

private const val ISO_DATE_PREFIX_LENGTH: Int = 10

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * component reads `size.cols` to choose the compact (months-left hero) vs standard (next-service card +
 * recent-service timeline) layout, so this type carries the same axis the registry constrains.
 */
data class MaintenanceTrackerSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): render the compact months-left hero. */
    val isCompact: Boolean get() = cols <= 1
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/vehicle.ts (`maintenance-tracker`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object MaintenanceTrackerRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "maintenance-tracker"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "MaintenanceTrackerWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val DEFAULT_SIZE: MaintenanceTrackerSize = MaintenanceTrackerSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val MIN_SIZE: MaintenanceTrackerSize = MaintenanceTrackerSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: MaintenanceTrackerSize = MaintenanceTrackerSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: MaintenanceTrackerSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: MaintenanceTrackerSize): MaintenanceTrackerSize =
        MaintenanceTrackerSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/** The three urgency tiers the web `getUrgency` heuristic resolves from the months-remaining interval. */
enum class Urgency { Overdue, Soon, Good }

/**
 * One decoded `/maintenance` item — the native analogue of the fields the web component reads from each
 * `MaintenanceItem`. All numerics are nullable to reproduce the web optional-chaining (`?? 0`); the wire
 * may omit `interval_km` / `estimated_cost_usd` entirely (the deployed Go handler does).
 */
data class MaintenanceItem(
    val id: String?,
    val name: String?,
    val intervalMonths: Double?,
    val intervalKm: Double?,
    val estimatedCostUsd: Double?,
)

/**
 * One decoded `/maintenance/records` entry — the native analogue of the web `ServiceRecord`. The deployed
 * Go handler always returns `[]`, so this only ever carries data in tests/fixtures; the fields mirror the
 * web reads (`rec.itemId`, `rec.date`, `rec.odometerKm`, `rec.notes`) against the snake_case wire contract.
 */
data class ServiceRecord(
    val itemId: String?,
    val date: String?,
    val odometerKm: Double?,
    val notes: String?,
)

/**
 * The two decoded cache-then-network feeds the widget composes (web `{ maintenanceItems, serviceRecords }`).
 * `hasData` is the web `items.length > 0 || records.length > 0` gate that selects content vs the empty state.
 */
data class MaintenanceTrackerData(
    val items: List<MaintenanceItem>,
    val records: List<ServiceRecord>,
) {
    /** Web `hasData = items.length > 0 || records.length > 0`. */
    val hasData: Boolean get() = items.isNotEmpty() || records.isNotEmpty()

    companion object {
        /** The no-items / no-records snapshot, surfaced for an empty or unresolved payload. */
        val EMPTY: MaintenanceTrackerData = MaintenanceTrackerData(emptyList(), emptyList())
    }
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` +
 * `useFormatting` reads from the `/settings` document: the full [unitPref] (distance unit + locale for the
 * interval/odometer distance), the [currencySymbol] (blank → "$"), and the currency [precision]
 * (web `decimal_precision`, floored & non-negative, else 2).
 */
data class MaintenanceTrackerDisplayPrefs(
    val unitPref: UnitPref,
    val currencySymbol: String,
    val precision: Int,
) {
    companion object {
        /** Metric + `$` + 2dp defaults used before settings load (matches the web defaults). */
        val METRIC_DEFAULT: MaintenanceTrackerDisplayPrefs =
            MaintenanceTrackerDisplayPrefs(UnitPreferences.fromSettings(null), DEFAULT_CURRENCY, DEFAULT_PRECISION)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`/`useFormatting`). */
        fun fromSettings(settings: JsonElement?): MaintenanceTrackerDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = rawSymbol?.contentOrNull?.trim()
            return MaintenanceTrackerDisplayPrefs(
                unitPref = unit,
                currencySymbol = if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
            )
        }
    }
}

/**
 * Localized labels the surface folds into its output (the eleven web `t('widget.maintenance.*')` keys). The
 * pure [MaintenanceTrackerProjection] reads these to assemble each visible string + TalkBack content
 * description; the composable builds this from `stringResource`, while tests pass a deterministic instance.
 */
data class MaintenanceTrackerStrings(
    val title: String,
    val overdue: String,
    val soon: String,
    val good: String,
    val monthsLeft: String,
    val noData: String,
    val nextService: String,
    val every: String,
    val months: String,
    val recentService: String,
    val noRecords: String,
)

/**
 * The projected, render-ready "next upcoming maintenance" card — the native analogue of the web standard
 * layout's top panel. Carries the already-localized [urgencyLabel] + its [urgency] tier (the render layer
 * maps it to a Badge variant + color), the item [name], the formatted [everyText] ("Every N mo") +
 * [distanceText] ("N km"), the optional [costText] (null when absent / ≤ 0, exactly like the web
 * `estimatedCostUsd != null && > 0` gate), and a folded TalkBack [contentDescription].
 */
data class NextServiceCard(
    val name: String,
    val urgency: Urgency,
    val urgencyLabel: String,
    val everyText: String,
    val distanceText: String,
    val costText: String?,
    val contentDescription: String,
)

/**
 * One projected recent-service timeline row — the native analogue of a web `Timeline` item. Carries the
 * resolved [title] (maintenance-item name ?? itemId ?? "—"), the formatted [subtitle] (odometer + optional
 * notes), the formatted [time] (record date), and a folded TalkBack [contentDescription].
 */
data class MaintenanceTimelineRow(
    val title: String,
    val subtitle: String,
    val time: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the maintenance tracker — the native analogue of everything
 * the web component computes before returning JSX. Pure data (no Compose types) so the projection is
 * unit-tested without a UI host. Carries both the compact-hero fields and the standard-layout fields; the
 * composable renders one set per [MaintenanceTrackerSize.isCompact].
 *
 * @property hasData web `hasData` — false ⇒ the standard layout shows its empty state.
 * @property nextService the next-upcoming card, or `null` when no maintenance item exists (web
 *   `nextItem && nextUrgency`).
 * @property timelineRows the up-to-three recent service rows (web `recentRecords` mapped to Timeline items).
 * @property hasRecords whether any service record exists (web `recentRecords.length > 0`); when false the
 *   standard layout shows the "No service records yet" line instead of the timeline.
 * @property hasNextItem whether a maintenance item resolved (drives the compact hero vs empty state).
 * @property compactMonths the months-remaining figure for the compact hero (web `fmtInt(intervalMonths ?? 0)`).
 * @property compactName the item name for the compact hero (web `nextItem.name ?? '—'`).
 * @property compactContentDescription folded TalkBack phrase for the compact hero.
 */
data class MaintenanceTrackerDisplay(
    val hasData: Boolean,
    val nextService: NextServiceCard?,
    val timelineRows: List<MaintenanceTimelineRow>,
    val hasRecords: Boolean,
    val hasNextItem: Boolean,
    val compactMonths: String,
    val compactName: String,
    val compactContentDescription: String,
)

/** Decodes the raw `/maintenance` array [json] into [MaintenanceItem]s; non-objects/non-arrays → empty. */
fun parseMaintenanceItems(json: JsonElement?): List<MaintenanceItem> =
    (json as? JsonArray)?.mapNotNull { (it as? JsonObject)?.toMaintenanceItem() } ?: emptyList()

/** Decodes the raw `/maintenance/records` array [json] into [ServiceRecord]s; non-objects/non-arrays → empty. */
fun parseServiceRecords(json: JsonElement?): List<ServiceRecord> =
    (json as? JsonArray)?.mapNotNull { (it as? JsonObject)?.toServiceRecord() } ?: emptyList()

private fun JsonObject.toMaintenanceItem(): MaintenanceItem =
    MaintenanceItem(
        id = stringField(FIELD_ID),
        name = stringField(FIELD_NAME),
        intervalMonths = doubleField(FIELD_INTERVAL_MONTHS),
        intervalKm = doubleField(FIELD_INTERVAL_KM),
        estimatedCostUsd = doubleField(FIELD_ESTIMATED_COST_USD),
    )

private fun JsonObject.toServiceRecord(): ServiceRecord =
    ServiceRecord(
        itemId = stringField(FIELD_ITEM_ID),
        date = stringField(FIELD_DATE),
        odometerKm = doubleField(FIELD_ODOMETER_KM),
        notes = stringField(FIELD_NOTES),
    )

/**
 * Pure projection + state-fold for the Maintenance Tracker surface — the native port of the inline
 * `useMemo` derivations + JSX formatting in `MaintenanceTrackerWidget.tsx`. [project] turns a decoded
 * [MaintenanceTrackerData] into the render-ready [MaintenanceTrackerDisplay]; [foldState] composes the two
 * cache-then-network feeds (`useMaintenance` + `useServiceRecords`) onto the shared [UiState] surface.
 */
object MaintenanceTrackerProjection {
    /**
     * Project [data] into the render model using the user's [prefs] and the localized [strings]. Sorting,
     * urgency, the recent-record selection, and the distance/currency/date formatting all reproduce the
     * web derivations verbatim against the snake_case wire contract.
     */
    fun project(
        data: MaintenanceTrackerData,
        prefs: MaintenanceTrackerDisplayPrefs,
        strings: MaintenanceTrackerStrings,
    ): MaintenanceTrackerDisplay {
        // Web `[...items].sort((a, b) => (a.intervalMonths ?? 0) - (b.intervalMonths ?? 0))` (stable).
        val sorted = data.items.sortedBy { it.intervalMonths ?: 0.0 }
        val nextItem = sorted.firstOrNull()
        val nextUrgency = nextItem?.let { urgencyFor(it.intervalMonths ?: 0.0) }

        val itemsById = data.items.associateBy { it.id }
        val recent =
            data.records
                .sortedByDescending { it.date ?: "" }
                .take(MAX_RECENT_RECORDS)
        val timelineRows = recent.map { it.toTimelineRow(itemsById, prefs, strings) }

        val compactName = nextItem?.name ?: EM_DASH
        val compactMonths = formatInt(nextItem?.intervalMonths ?: 0.0)

        return MaintenanceTrackerDisplay(
            hasData = data.hasData,
            nextService =
                if (nextItem != null && nextUrgency != null) {
                    nextServiceCard(nextItem, nextUrgency, prefs, strings)
                } else {
                    null
                },
            timelineRows = timelineRows,
            hasRecords = data.records.isNotEmpty(),
            hasNextItem = nextItem != null,
            compactMonths = compactMonths,
            compactName = compactName,
            compactContentDescription =
                if (nextItem != null) {
                    "${strings.title}: $compactName, $compactMonths ${strings.monthsLeft}"
                } else {
                    strings.noData
                },
        )
    }

    /**
     * Folds the maintenance feed ([maintenanceRes]) and the service-records feed ([recordsRes]) onto one
     * lifecycle-aware [UiState]. Mirrors the web shell precedence: a first load of EITHER query renders the
     * skeleton (web `isLoading = maintLoading || recordsLoading`); a hard maintenance failure with nothing
     * cached renders the error surface (web shell `isError={maintIsError}`); otherwise the content / empty
     * surface is chosen by `hasData = items.length > 0 || records.length > 0`.
     *
     * Maintenance is the primary feed — it alone drives the error/stale chrome (exactly as the web shell
     * only receives `maintIsError`/`maintStale`); the records feed is supplementary (it contributes the
     * timeline + the combined freshness stamp + the background-refresh flag, and its failures are
     * intentionally not surfaced as the widget's error state). Divergence (non-silent — ADR-013 honest
     * freshness): where the web blanks to its error surface on `maintIsError`, this keeps a cached
     * maintenance document visible as the stale "offline / last known" content branch and only shows the
     * hard error surface when there is nothing cached to keep.
     */
    fun foldState(
        maintenanceRes: Resource<JsonElement>,
        recordsRes: Resource<JsonElement>,
    ): UiState<MaintenanceTrackerData> {
        val items = parseMaintenanceItems(present(maintenanceRes.cached))
        val records = parseServiceRecords(present(recordsRes.cached))
        val data = MaintenanceTrackerData(items, records)

        val firstLoading =
            (maintenanceRes is Resource.Loading && maintenanceRes.cached == null) ||
                (recordsRes is Resource.Loading && recordsRes.cached == null)

        return when {
            firstLoading -> UiState.loading()
            maintenanceRes is Resource.Error && maintenanceRes.cached == null -> errorState(maintenanceRes)
            else -> contentState(data, maintenanceRes, recordsRes)
        }
    }

    /** The web `getUrgency(months)` heuristic: ≤0 overdue, ≤3 soon, else good. */
    fun urgencyFor(intervalMonths: Double): Urgency =
        when {
            intervalMonths <= URGENCY_OVERDUE_MAX_MONTHS -> Urgency.Overdue
            intervalMonths <= URGENCY_SOON_MAX_MONTHS -> Urgency.Soon
            else -> Urgency.Good
        }

    /** The localized label for an [urgency] tier (web `urgencyLabel`). */
    fun urgencyLabel(
        urgency: Urgency,
        strings: MaintenanceTrackerStrings,
    ): String =
        when (urgency) {
            Urgency.Overdue -> strings.overdue
            Urgency.Soon -> strings.soon
            Urgency.Good -> strings.good
        }

    /**
     * Formats a `yyyy-MM-dd[...]` service date as the web `formatDate` does by default — `MMM d, yyyy`
     * (en-US short month, numeric day + year), e.g. `Jan 15, 2024`. A null/blank/unparseable value yields
     * the em dash (web `if (!iso || isNaN) return '—'`). Locale-stable + API-safe (no java.time); since
     * the deployed `/maintenance/records` is always empty this only renders in tests/fixtures.
     */
    fun formatServiceDate(date: String?): String {
        val parts = date?.takeIf { it.isNotBlank() }?.take(ISO_DATE_PREFIX_LENGTH)?.split("-")
        if (parts == null || parts.size != 3) return EM_DASH
        val year = parts[0].toIntOrNull()
        val day = parts[2].toIntOrNull()
        val month = parts[1].toIntOrNull()?.let { SHORT_MONTHS.getOrNull(it - 1) }
        return if (year != null && day != null && month != null) "$month $day, $year" else EM_DASH
    }

    /**
     * Formats a currency [amount] as the web `useFormatting.formatCurrency` does — the user's [symbol]
     * (blank → "$") followed by a [decimals]-digit grouped number. Uses [Locale.US] grouping so the output
     * is deterministic and matches the shared `formatDistance` number contract.
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        decimals: Int,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${groupedFormat(decimals.coerceAtLeast(0)).format(amount)}"

    /** Locale-stable integer formatter (web `fmtInt`). */
    fun formatInt(value: Double): String = groupedFormat(decimals = 0).format(value)

    private fun nextServiceCard(
        item: MaintenanceItem,
        urgency: Urgency,
        prefs: MaintenanceTrackerDisplayPrefs,
        strings: MaintenanceTrackerStrings,
    ): NextServiceCard {
        val name = item.name ?: EM_DASH
        val label = urgencyLabel(urgency, strings)
        val everyText = "${strings.every} ${formatInt(item.intervalMonths ?: 0.0)} ${strings.months}"
        val distanceText = formatDistance((item.intervalKm ?: 0.0) * WEB_KM_TO_MI_FACTOR, prefs.unitPref, DISTANCE_DECIMALS)
        val cost = item.estimatedCostUsd
        val costText =
            if (cost != null && cost > 0.0) {
                formatCurrency(cost, prefs.currencySymbol, prefs.precision)
            } else {
                null
            }
        val description =
            buildString {
                append("${strings.nextService}: $name, $label, $everyText, $distanceText")
                if (costText != null) append(", $costText")
            }
        return NextServiceCard(
            name = name,
            urgency = urgency,
            urgencyLabel = label,
            everyText = everyText,
            distanceText = distanceText,
            costText = costText,
            contentDescription = description,
        )
    }

    private fun ServiceRecord.toTimelineRow(
        itemsById: Map<String?, MaintenanceItem>,
        prefs: MaintenanceTrackerDisplayPrefs,
        strings: MaintenanceTrackerStrings,
    ): MaintenanceTimelineRow {
        val title = itemsById[itemId]?.name ?: itemId ?: EM_DASH
        val odometerText = formatDistance((odometerKm ?: 0.0) * WEB_KM_TO_MI_FACTOR, prefs.unitPref, DISTANCE_DECIMALS)
        val subtitle = if (!notes.isNullOrBlank()) "$odometerText \u00B7 $notes" else odometerText
        val time = formatServiceDate(date)
        return MaintenanceTimelineRow(
            title = title,
            subtitle = subtitle,
            time = time,
            contentDescription = "${strings.recentService}: $title, $subtitle, $time",
        )
    }

    private fun errorState(res: Resource.Error<*>): UiState<MaintenanceTrackerData> =
        UiState(
            phase = UiPhase.Error,
            fetchedAt = res.fetchedAt,
            stale = res.stale,
            errorKind = errorKindOf(res.error),
            httpStatus = httpStatusOf(res.error),
        )

    private fun contentState(
        data: MaintenanceTrackerData,
        maintenanceRes: Resource<JsonElement>,
        recordsRes: Resource<JsonElement>,
    ): UiState<MaintenanceTrackerData> {
        val maintenanceError = maintenanceRes as? Resource.Error<*>
        return UiState(
            phase = if (data.hasData) UiPhase.Content else UiPhase.Empty,
            data = data,
            fetchedAt = maxFetchedAt(maintenanceRes, recordsRes),
            stale = maintenanceRes.stale || maintenanceError != null,
            refreshing = maintenanceRes is Resource.Loading || recordsRes is Resource.Loading,
            errorKind = maintenanceError?.let { errorKindOf(it.error) },
            httpStatus = maintenanceError?.let { httpStatusOf(it.error) },
        )
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

/**
 * Read a field as a display string, or `null` when absent / JSON `null`. A quoted string yields its
 * content; a JSON number (the Go handler serves `id` as a number) yields its literal text so it can key
 * the item map / render as a fallback title — the web reads `m.id` / `rec.itemId` the same loose way.
 */
private fun JsonObject.stringField(key: String): String? =
    when (val element = this[key]) {
        is JsonNull -> null
        is JsonPrimitive -> element.contentOrNull
        else -> null
    }
