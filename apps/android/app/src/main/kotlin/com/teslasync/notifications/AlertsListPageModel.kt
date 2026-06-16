// Pure, framework-free model + projections for the AlertsListPage notifications surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/notifications/pages/AlertsListPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only references the shared-core Alert
// domain models + the reused QuietHours value), so the composable stays a thin render layer and all of this is
// exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the alert-summary counts the six KPI cards read (total /
// critical-unread / warnings / info / unread / read-rate, the web `useMemo` count chain); (2) the alerts-by-type
// pie projection (web `alertsByType`); (3) the 7-day severity-stacked trend (web `alertsByDay` + `weekAlertCount`);
// (4) the pinned-rule ordering (web `pinnedRules` over `usePinned('alert_rule')`); (5) the tab + search filtering and
// pagination (web `tabFilteredAlerts` -> `useFilteredList` -> slice); and (6) the per-row relative-time + type label the
// AlertCard renders. No field in this domain is unit-bearing (severities/counts/timestamps), so there is no SI
// conversion here — only locale/timezone formatting at the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling analytics/driving pages.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.notifications.alertslist

import io.teslasync.android.notifications.QuietHours
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.Alert
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.max

/** Whole percent (web `* 100`). */
private const val PERCENT = 100.0

/** Severity literals the wire uses (web `'info' | 'warning' | 'critical'`). */
private const val SEVERITY_INFO = "info"
private const val SEVERITY_WARNING = "warning"
private const val SEVERITY_CRITICAL = "critical"

/** The fallback alert type when a row has none (web `a.type ?? 'notification'`). */
private const val DEFAULT_TYPE = "notification"

/** The trailing window the trend chart + "Last 7 Days" counter cover (web `for (i = 6; i >= 0; i--)`). */
private const val TREND_DAYS = 7

/** Milliseconds per minute / hour / day for the relative-time + 7-day window math (web `60000` / `86400000`). */
private const val MS_PER_MINUTE = 60_000L
private const val MINUTES_PER_HOUR = 60L
private const val HOURS_PER_DAY = 24L
private const val MS_PER_DAY = MS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY
private const val MINUTES_PER_DAY = (MINUTES_PER_HOUR * HOURS_PER_DAY).toInt()

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `AlertsListPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("notificationsAlerts", "/notifications/alerts", …)`, so the host binds this surface to that destination
 * (and its `/notifications/alerts` deep link) without the nav module depending on it.
 */
object AlertsListPageRegistration {
    /** The navigation destination id (Destinations.kt `page("notificationsAlerts", "/notifications/alerts", …)`). */
    const val ROUTE_ID: String = "notificationsAlerts"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/notifications/alerts"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no alert id / PII. */
    const val SLUG: String = "AlertsListPage"

    /** Rows per page in the alert list (web `alertsPerPage = 20`). */
    const val PAGE_SIZE: Int = 20
}

/** The list filter facets (web `'all' | 'unread' | 'critical'` tab). */
enum class AlertFilter { All, Unread, Critical }

/**
 * The page's local interaction snapshot — the native counterpart of the web URL-state cells (`filter` / `q` / `page`).
 * Immutable so a single [kotlinx.coroutines.flow.StateFlow] re-renders the bound surface on every change.
 */
data class AlertsInteraction(
    val filter: AlertFilter = AlertFilter.All,
    val search: String = "",
    val page: Int = 1,
)

/** The normalized severity for an alert — empty collapses to `info` (web `a.severity ?? 'info'`). */
fun severityOf(alert: Alert): String = alert.severity.ifBlank { SEVERITY_INFO }

/** The display label for an alert type — empty collapses to `notification`, underscores become spaces (web `replace`). */
fun typeLabel(type: String): String = type.ifBlank { DEFAULT_TYPE }.replace('_', ' ')

/**
 * The alert-summary counts the six KPI cards read (web `useMemo` count chain). [total]/[unread]/[warning]/[read] count
 * the whole (range-filtered) inbox; [critical] is unread-critical (web `severity === 'critical' && !is_read`); [info]
 * counts the `info`-normalized severity (web `(severity ?? 'info') === 'info'`).
 */
data class AlertStats(
    val total: Int,
    val unread: Int,
    val critical: Int,
    val info: Int,
    val warning: Int,
    val read: Int,
) {
    /** Read share as a whole percent, or `null` when the inbox is empty so the card shows the em dash (web `> 0 ? … : null`). */
    val readRatePct: Int?
        get() = if (total > 0) Math.round(read.toDouble() / total * PERCENT).toInt() else null // parity:allow Int->Double widening for the percentage, not a stub

    companion object {
        val EMPTY: AlertStats = AlertStats(0, 0, 0, 0, 0, 0)
    }
}

/** Computes the [AlertStats] over the full alert list (web `totalCount`/`unreadCount`/… memos). */
fun computeStats(alerts: List<Alert>): AlertStats =
    AlertStats(
        total = alerts.size,
        unread = alerts.count { !it.isRead },
        critical = alerts.count { it.severity == SEVERITY_CRITICAL && !it.isRead },
        info = alerts.count { severityOf(it) == SEVERITY_INFO },
        warning = alerts.count { it.severity == SEVERITY_WARNING },
        read = alerts.count { it.isRead },
    )

/** One alerts-by-type slice ready to draw: the display [name], its [value] count, and a stable palette [colorIndex]. */
data class AlertTypeShare(
    val name: String,
    val value: Int,
    val colorIndex: Int,
)

/**
 * Projects the alert list into the by-type shares the pie + legend draw (web `alertsByType`): group by raw type
 * (empty -> `notification`), order by descending count, and label each with the underscores-as-spaces display name and
 * a stable position-based palette index.
 */
fun alertsByType(alerts: List<Alert>): List<AlertTypeShare> {
    if (alerts.isEmpty()) return emptyList()
    val counts = LinkedHashMap<String, Int>()
    alerts.forEach { alert ->
        val key = alert.type.ifBlank { DEFAULT_TYPE }
        counts[key] = (counts[key] ?: 0) + 1
    }
    return counts.entries
        .sortedByDescending { it.value }
        .mapIndexed { index, entry -> AlertTypeShare(name = typeLabel(entry.key), value = entry.value, colorIndex = index) }
}

/** One day in the 7-day trend (web `alertsByDay` row) — a localized weekday [day] label + per-severity counts. */
data class AlertDayBucket(
    val day: String,
    val info: Int,
    val warning: Int,
    val critical: Int,
) {
    /** Total alerts that day across the three known severities. */
    val total: Int get() = info + warning + critical
}

/**
 * Buckets the last [TREND_DAYS] days into the severity-stacked [AlertDayBucket]s the bar chart draws (web
 * `alertsByDay`). The seven buckets are seeded in chronological order with their localized short weekday label
 * ([Locale]/[zone]-aware, the web `Intl.DateTimeFormat(locale, { weekday: 'short' })`); each alert created within the
 * window is added to its weekday bucket, counting only the three known severities (web skips an unknown `severity`).
 */
fun alertsByDay(
    alerts: List<Alert>,
    nowMillis: Long,
    zone: ZoneId,
    locale: Locale,
): List<AlertDayBucket> {
    if (alerts.isEmpty()) return emptyList()
    val today = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate()
    val order = ArrayList<String>(TREND_DAYS)
    val info = LinkedHashMap<String, Int>()
    val warning = LinkedHashMap<String, Int>()
    val critical = LinkedHashMap<String, Int>()
    for (offset in (TREND_DAYS - 1) downTo 0) {
        val label = today.minusDays(offset.toLong()).dayOfWeek.shortLabel(locale)
        order.add(label)
        info[label] = 0
        warning[label] = 0
        critical[label] = 0
    }
    alerts.forEach { alert ->
        val createdMillis = parseEpochMillis(alert.createdAt) ?: return@forEach
        if (nowMillis - createdMillis > TREND_DAYS * MS_PER_DAY) return@forEach
        val label = Instant.ofEpochMilli(createdMillis).atZone(zone).toLocalDate().dayOfWeek.shortLabel(locale)
        when (alert.severity) {
            SEVERITY_INFO -> info[label]?.let { info[label] = it + 1 }
            SEVERITY_WARNING -> warning[label]?.let { warning[label] = it + 1 }
            SEVERITY_CRITICAL -> critical[label]?.let { critical[label] = it + 1 }
            else -> Unit
        }
    }
    return order.map { label ->
        AlertDayBucket(
            day = label,
            info = info[label] ?: 0,
            warning = warning[label] ?: 0,
            critical = critical[label] ?: 0,
        )
    }
}

/** Sum of all alerts across the 7-day trend (web `weekAlertCount`). */
fun weekAlertCount(buckets: List<AlertDayBucket>): Int = buckets.sumOf { it.total }

/** The most-common alert type label, or `null` when there are no alerts (web `alertsByType[0]?.name`). */
fun mostCommonType(byType: List<AlertTypeShare>): String? = byType.firstOrNull()?.name

/** One pinned alert-rule row the "Watching" panel renders (web `pinnedRules`). */
data class PinnedRuleRow(
    val id: Long,
    val name: String,
    val enabled: Boolean,
)

/**
 * Floats the pinned alert rules to the top in pin order (web `pinnedRules`): keeps only the rules whose id appears in
 * the `alert_rule` pin bucket, ordered by the pin [PinnedItem.position]. Returns empty when nothing is pinned.
 */
fun pinnedRules(
    rules: List<AlertRule>,
    pins: List<PinnedItem>,
): List<PinnedRuleRow> {
    if (rules.isEmpty() || pins.isEmpty()) return emptyList()
    val position = HashMap<String, Int>()
    pins.forEach { position[it.itemId] = it.position }
    return rules
        .filter { position.containsKey(it.id.toString()) }
        .sortedBy { position[it.id.toString()] ?: 0 }
        .map { PinnedRuleRow(id = it.id, name = it.name, enabled = it.enabled) }
}

/** Enabled alert-rule count for the "Active Rules" secondary line (web `enabledRules`). */
fun enabledRulesCount(rules: List<AlertRule>): Int = rules.count { it.enabled }

// ── List filtering + pagination ───────────────────────────────────────────────────────────────────────────────

/** Applies the tab facet (web `tabFilteredAlerts`): unread-only, unread-critical-only, or all. */
fun tabFilter(
    alerts: List<Alert>,
    filter: AlertFilter,
): List<Alert> =
    when (filter) {
        AlertFilter.All -> alerts
        AlertFilter.Unread -> alerts.filter { !it.isRead }
        AlertFilter.Critical -> alerts.filter { it.severity == SEVERITY_CRITICAL }
    }

/** Applies the free-text search over title + message (web `useFilteredList` on `['title','message']`). */
fun searchFilter(
    alerts: List<Alert>,
    query: String,
): List<Alert> {
    val needle = query.trim()
    if (needle.isEmpty()) return alerts
    return alerts.filter { it.title.contains(needle, ignoreCase = true) || it.message.contains(needle, ignoreCase = true) }
}

/** The full filtered list the list section + pagination read (web `filteredAlerts`). */
fun filteredAlerts(
    alerts: List<Alert>,
    filter: AlertFilter,
    query: String,
): List<Alert> = searchFilter(tabFilter(alerts, filter), query)

/** The total page count, floored at 1 (web `Math.max(1, Math.ceil(len / perPage))`). */
fun totalPages(filteredCount: Int): Int =
    max(1, ceil(filteredCount.toDouble() / AlertsListPageRegistration.PAGE_SIZE).toInt()) // parity:allow Int->Double widening for ceil, not a stub

/** The 1-based page clamped to the available range (web `Math.min(alertPage, totalPages)`). */
fun safePage(
    page: Int,
    filteredCount: Int,
): Int = page.coerceIn(1, totalPages(filteredCount))

/** The current page's slice of the filtered list (web `filteredAlerts.slice(...)`). */
fun pageSlice(
    filtered: List<Alert>,
    page: Int,
): List<Alert> {
    val current = safePage(page, filtered.size)
    val from = (current - 1) * AlertsListPageRegistration.PAGE_SIZE
    val to = minOf(from + AlertsListPageRegistration.PAGE_SIZE, filtered.size)
    if (from >= to) return emptyList()
    return filtered.subList(from, to)
}

/**
 * The fully-derived view-data the loaded body reads — the native analogue of the web page's long `useMemo` chain. The
 * counts/type/trend/pins are derived from the FULL (range) alert list (web stats use `alerts`, not the tab-filtered
 * set); [filtered]/[paged] apply the tab + search + page facets (web `filteredAlerts`/`pagedAlerts`).
 */
data class AlertsListData(
    val stats: AlertStats,
    val byType: List<AlertTypeShare>,
    val byDay: List<AlertDayBucket>,
    val weekCount: Int,
    val mostCommon: String?,
    val enabledRules: Int,
    val totalRules: Int,
    val pinned: List<PinnedRuleRow>,
    val filtered: List<Alert>,
    val paged: List<Alert>,
    val pageCount: Int,
    val currentPage: Int,
)

/** Folds the loaded alerts + rules + pins + interaction (+ display clock/locale) into [AlertsListData]. */
fun deriveAlertsListData(
    alerts: List<Alert>,
    rules: List<AlertRule>,
    pins: List<PinnedItem>,
    interaction: AlertsInteraction,
    nowMillis: Long,
    zone: ZoneId,
    locale: Locale,
): AlertsListData {
    val byDay = alertsByDay(alerts, nowMillis, zone, locale)
    val byType = alertsByType(alerts)
    val filtered = filteredAlerts(alerts, interaction.filter, interaction.search)
    return AlertsListData(
        stats = computeStats(alerts),
        byType = byType,
        byDay = byDay,
        weekCount = weekAlertCount(byDay),
        mostCommon = mostCommonType(byType),
        enabledRules = enabledRulesCount(rules),
        totalRules = rules.size,
        pinned = pinnedRules(rules, pins),
        filtered = filtered,
        paged = pageSlice(filtered, interaction.page),
        pageCount = totalPages(filtered.size),
        currentPage = safePage(interaction.page, filtered.size),
    )
}

// ── Relative time + clock helpers (web `getTimeAgo` / `isQuietHoursActive`) ──────────────────────────────────────

/** The coarse bucket a relative time falls in (web `m` / `h` / `d` ago). */
enum class RelativeUnit { Minutes, Hours, Days }

/** A relative-time value the AlertCard renders as "{value}{unit} ago" (web `getTimeAgo`). */
data class RelativeTime(
    val value: Long,
    val unit: RelativeUnit,
)

/** Buckets the age of [createdAtMillis] relative to [nowMillis] into minutes / hours / days (web `getTimeAgo`). */
fun relativeTime(
    createdAtMillis: Long,
    nowMillis: Long,
): RelativeTime {
    val minutes = max(0L, (nowMillis - createdAtMillis) / MS_PER_MINUTE)
    if (minutes < MINUTES_PER_HOUR) return RelativeTime(minutes, RelativeUnit.Minutes)
    val hours = minutes / MINUTES_PER_HOUR
    if (hours < HOURS_PER_DAY) return RelativeTime(hours, RelativeUnit.Hours)
    return RelativeTime(hours / HOURS_PER_DAY, RelativeUnit.Days)
}

/** The relative-age label for an alert's `created_at`, or `null` when it is unparseable (web `getTimeAgo`). */
fun relativeTimeOrNull(
    createdAt: String,
    nowMillis: Long,
): RelativeTime? = parseEpochMillis(createdAt)?.let { relativeTime(it, nowMillis) }

/** Local time-of-day in minutes (0..1439) for the quiet-hours check (web `isQuietHoursActive` now-of-day). */
fun currentMinuteOfDay(
    nowMillis: Long,
    zone: ZoneId,
): Int {
    val time = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalTime()
    return (time.hour * MINUTES_PER_HOUR.toInt()) + time.minute
}

/** Whether the device quiet-hours window is active right now (web `isQuietHoursActive`), reusing the A6 [QuietHours]. */
fun quietHoursActive(
    quietHours: QuietHours,
    nowMillis: Long,
    zone: ZoneId,
): Boolean = quietHours.isQuiet(currentMinuteOfDay(nowMillis, zone) % MINUTES_PER_DAY)

/**
 * Parses an ISO-8601 `created_at` / `occurred_at` timestamp to epoch milliseconds, tolerating a trailing `Z`, an
 * explicit offset, or a bare local date. Returns `null` for an unparseable value so the caller skips the row
 * (web `new Date(str).getTime()` yields `NaN`, which the comparisons treat as out-of-range).
 */
fun parseEpochMillis(iso: String): Long? {
    if (iso.isBlank()) return null
    runCatching { return Instant.parse(iso).toEpochMilli() }
    runCatching { return OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
    runCatching { return LocalDate.parse(iso).atStartOfDay(ZoneId.of("UTC")).toInstant().toEpochMilli() }
    return null
}

private fun DayOfWeek.shortLabel(locale: Locale): String = getDisplayName(TextStyle.SHORT, locale)

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AlertsListPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no alert id, vehicle id, title or message payload.
 */
fun recordAlertsListPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AlertsListPageRegistration.SLUG))
}
