// File hosts the ChargePlans surface's framework-free domain, parsing, two-source merge adapter and
// projection; named after the surface bundle (ChargePlansWidget*) rather than the single declaration.
@file:Suppress("MatchingDeclarationName", "TooManyFunctions")

package io.teslasync.android.dashboardwidgets.chargeplans

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlin.math.floor

/*
 * Framework-free domain + projection for the ChargePlans dashboard widget — the native port of the
 * data the web `ChargePlansWidget` (web/src/features/dashboard/widgets/ChargePlansWidget.tsx) computes
 * before it renders JSX: the `useChargePlans` + `useRatePlans` parsing, the `activePlan` selection,
 * the `planEntries` / `rateEntries` `useMemo` work, the status→badge mapping, the two-source
 * loading/error/stale combination (`isLoading = plansX || ratesX`), and the compact-vs-standard
 * branch. Pure Kotlin (no Android, no Compose, no coroutines) so every branch is unit-tested
 * off device. The shared `ChargingStore.chargePlans/ratePlans` carry these analytics-shaped payloads
 * verbatim as `JsonElement`, so the field names are read directly from the wire here (the web hook
 * applies no unit conversion to charge-planner estimates).
 */

/** The em-dash shown wherever a value is unknown (matches the shared formatter fallback). */
internal const val CHARGE_PLANS_EM_DASH: String = "\u2014"

/** Energy unit suffix the web renders verbatim for charge-planner estimates (`${kwh} kWh`). */
internal const val CHARGE_PLANS_ENERGY_UNIT: String = "kWh"

/** Percent suffix the web appends to the target SoC (`${soc}%`). */
internal const val CHARGE_PLANS_PERCENT: String = "%"

/**
 * The widget's grid footprint (columns × rows) — the Android port of the web `WidgetProps.size`,
 * the `isCompact = size.cols <= 1` layout switch, and the `compact = size.rows <= 3` detail-card
 * density used by `WidgetDetailCard`.
 */
data class ChargePlansSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column or fewer (web `isCompact`): the centered Target-SoC tile. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three rows or fewer (web `compact` for `WidgetDetailCard`): cap detail rows at four. */
    val isCompactDetail: Boolean get() = rows <= COMPACT_DETAIL_MAX_ROWS

    private companion object {
        const val COMPACT_MAX_COLS = 1
        const val COMPACT_DETAIL_MAX_ROWS = 3
    }
}

/**
 * Canonical registry metadata for the Charge Plans surface — the native mirror of the web registry
 * entry in `web/src/features/dashboard/widgets/registry/charging.ts`. A dashboard host binds this
 * surface with the same [ID] and honours the same [MIN_SIZE]/[MAX_SIZE] footprint constraints.
 */
object ChargePlansRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "charge-plans"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "charging"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ChargePlansWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val DEFAULT_SIZE: ChargePlansSize = ChargePlansSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: ChargePlansSize = ChargePlansSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: ChargePlansSize = ChargePlansSize(cols = 4, rows = 40)

    /** True when [size] falls within the min/max footprint constraints. */
    fun isWithinBounds(size: ChargePlansSize): Boolean =
        size.cols >= MIN_SIZE.cols &&
            size.cols <= MAX_SIZE.cols &&
            size.rows >= MIN_SIZE.rows &&
            size.rows <= MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ChargePlansSize): ChargePlansSize =
        ChargePlansSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * One charge plan from `GET /charge-planner/history?vehicle_id=` (web `useChargePlans`, `ChargePlan`).
 * Only the fields the widget renders are projected; reads are null-tolerant so a partial row never
 * throws (web `?? 0` / `?? '—'` parity). [targetSoc] is carried as a double because the wire value is
 * a `number`; the display rounds it via the integer formatter (web `fmtInt`).
 */
data class ChargePlan(
    val id: Long,
    val vehicleId: Long,
    val targetSoc: Double,
    val departBy: String?,
    val scheduledStart: String?,
    val scheduledEnd: String?,
    val ratePlan: String?,
    val estimatedKwh: Double?,
    val estimatedCost: Double?,
    val chargeNowCost: Double?,
    val savings: Double?,
    val status: String?,
    val appliedAt: String?,
    val completedAt: String?,
    val createdAt: String?,
)

/** One TOU rate plan from `GET /charge-planner/rate-plans` (web `useRatePlans`, `RatePlanInfo`). */
data class RatePlanInfo(
    val id: String?,
    val name: String?,
    val utility: String?,
)

/**
 * The parsed two-source payload backing the widget: the charge [plans] for the resolved vehicle and
 * the available TOU [ratePlans]. The web composes `useChargePlans` with `useRatePlans`; this snapshot
 * is the native analogue of both resolved. [activePlan] mirrors the web
 * `plans.find(active|scheduled) ?? plans[0]`, and [hasData] mirrors `safePlans.length || safeRates.length`.
 */
data class ChargePlansSnapshot(
    val plans: List<ChargePlan>,
    val ratePlans: List<RatePlanInfo>,
) {
    /** The plan to feature: the first active/scheduled plan, else the first plan, else null. */
    val activePlan: ChargePlan? get() =
        plans.firstOrNull { it.status == STATUS_ACTIVE || it.status == STATUS_SCHEDULED } ?: plans.firstOrNull()

    /** True when there is any plan OR any rate plan (web `hasData`). */
    val hasData: Boolean get() = plans.isNotEmpty() || ratePlans.isNotEmpty()

    companion object {
        /** Plan status that marks an in-effect plan (web `activePlan` predicate). */
        const val STATUS_ACTIVE: String = "active"

        /** Plan status that marks an upcoming scheduled plan (web `activePlan` predicate). */
        const val STATUS_SCHEDULED: String = "scheduled"

        /** Both sources resolved to nothing. */
        val EMPTY: ChargePlansSnapshot = ChargePlansSnapshot(emptyList(), emptyList())

        /** Parse both wire bodies into a tolerant snapshot (web `safeArray` on each). */
        fun from(
            plansJson: JsonElement?,
            ratesJson: JsonElement?,
        ): ChargePlansSnapshot = ChargePlansSnapshot(parsePlans(plansJson), parseRatePlans(ratesJson))

        /** Project a charge-plan JSON array into a tolerant list (web `safeArray`). */
        fun parsePlans(element: JsonElement?): List<ChargePlan> =
            (element as? JsonArray)?.mapNotNull { (it as? JsonObject)?.toChargePlan() } ?: emptyList()

        /** Project a rate-plan JSON array into a tolerant list (web `safeArray`). */
        fun parseRatePlans(element: JsonElement?): List<RatePlanInfo> =
            (element as? JsonArray)?.mapNotNull { (it as? JsonObject)?.toRatePlanInfo() } ?: emptyList()

        private fun JsonObject.toChargePlan(): ChargePlan =
            ChargePlan(
                id = longValue("id") ?: 0L,
                vehicleId = longValue("vehicle_id") ?: 0L,
                targetSoc = doubleValue("target_soc") ?: 0.0,
                departBy = stringValue("depart_by"),
                scheduledStart = stringValue("scheduled_start"),
                scheduledEnd = stringValue("scheduled_end"),
                ratePlan = stringValue("rate_plan"),
                estimatedKwh = doubleValue("estimated_kwh"),
                estimatedCost = doubleValue("estimated_cost"),
                chargeNowCost = doubleValue("charge_now_cost"),
                savings = doubleValue("savings"),
                status = stringValue("status"),
                appliedAt = stringValue("applied_at"),
                completedAt = stringValue("completed_at"),
                createdAt = stringValue("created_at"),
            )

        private fun JsonObject.toRatePlanInfo(): RatePlanInfo =
            RatePlanInfo(
                id = stringValue("id"),
                name = stringValue("name"),
                utility = stringValue("utility"),
            )

        private fun JsonObject.longValue(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

        private fun JsonObject.doubleValue(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

        private fun JsonObject.stringValue(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    }
}

/** Semantic tone for a [DetailEntry] badge (web `detailBadgeVariant`/`badgeVariant`). */
enum class DetailBadgeVariant { Success, Warning, Error, Neutral }

/** A small status chip on a [DetailEntry] (web `entry.badge`). */
data class DetailBadge(
    val text: String,
    val variant: DetailBadgeVariant,
)

/**
 * One projected, render-ready label/value row — the Android port of the web `DetailEntry`. Pure data
 * (no Compose types): the localized-on-build [label], the pre-formatted [value], an optional [badge],
 * and the [mono] flag (rate-plan ids render monospace, web `mono: true`).
 */
data class DetailEntry(
    val label: String,
    val value: String,
    val badge: DetailBadge? = null,
    val mono: Boolean = false,
)

/**
 * Maps a plan status onto its badge tone — the 1:1 port of the web `detailBadgeVariant` /
 * `badgeVariant` (which share the same logic; the render layer folds [DetailBadgeVariant.Error] onto
 * the danger palette).
 */
fun chargePlanStatusVariant(status: String?): DetailBadgeVariant =
    when (status) {
        "completed" -> DetailBadgeVariant.Success
        "active", "scheduled" -> DetailBadgeVariant.Warning
        "failed", "cancelled" -> DetailBadgeVariant.Error
        else -> DetailBadgeVariant.Neutral
    }

/**
 * The localized strings the projection needs, resolved through the P1/S10 i18n facade by the
 * composable and injected so the projection stays pure + unit-testable (no `stringResource`).
 */
data class ChargePlansStrings(
    val targetSoc: String,
    val departure: String,
    val schedStart: String,
    val schedEnd: String,
    val estEnergy: String,
    val estCost: String,
    val savings: String,
    val saved: String,
    val ratePlan: String,
)

/**
 * The display-boundary formatters the projection needs — the native ports of the web `useFormatting`
 * (`formatCurrency`), `useDateFormat` (`formatTime`/`formatDateShort`) and `numberFormat`
 * (`fmtNumber`/`fmtInt`) helpers. Injected as functions so the projection is deterministic in tests.
 */
class ChargePlansFormatters(
    val currency: (Double) -> String,
    val time: (String?) -> String,
    val date: (String?) -> String,
    val number1: (Double) -> String,
    val integer: (Double) -> String,
)

/** The projected, render-ready view of the [ChargePlansSnapshot.activePlan]. Pure data, no Compose. */
data class ChargePlanView(
    val statusText: String,
    val statusVariant: DetailBadgeVariant,
    val ratePlanText: String,
    val targetSocText: String,
    val departureValue: String,
    val compactDeparture: String?,
    val statEntries: List<DetailEntry>,
    val detailEntries: List<DetailEntry>,
)

/**
 * The fully projected, render-ready view for one footprint — the native analogue of everything the
 * web component computes via `useMemo` before returning JSX: the active-plan view (its header badge,
 * the two stat tiles, and the detail rows), the rate-plan rows, and the compact/standard branch.
 */
data class ChargePlansDisplay(
    val isCompact: Boolean,
    val hasData: Boolean,
    val activePlan: ChargePlanView?,
    val rateEntries: List<DetailEntry>,
    val hasRates: Boolean,
)

/**
 * Pure projection from a parsed [ChargePlansSnapshot] to the display model — the native port of the
 * `planEntries` / `rateEntries` `useMemo` work plus the `WidgetDetailCard` compact slice in the web
 * source. Every label is supplied by the caller (resolved through the i18n facade), and every value
 * is formatted by the injected [ChargePlansFormatters], so this stays deterministic in tests.
 */
object ChargePlansProjection {
    private const val STAT_ENTRY_COUNT = 2
    private const val DETAIL_COMPACT_LIMIT = 4
    private const val SAVINGS_MIN = 0.0

    /** Project [snapshot] for [size] using the supplied [strings] + [formatters]. */
    fun project(
        snapshot: ChargePlansSnapshot,
        size: ChargePlansSize,
        strings: ChargePlansStrings,
        formatters: ChargePlansFormatters,
    ): ChargePlansDisplay {
        val planView = snapshot.activePlan?.let { plan -> buildPlanView(plan, size, strings, formatters) }
        val rateEntries =
            snapshot.ratePlans.map { rate ->
                DetailEntry(
                    label = rate.utility ?: CHARGE_PLANS_EM_DASH,
                    value = rate.name ?: CHARGE_PLANS_EM_DASH,
                    badge = DetailBadge(rate.id ?: CHARGE_PLANS_EM_DASH, DetailBadgeVariant.Neutral),
                    mono = true,
                )
            }
        return ChargePlansDisplay(
            isCompact = size.isCompact,
            hasData = snapshot.hasData,
            activePlan = planView,
            rateEntries = if (size.isCompactDetail) rateEntries.take(DETAIL_COMPACT_LIMIT) else rateEntries,
            hasRates = snapshot.ratePlans.isNotEmpty(),
        )
    }

    private fun buildPlanView(
        plan: ChargePlan,
        size: ChargePlansSize,
        strings: ChargePlansStrings,
        formatters: ChargePlansFormatters,
    ): ChargePlanView {
        val targetSocText = formatters.integer(plan.targetSoc) + CHARGE_PLANS_PERCENT
        val entries =
            buildList {
                add(
                    DetailEntry(
                        label = strings.targetSoc,
                        value = targetSocText,
                        badge = DetailBadge(plan.status ?: CHARGE_PLANS_EM_DASH, chargePlanStatusVariant(plan.status)),
                    ),
                )
                add(DetailEntry(strings.departure, plan.departBy?.let(formatters.time) ?: CHARGE_PLANS_EM_DASH))
                add(DetailEntry(strings.schedStart, dateTime(plan.scheduledStart, formatters)))
                add(DetailEntry(strings.schedEnd, dateTime(plan.scheduledEnd, formatters)))
                add(
                    DetailEntry(
                        strings.estEnergy,
                        plan.estimatedKwh?.let { "${formatters.number1(it)} $CHARGE_PLANS_ENERGY_UNIT" } ?: CHARGE_PLANS_EM_DASH,
                    ),
                )
                add(DetailEntry(strings.estCost, plan.estimatedCost?.let(formatters.currency) ?: CHARGE_PLANS_EM_DASH))
                if (plan.savings != null && plan.savings > SAVINGS_MIN) {
                    add(
                        DetailEntry(
                            label = strings.savings,
                            value = formatters.currency(plan.savings),
                            badge = DetailBadge(strings.saved, DetailBadgeVariant.Success),
                        ),
                    )
                }
                add(DetailEntry(strings.ratePlan, plan.ratePlan ?: CHARGE_PLANS_EM_DASH))
            }
        val detail = entries.drop(STAT_ENTRY_COUNT)
        return ChargePlanView(
            statusText = plan.status ?: CHARGE_PLANS_EM_DASH,
            statusVariant = chargePlanStatusVariant(plan.status),
            ratePlanText = plan.ratePlan.orEmpty(),
            targetSocText = targetSocText,
            departureValue = entries[1].value,
            compactDeparture = plan.departBy?.let(formatters.time),
            statEntries = entries.take(STAT_ENTRY_COUNT),
            detailEntries = if (size.isCompactDetail) detail.take(DETAIL_COMPACT_LIMIT) else detail,
        )
    }

    private fun dateTime(
        raw: String?,
        formatters: ChargePlansFormatters,
    ): String = "${formatters.date(raw)} ${formatters.time(raw)}"
}

/** The user's display preferences this surface needs — the web `useFormatting`/`useDateFormat` ports. */
data class ChargePlansPrefs(
    val currencySymbol: String,
    val precision: Int,
    val localeTag: String,
) {
    companion object {
        /** The web `$` fallback used before settings load. */
        const val DEFAULT_CURRENCY: String = "$"

        /** The web `fmtNumber` default precision. */
        const val DEFAULT_PRECISION: Int = 2

        /** Empty tag → the render layer resolves the system default locale. */
        const val DEFAULT_LOCALE_TAG: String = ""

        /** Pre-settings defaults (metric / dollar / system locale). */
        val DEFAULT: ChargePlansPrefs = ChargePlansPrefs(DEFAULT_CURRENCY, DEFAULT_PRECISION, DEFAULT_LOCALE_TAG)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`/`useFormatting`). */
        fun from(settings: JsonElement?): ChargePlansPrefs {
            val obj = settings as? JsonObject
            val symbol = (obj?.get("currency_symbol") as? JsonPrimitive)?.contentOrNull?.trim()
            val precision = (obj?.get("decimal_precision") as? JsonPrimitive)?.doubleOrNull
            val locale = (obj?.get("locale") as? JsonPrimitive)?.contentOrNull?.trim()
            return ChargePlansPrefs(
                currencySymbol = if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY,
                precision =
                    if (precision != null &&
                        precision.isFinite() &&
                        precision >= 0
                    ) {
                        floor(precision).toInt()
                    } else {
                        DEFAULT_PRECISION
                    },
                localeTag = if (!locale.isNullOrEmpty()) locale else DEFAULT_LOCALE_TAG,
            )
        }
    }
}

/** The first enrolled vehicle's id (web `vehicles?.[0]?.id`), or null when the list is empty/absent. */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id

/**
 * A `GET /charge-planner/history` "disabled" stand-in — the native analogue of the web
 * `useChargePlans(undefined)` lazy gate (`enabled: id > 0`): an already-resolved empty array that is
 * never loading, never errored, and contributes `0` to the freshness stamp.
 */
internal val DISABLED_CHARGE_PLANS: Resource<JsonElement> =
    Resource.Success(JsonArray(emptyList()), fetchedAt = 0L, stale = false)

/**
 * Composes the charge-plans + rate-plans cache-then-network resources into one
 * [Resource] of a [ChargePlansSnapshot] — the native port of the web
 * `isLoading/isFetching/isStale/isError = plansX || ratesX` and `updatedAt = max(...)` combination.
 *
 * Mirrors the web `WidgetShell` precedence exactly: a first load on EITHER source (loading with no
 * cache) wins as the bare loading skeleton; a hard failure with no cache surfaces the error retry
 * surface, while a failure over cached data is kept visible as an offline/stale snapshot; an
 * in-flight refetch over cached data stays content with a freshness chip; otherwise success.
 */
fun mergeChargePlans(
    plans: Resource<JsonElement>,
    rates: Resource<JsonElement>,
): Resource<ChargePlansSnapshot> {
    val snapshot = chargePlansSnapshotOrNull(plans, rates)
    val fetchedAt = maxFetchedAt(plans.fetchedAtOrNull(), rates.fetchedAtOrNull())
    val combinedStale = plans.stale || rates.stale
    return when (chargePlansPhase(plans, rates)) {
        ChargePlansPhase.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = combinedStale)
        ChargePlansPhase.Error -> chargePlansErrorResource(snapshot, fetchedAt, combinedStale, plans, rates)
        ChargePlansPhase.Refreshing -> Resource.Loading(snapshot, fetchedAt, combinedStale)
        ChargePlansPhase.Success -> Resource.Success(snapshot ?: ChargePlansSnapshot.EMPTY, fetchedAt ?: 0L, stale = false)
    }
}

/** The merged surface, in the web `WidgetShell` precedence order (loading ▸ error ▸ refresh ▸ success). */
private enum class ChargePlansPhase { Loading, Error, Refreshing, Success }

private fun chargePlansPhase(
    plans: Resource<JsonElement>,
    rates: Resource<JsonElement>,
): ChargePlansPhase {
    val plansFirstLoad = plans is Resource.Loading && plans.cached == null
    val ratesFirstLoad = rates is Resource.Loading && rates.cached == null
    return when {
        plansFirstLoad || ratesFirstLoad -> ChargePlansPhase.Loading
        plans is Resource.Error || rates is Resource.Error -> ChargePlansPhase.Error
        plans is Resource.Loading || rates is Resource.Loading -> ChargePlansPhase.Refreshing
        else -> ChargePlansPhase.Success
    }
}

private fun chargePlansSnapshotOrNull(
    plans: Resource<JsonElement>,
    rates: Resource<JsonElement>,
): ChargePlansSnapshot? =
    if (plans.cached != null || rates.cached != null) {
        ChargePlansSnapshot.from(plans.cached, rates.cached)
    } else {
        null
    }

private fun chargePlansErrorResource(
    snapshot: ChargePlansSnapshot?,
    fetchedAt: Long?,
    combinedStale: Boolean,
    plans: Resource<JsonElement>,
    rates: Resource<JsonElement>,
): Resource<ChargePlansSnapshot> {
    val error = mergeChargePlansError(plans, rates)
    return if (snapshot != null) {
        Resource.Error(snapshot, fetchedAt, stale = true, error = error)
    } else {
        Resource.Error(null, fetchedAt, combinedStale, error = error)
    }
}

private fun mergeChargePlansError(
    plans: Resource<*>,
    rates: Resource<*>,
): Throwable =
    (plans as? Resource.Error)?.error
        ?: (rates as? Resource.Error)?.error
        ?: IllegalStateException("charge plans unavailable")

private fun Resource<*>.fetchedAtOrNull(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }

private fun maxFetchedAt(
    a: Long?,
    b: Long?,
): Long? = listOfNotNull(a, b).maxOrNull()
