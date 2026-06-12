// Pure, framework-free model + logic for the NotificationFilterBar feature view — the native analogue of
// everything web/src/features/notifications/components/NotificationFilterBar.tsx derives outside JSX (the
// severity registry, the toggle/select/search/date filter mutators, the select-option + active-chip
// builders, and the ISO-date <-> epoch-day bridge the native date-range control needs). No Compose, no
// Android, no HTTP: every type here is exercised by the :android:testReleaseUnitTest gate, so the composable
// stays a thin render layer. The shapes mirror the shared cross-platform NotificationFilters contract
// (io.teslasync.shared.core.data.repo) the web `NotificationFilters` type is the TS port of.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationFilterBar) cannot form a valid Kotlin package (a hyphen and a
// PascalCase segment are illegal in a package identifier), so the package intentionally diverges from the
// path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.notificationfilterbar

import io.teslasync.android.components.forms.ActiveFilter
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.shared.core.data.repo.NotificationFilters
import io.teslasync.shared.core.presentation.notifications.AlertRule
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
const val NOTIFICATION_FILTER_BAR_SLUG: String = "NotificationFilterBar"

/** How many ISO date characters the web keeps for the from/to chip + picker value (`slice(0, 10)`). */
private const val ISO_DATE_LENGTH = 10

/**
 * The three notification severities the inbox filters on (web `SEVERITY_OPTIONS`). [wire] is the exact
 * lowercase token stored in [NotificationFilters.severity] and sent to the backend, and the declaration
 * order is the chip order the bar renders.
 */
enum class NotificationSeverity(
    val wire: String,
) {
    Info("info"),
    Warn("warn"),
    Critical("critical"),
    ;

    companion object {
        /** The severities in web `SEVERITY_OPTIONS` order (drives the chip row). */
        val ordered: List<NotificationSeverity> = listOf(Info, Warn, Critical)
    }
}

/**
 * A lightweight vehicle choice for the Vehicle dropdown + active-chip resolution — the id/label pair the
 * web reads off each `Vehicle` prop (`v.id`, `v.display_name`). Kept free of the heavy generated `Vehicle`
 * type so the option/chip logic stays pure and unit-testable; the render boundary maps the API model down.
 */
data class VehicleChoice(
    val id: Long,
    val displayName: String,
)

/**
 * The localized chrome strings the active-filter chips need, supplied by the render boundary so this model
 * stays string-free (the web resolves them inline via `t()`). [severityValues] maps each severity [wire]
 * token to its localized label for the combined "Severity: Info, Warn" chip value.
 */
data class NotificationFilterChipLabels(
    val severity: String,
    val vehicle: String,
    val rule: String,
    val search: String,
    val from: String,
    val to: String,
    val severityValues: Map<String, String>,
)

/**
 * Toggles [sev] in the current [severity] selection — the port of the web `toggleSeverity`. Adds the token
 * when absent, removes it when present, and collapses an emptied list back to `null` so the filter param is
 * dropped entirely (web `next.length ? next : undefined`).
 */
fun toggleSeverity(
    severity: List<String>?,
    sev: String,
): List<String>? {
    val current = severity ?: emptyList()
    val next = if (current.contains(sev)) current.filter { it != sev } else current + sev
    return next.ifEmpty { null }
}

/**
 * Applies a Vehicle-dropdown selection — the port of the web `setVehicle`. An empty value (the "All
 * vehicles" sentinel), a non-numeric value, or id `0` all clear the filter (web `Number(value)` falsy
 * guard); any other id becomes the single-element `vehicle_id` list.
 */
fun withVehicle(
    filters: NotificationFilters,
    value: String,
): NotificationFilters = filters.copy(vehicleId = singleSelectedId(value)?.let { listOf(it) })

/**
 * Applies a Rule-dropdown selection — the port of the web `setRule`, with the same empty/non-numeric/zero
 * falsy guard as [withVehicle].
 */
fun withRule(
    filters: NotificationFilters,
    value: String,
): NotificationFilters = filters.copy(ruleId = singleSelectedId(value)?.let { listOf(it) })

/**
 * Applies a free-text search — the port of the web `setQuery`. A query that is blank once trimmed clears
 * the filter; otherwise the raw (untrimmed) text is kept, exactly as the web stores `q.trim() ? q : …`.
 */
fun withQuery(
    filters: NotificationFilters,
    query: String,
): NotificationFilters = filters.copy(q = query.takeIf { it.trim().isNotEmpty() })

/**
 * Applies a from/to date range (inclusive epoch-days from the native date picker) — the port of the web
 * `setFrom`/`setTo` pair. Each end is rendered to an ISO `yyyy-MM-dd` string or cleared when unset (web
 * `date || undefined`).
 */
fun withDateRange(
    filters: NotificationFilters,
    startEpochDay: Long?,
    endEpochDay: Long?,
): NotificationFilters =
    filters.copy(
        from = epochDayToIsoDate(startEpochDay).takeIf { it.isNotEmpty() },
        to = epochDayToIsoDate(endEpochDay).takeIf { it.isNotEmpty() },
    )

/**
 * Clears a single active filter by its chip [key] — the port of each web chip's `onRemove`. Unknown keys
 * return [filters] unchanged so a stray key can never corrupt the state.
 */
fun clearFilter(
    filters: NotificationFilters,
    key: String,
): NotificationFilters =
    when (key) {
        "severity" -> filters.copy(severity = null)
        "vehicle_id" -> filters.copy(vehicleId = null)
        "rule_id" -> filters.copy(ruleId = null)
        "q" -> filters.copy(q = null)
        "from" -> filters.copy(from = null)
        "to" -> filters.copy(to = null)
        else -> filters
    }

/**
 * Clears every bar-owned filter at once — the port of the web `handleClearAll`. Only the six controls the
 * bar drives are reset; unrelated [NotificationFilters] fields (read/archived/limit/offset/group key) are
 * preserved so a "Clear all" never disturbs the surrounding inbox query.
 */
fun clearAll(filters: NotificationFilters): NotificationFilters =
    filters.copy(severity = null, vehicleId = null, ruleId = null, q = null, from = null, to = null)

/** The currently-selected severities as a set, for chip highlighting (web `selectedSeverities`). */
fun selectedSeverities(filters: NotificationFilters): Set<String> = (filters.severity ?: emptyList()).toSet()

/** The Vehicle dropdown's selected value (web `filters.vehicle_id?.[0] ? String(...) : ''`). */
fun vehicleSelectValue(filters: NotificationFilters): String =
    filters.vehicleId
        ?.firstOrNull()
        ?.takeIf { it != 0L }
        ?.toString() ?: ""

/** The Rule dropdown's selected value (web `filters.rule_id?.[0] ? String(...) : ''`). */
fun ruleSelectValue(filters: NotificationFilters): String =
    filters.ruleId
        ?.firstOrNull()
        ?.takeIf { it != 0L }
        ?.toString() ?: ""

/**
 * The Vehicle dropdown options — a leading "All vehicles" sentinel (empty value) followed by one option per
 * vehicle (id -> display name, falling back to `#id` when unnamed, web `v.display_name || #${v.id}`).
 * [allVehiclesLabel] is the localized sentinel, supplied by the render boundary so this stays pure.
 */
fun vehicleOptions(
    allVehiclesLabel: String,
    vehicles: List<VehicleChoice>,
): List<SelectOption> =
    buildList {
        add(SelectOption(value = "", label = allVehiclesLabel))
        vehicles.forEach { add(SelectOption(value = it.id.toString(), label = it.displayName.ifBlank { "#${it.id}" })) }
    }

/**
 * The Rule dropdown options — a leading "All rules" sentinel followed by one option per rule (id -> name,
 * web `r.name`). [allRulesLabel] is the localized sentinel.
 */
fun ruleOptions(
    allRulesLabel: String,
    rules: List<AlertRule>,
): List<SelectOption> =
    buildList {
        add(SelectOption(value = "", label = allRulesLabel))
        rules.forEach { add(SelectOption(value = it.id.toString(), label = it.name.ifBlank { "#${it.id}" })) }
    }

/**
 * Builds the active-filter chips in the exact web order (severity, vehicle, rule, search, from, to) — the
 * port of the web `activeFilterChips` array. A chip is emitted only for a set filter; the vehicle/rule
 * values resolve the chosen id back to its label (falling back to `#id`), and the date values keep the
 * `yyyy-MM-dd` prefix (web `.slice(0, 10)`). The chip [ActiveFilter.key] matches [clearFilter]'s keys.
 */
fun activeFilters(
    filters: NotificationFilters,
    labels: NotificationFilterChipLabels,
    vehicles: List<VehicleChoice>,
    rules: List<AlertRule>,
): List<ActiveFilter> =
    buildList {
        filters.severity?.takeIf { it.isNotEmpty() }?.let { severities ->
            val summary = severities.joinToString(", ") { labels.severityValues[it] ?: it }
            add(ActiveFilter(key = "severity", label = labels.severity, value = summary))
        }
        filters.vehicleId?.firstOrNull()?.let { id ->
            val match = vehicles.firstOrNull { it.id == id }?.displayName?.ifBlank { null }
            add(ActiveFilter(key = "vehicle_id", label = labels.vehicle, value = match ?: "#$id"))
        }
        filters.ruleId?.firstOrNull()?.let { id ->
            val match = rules.firstOrNull { it.id == id }?.name?.ifBlank { null }
            add(ActiveFilter(key = "rule_id", label = labels.rule, value = match ?: "#$id"))
        }
        filters.q?.takeIf { it.isNotEmpty() }?.let { add(ActiveFilter(key = "q", label = labels.search, value = it)) }
        filters.from?.takeIf { it.isNotEmpty() }?.let {
            add(ActiveFilter(key = "from", label = labels.from, value = it.take(ISO_DATE_LENGTH)))
        }
        filters.to?.takeIf { it.isNotEmpty() }?.let {
            add(ActiveFilter(key = "to", label = labels.to, value = it.take(ISO_DATE_LENGTH)))
        }
    }

/** Parses an ISO date (or datetime) string to an inclusive epoch-day, or `null` when absent/unparseable. */
fun isoDateToEpochDay(iso: String?): Long? =
    iso?.take(ISO_DATE_LENGTH)?.takeIf { it.isNotEmpty() }?.let {
        runCatching { LocalDate.parse(it, DateTimeFormatter.ISO_LOCAL_DATE).toEpochDay() }.getOrNull()
    }

/** Renders an epoch-day back to an ISO `yyyy-MM-dd` string, or `""` when no day is selected. */
fun epochDayToIsoDate(epochDay: Long?): String = epochDay?.let { LocalDate.ofEpochDay(it).format(DateTimeFormatter.ISO_LOCAL_DATE) } ?: ""

/** Resolves a dropdown value to a single non-zero id, applying the web `Number(value)` falsy guard. */
private fun singleSelectedId(value: String): Long? = value.takeIf { it.isNotEmpty() }?.toLongOrNull()?.takeIf { it != 0L }
