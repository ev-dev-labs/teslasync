// Pure, framework-free model + projection for the InboxBody feature view — the native analogue of everything
// the web component derives before it returns JSX
// (web/src/features/notifications/components/InboxBody.tsx). No Compose, no Android, no HTTP: every declaration
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render
// layer.
//
// The web InboxBody owns URL-backed filter + view state, bulk selection, auto-mark-read on open, a per-row
// context menu, and BOTH a day-grouped flat list and a threaded grouped list. This file owns the parts of that
// contract that are pure logic and therefore verifiable without a device:
//   - groupByDay: the "Today" / "Yesterday" / dated bucketing the web `groupByDay` performs, with the same
//     newest-first preserved order and "new bucket only when the day label changes" rule.
//   - unreadCount: the web `rows.reduce(... !read_at)` tally driving the "Mark all read" affordance.
//   - selectionState: the master select-all tri-state the web `useBulkSelection.masterState` exposes.
//   - autoMarkReadIds: the ids the web auto-mark-on-open effect marks (flat inbox only, opt-out aware).
//   - sanitizeSeverities: the web severity-filter sanitization that drops hand-edited unknown values.
// Slice colors / glyph tints are resolved at the Compose boundary, so this stays free of Compose color types.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/InboxBody — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.inboxbody

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The dated-bucket pattern — the web `Intl.DateTimeFormat` (weekday long, month short, day + year numeric). */
private const val DATED_PATTERN: String = "EEEE, MMM d, yyyy"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object InboxBodyRegistration {
    /** Stable surface id. */
    const val ID: String = "inbox-body"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "InboxBody"
}

/**
 * Grouped/threaded vs flat inbox view (web `VIEW_VALUES`). Default is [Grouped] because power users with many
 * alert rules drown in flat duplicates; [Flat] remains for the historical per-delivery workflow.
 */
enum class InboxView { Grouped, Flat }

/** The read-state filter (web `READ_VALUES`): everything, only read, or only unread. */
enum class ReadFilter { All, Read, Unread }

/**
 * The three selectable severities (web `SEVERITY_VALUES`). [fromWire] tolerates the backend aliases so a
 * hand-edited filter value still maps onto a known severity, and returns `null` for anything unknown so
 * [InboxBodyProjection.sanitizeSeverities] can drop it (web's `SEVERITY_VALUES.includes` guard).
 */
enum class InboxSeverity(
    val wire: String,
) {
    Info("info"),
    Warn("warn"),
    Critical("critical"),
    ;

    companion object {
        fun fromWire(raw: String): InboxSeverity? =
            when (raw.trim().lowercase(Locale.ROOT)) {
                "info" -> Info
                "warn", "warning" -> Warn
                "critical", "error", "fatal" -> Critical
                else -> null
            }
    }
}

/**
 * One render-ready inbox row — the native mirror of a web `NotificationLog` after the parent has joined its
 * rule + vehicle. Pure data (no Compose types): the composable resolves [severity] to a token color/glyph and
 * formats [createdAtMillis] at the display boundary.
 *
 * @property id the notification log id (the bulk-selection + action key).
 * @property title the notification title.
 * @property message the notification body.
 * @property severity the raw backend severity (e.g. `critical`); normalized at render.
 * @property createdAtMillis the creation instant in epoch millis (host parses the ISO `created_at`).
 * @property isRead whether the row has a `read_at` stamp.
 * @property isArchived whether the row has an `archived_at` stamp.
 * @property canViewContext whether a "View context" drill-through exists (web `getAlertDrillthroughHref`).
 * @property ruleName the originating alert-rule name, if joined.
 * @property vehicleName the associated vehicle's display name, if joined.
 */
@Suppress("LongParameterList") // A render-ready row mirrors the web NotificationLog's joined display fields.
data class InboxNotification(
    val id: Long,
    val title: String,
    val message: String,
    val severity: String?,
    val createdAtMillis: Long,
    val isRead: Boolean,
    val isArchived: Boolean,
    val canViewContext: Boolean = false,
    val ruleName: String? = null,
    val vehicleName: String? = null,
)

/**
 * One thread head — the native mirror of a web notification group. [latest] is the most recent delivery shown
 * as the head (and the selection/action key), [count] is the number of notifications collapsed into the
 * thread, and [groupKey] is the stable backend group key (`null` for a singleton).
 */
data class InboxGroup(
    val groupKey: String?,
    val latest: InboxNotification,
    val count: Long,
)

/**
 * A day-cluster label — the web `groupByDay` header. [Today] / [Yesterday] are localized at the render
 * boundary; [Dated] already carries the locale-formatted absolute date so the composable renders it verbatim.
 */
sealed interface DayLabel {
    data object Today : DayLabel

    data object Yesterday : DayLabel

    data class Dated(
        val text: String,
    ) : DayLabel
}

/** One day-cluster of rows, in received (newest-first) order — the web `groupByDay` output element. */
data class DayBucket(
    val label: DayLabel,
    val rows: List<InboxNotification>,
)

/** The master select-all tri-state (web `useBulkSelection.masterState`). */
enum class SelectionState { None, Some, All }

/**
 * The pure projection the composable renders — the native mirror of the web component's data derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object InboxBodyProjection {
    /**
     * Buckets [rows] into "Today" / "Yesterday" / dated day-clusters keyed by the user's local day, preserving
     * the received (newest-first) order and starting a new bucket only when the day label changes — the exact
     * web `groupByDay` contract. [nowMillis], [zone] and [locale] are injected so the bucketing is
     * deterministic under test.
     */
    fun groupByDay(
        rows: List<InboxNotification>,
        nowMillis: Long,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): List<DayBucket> {
        if (rows.isEmpty()) return emptyList()
        val today = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate()
        val yesterday = today.minusDays(1)
        val formatter = DateTimeFormatter.ofPattern(DATED_PATTERN, locale)
        val buckets = mutableListOf<DayBucket>()
        val pending = mutableListOf<InboxNotification>()
        var currentLabel: DayLabel? = null
        for (row in rows) {
            val date = Instant.ofEpochMilli(row.createdAtMillis).atZone(zone).toLocalDate()
            val label = dayLabel(date, today, yesterday, formatter)
            if (currentLabel != null && currentLabel != label) {
                buckets.add(DayBucket(currentLabel, pending.toList()))
                pending.clear()
            }
            currentLabel = label
            pending.add(row)
        }
        currentLabel?.let { buckets.add(DayBucket(it, pending.toList())) }
        return buckets
    }

    /** The number of unread rows — the web `rows.reduce(... !read_at)` tally. */
    fun unreadCount(rows: List<InboxNotification>): Int = rows.count { !it.isRead }

    /**
     * The master select-all tri-state over [visibleIds] given the [selected] set (web `masterState`): [None]
     * when nothing visible is selected, [All] when every visible row is selected, otherwise [Some].
     */
    fun selectionState(
        visibleIds: List<Long>,
        selected: Set<Long>,
    ): SelectionState {
        if (visibleIds.isEmpty()) return SelectionState.None
        val selectedVisible = visibleIds.count { selected.contains(it) }
        return when (selectedVisible) {
            0 -> SelectionState.None
            visibleIds.size -> SelectionState.All
            else -> SelectionState.Some
        }
    }

    /**
     * The ids the web auto-mark-on-open effect marks read: the unread visible rows, but only on the flat Inbox
     * tab ([archived] = false, [grouped] = false) and only when the [markOnOpen] preference is on. Grouped view
     * and the Archive tab never auto-mark (web guards), so an empty list is returned there.
     */
    fun autoMarkReadIds(
        rows: List<InboxNotification>,
        archived: Boolean,
        grouped: Boolean,
        markOnOpen: Boolean,
    ): List<Long> {
        if (archived || grouped || !markOnOpen) return emptyList()
        return rows.filter { !it.isRead }.map { it.id }
    }

    /**
     * Maps raw severity filter values onto the known [InboxSeverity] set, dropping unknown values and
     * de-duplicating while preserving order — the web `severityRaw.filter(SEVERITY_VALUES.includes)` guard.
     */
    fun sanitizeSeverities(raw: List<String>): List<InboxSeverity> {
        val seen = LinkedHashSet<InboxSeverity>()
        for (value in raw) {
            InboxSeverity.fromWire(value)?.let { seen.add(it) }
        }
        return seen.toList()
    }

    private fun dayLabel(
        date: LocalDate,
        today: LocalDate,
        yesterday: LocalDate,
        formatter: DateTimeFormatter,
    ): DayLabel =
        when (date) {
            today -> DayLabel.Today
            yesterday -> DayLabel.Yesterday
            else -> DayLabel.Dated(date.format(formatter))
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [InboxBodyRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordInboxBodyOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to InboxBodyRegistration.SLUG))
}
