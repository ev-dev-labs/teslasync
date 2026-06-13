// Pure, framework-free model + projection for the NotificationBellPopover modal/dialog — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/components/layout/NotificationBellPopover.tsx). No Compose, no Android UI, no HTTP: every declaration
// here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a thin render
// layer over these pure functions.
//
// The web component is the header bell's in-place triage panel: a bell trigger carrying the live unread badge
// (web `useUnreadCount`, capped at "99+"), and — on a non-compact viewport — an anchored, non-modal popover
// listing the latest 10 unread notifications (web `useUnreadNotifications({ limit: 10 })`, mounted only while the
// panel is open), each row joining the matching alert rule (web `useAlertRules`) and vehicle (web `useVehicles`)
// for its severity dot, title, one-line message, relative time, and vehicle name, plus a "Mark all read"
// (web `useBulkMarkRead({ all: true })`) and a "View all" escape hatch. On a compact viewport the bell instead
// navigates straight to the inbox (web `useIsMobile` → `navigate('/notifications/inbox')`).
//
// This file owns exactly the parts the web component computes from those hooks: the "99+" badge cap, the
// per-row title fallback chain (web `log.title || rule?.name || t('untitled')`), the severity selection
// (web `rule?.severity ?? 'info'`, collapsed to info/warn/critical), the vehicle label
// (web `vehicle.display_name || #${vehicle.id}`), the tolerant `created_at` parse, and the relative-time
// bucketing (web `formatRelative`: just now / Xm / Xh / Xd / absolute date). The shared Notifications + Vehicles
// state holders (P1/S8) are bound through [NotificationBellPopoverSource]; the view performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/NotificationBellPopover — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling modals-dialogs / feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.notificationbellpopover

import io.teslasync.android.components.datadisplay.Severity
import io.teslasync.android.components.datadisplay.normalizeSeverity
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.BulkMarkReadVars
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import io.teslasync.shared.core.presentation.notifications.UpdatedCountResult
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException

/** The em dash rendered for a missing / unparseable timestamp — the "no value" relative-time fallback. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers and the surface's web-parity constants (P1/S11). */
object NotificationBellPopoverRegistration {
    /** Stable surface id. */
    const val ID: String = "notification-bell-popover"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "NotificationBellPopover"

    /** Bell-preview page size — the web `useUnreadNotifications({ limit: 10 })` (web `PREVIEW_LIMIT`). */
    const val PREVIEW_LIMIT: Int = 10

    /** Badge cap — counts above this render as "99+" (web `count > 99 ? '99+' : String(count)`). */
    const val MAX_BADGE_COUNT: Int = 99

    /** Navigation target for the bell-on-compact, each row, and "View all" (web `/notifications/inbox`). */
    const val INBOX_ROUTE: String = "/notifications/inbox"
}

/**
 * The data port the popover binds to — the native analogue of the web hooks the component reads
 * (`useUnreadCount` / `useUnreadNotifications` / `useAlertRules` / `useVehicles` / `useBulkMarkRead`). A concrete
 * adapter over the shared Notifications + Vehicles state holders (or a fake in tests) drives this seam; the view
 * never performs HTTP. Reads are cache-then-network [Resource] flows; the mutation is a non-throwing [Result].
 */
interface NotificationBellPopoverSource {
    /** The live unread-count feed backing the bell badge (web `useUnreadCount`). */
    fun unreadCount(): Flow<Resource<Int>>

    /** The bell-preview feed of the newest unread rows (web `useUnreadNotifications({ limit })`). */
    fun unreadNotifications(limit: Int): Flow<Resource<List<NotificationLog>>>

    /** The alert-rule list used to resolve a row's severity + vehicle (web `useAlertRules`). */
    fun alertRules(): Flow<Resource<List<AlertRule>>>

    /** The enrolled-vehicle list used to resolve a row's vehicle name (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Marks every unread row read (web `useBulkMarkRead({ all: true })`). */
    suspend fun markAllRead(): Result<UpdatedCountResult>
}

/**
 * Binds the popover to the shared **S8** [NotificationsStore] + [VehiclesStore] — the memoized, multi-observer
 * feeds every Notifications / Vehicles surface shares. The preview, rule, vehicle, and unread-count feeds fold
 * into the same shared collections as the rest of the app, and `markAllRead` routes through the store so it
 * refreshes the whole notification-log family on success (web `invalidateQueries(['notification-logs'])`).
 */
fun notificationBellPopoverSource(
    notifications: NotificationsStore,
    vehicles: VehiclesStore,
): NotificationBellPopoverSource =
    object : NotificationBellPopoverSource {
        override fun unreadCount(): Flow<Resource<Int>> = notifications.unreadCount()

        override fun unreadNotifications(limit: Int): Flow<Resource<List<NotificationLog>>> = notifications.unreadNotifications(limit)

        override fun alertRules(): Flow<Resource<List<AlertRule>>> = notifications.alertRules()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override suspend fun markAllRead(): Result<UpdatedCountResult> = notifications.bulkMarkRead(BulkMarkReadVars.All)
    }

/**
 * One fully projected, render-ready preview row — the native analogue of everything the web component reads off
 * a log (joined with its rule + vehicle) before rendering the `<li>`. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host.
 *
 * @property id the notification-log id (web React `key={log.id}`).
 * @property title the row title, or `null` when both the log title and rule name are blank — the composable then
 *   substitutes the localized `untitled` label (web `log.title || rule?.name || t('untitled')`).
 * @property message the one-line body, or `null` when blank (web shows the line only when `log.message`).
 * @property severity the dot severity — web `rule?.severity ?? 'info'`, collapsed to info/warn/critical.
 * @property vehicleLabel the vehicle chip text, or `null` when no vehicle — web `vehicle.display_name || #id`.
 * @property timestamp the parsed `created_at`, or `null` when missing/unparseable (renders [EM_DASH]).
 */
data class BellRow(
    val id: Long,
    val title: String?,
    val message: String?,
    val severity: Severity,
    val vehicleLabel: String?,
    val timestamp: Instant?,
)

/**
 * The relative-time bucket the web `formatRelative` resolves a row's `created_at` into. Pure (carries only the
 * numeric magnitude or the absolute instant) so the composable applies the localized template at render — the
 * same projection/render split the sibling NotificationRow uses for its timestamp.
 */
sealed interface BellRelativeTime {
    /** No (or unparseable) timestamp — renders [EM_DASH]. */
    data object Absent : BellRelativeTime

    /** Under a minute old — web `'just now'`. */
    data object JustNow : BellRelativeTime

    /** Under an hour old — web `${minutes}m ago`. */
    data class Minutes(
        val value: Long,
    ) : BellRelativeTime

    /** Under a day old — web `${hours}h ago`. */
    data class Hours(
        val value: Long,
    ) : BellRelativeTime

    /** Under a week old — web `${days}d ago`. */
    data class Days(
        val value: Long,
    ) : BellRelativeTime

    /** A week or older — web falls back to the absolute `formatDate` of this [instant]. */
    data class Absolute(
        val instant: Instant,
    ) : BellRelativeTime
}

/**
 * The pure projection the composable renders — the native mirror of the web component's derivations. Stateless
 * and side-effect-free (the display clock is injected into [relativeTime]) so it is fully covered by the
 * off-device unit gate.
 */
object NotificationBellPopoverProjection {
    private const val SECONDS_PER_MINUTE: Long = 60
    private const val SECONDS_PER_HOUR: Long = 60 * 60
    private const val SECONDS_PER_DAY: Long = 24 * 60 * 60
    private const val SECONDS_PER_WEEK: Long = 7 * 24 * 60 * 60

    // Tolerant decode chain matching the sibling NotificationRow: an RFC-3339 instant ("…Z"), then an offset
    // date-time, then a zoneless local date-time treated as UTC. The first that parses wins; none parsing → null.
    private val timestampParsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    /** Formats the bell badge — web `count > 99 ? '99+' : String(count)`. */
    fun formatBadgeCount(count: Int): String =
        if (count > NotificationBellPopoverRegistration.MAX_BADGE_COUNT) {
            "${NotificationBellPopoverRegistration.MAX_BADGE_COUNT}+"
        } else {
            count.toString()
        }

    /**
     * Joins the preview [logs] with their matching [rules] (by `alert_id`) and [vehicles] (by the rule's
     * `vehicle_id`) into render-ready [BellRow]s — a 1:1 port of the web component's `ruleMap` / `vehicleMap`
     * lookups and per-row derivations. Order is preserved (newest-first, as the feed delivers them).
     */
    fun projectRows(
        logs: List<NotificationLog>,
        rules: List<AlertRule>,
        vehicles: List<Vehicle>,
    ): List<BellRow> {
        val ruleById = rules.associateBy { it.id }
        val vehicleById = vehicles.associateBy { it.id }
        return logs.map { log ->
            val rule = log.alertId?.let { ruleById[it] }
            val vehicle = rule?.vehicleId?.let { vehicleById[it] }
            BellRow(
                id = log.id,
                title = pickTitle(log.title, rule?.name),
                message = log.message.takeIf { it.isNotBlank() },
                severity = bellSeverityOf(rule),
                vehicleLabel = vehicleLabel(vehicle),
                timestamp = parseTimestamp(log.createdAt),
            )
        }
    }

    /** Web `log.title || rule?.name || t('untitled')`: first non-blank of the log title then the rule name. */
    fun pickTitle(
        logTitle: String,
        ruleName: String?,
    ): String? = logTitle.takeIf { it.isNotBlank() } ?: ruleName?.takeIf { it.isNotBlank() }

    /** Web `rule?.severity ?? 'info'`, collapsed onto the bell's info/warn/critical palette. */
    fun bellSeverityOf(rule: AlertRule?): Severity =
        when (normalizeSeverity(rule?.severity)) {
            Severity.Warn -> Severity.Warn
            Severity.Critical -> Severity.Critical
            else -> Severity.Info
        }

    /** Web `vehicle.display_name || #${vehicle.id}`, or `null` when no vehicle matched. */
    fun vehicleLabel(vehicle: Vehicle?): String? = vehicle?.let { it.displayName.takeIf(String::isNotBlank) ?: "#${it.id}" }

    /**
     * Parses a `created_at` string into an [Instant], tolerating an RFC-3339 instant, an offset date-time, or a
     * zoneless local date-time (treated as UTC). Returns `null` for a blank/unparseable value.
     */
    fun parseTimestamp(raw: String): Instant? = if (raw.isBlank()) null else timestampParsers.firstNotNullOfOrNull { it(raw) }

    /**
     * Buckets a row's [timestamp] against [now] exactly as the web `formatRelative`: under a minute → just now,
     * under an hour → minutes, under a day → hours, under a week → days, otherwise the absolute date. A `null`
     * (or future) timestamp degrades gracefully ([BellRelativeTime.Absent] / [BellRelativeTime.JustNow]).
     */
    fun relativeTime(
        timestamp: Instant?,
        now: Instant,
    ): BellRelativeTime {
        timestamp ?: return BellRelativeTime.Absent
        val seconds = Duration.between(timestamp, now).seconds
        return when {
            seconds < SECONDS_PER_MINUTE -> BellRelativeTime.JustNow
            seconds < SECONDS_PER_HOUR -> BellRelativeTime.Minutes(seconds / SECONDS_PER_MINUTE)
            seconds < SECONDS_PER_DAY -> BellRelativeTime.Hours(seconds / SECONDS_PER_HOUR)
            seconds < SECONDS_PER_WEEK -> BellRelativeTime.Days(seconds / SECONDS_PER_DAY)
            else -> BellRelativeTime.Absolute(timestamp)
        }
    }

    private inline fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [NotificationBellPopoverRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a notification title, message, or vehicle name — so a diagnostics line
 * can never leak inbox content. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordNotificationBellPopoverOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to NotificationBellPopoverRegistration.SLUG))
}
