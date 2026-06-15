// Pure, framework-free model + derivations for the ArchivedPage notifications surface — the native analogue of
// everything the web page joins before it hands the inbox feeds to <InboxBody archived/>
// (web/src/features/notifications/pages/ArchivedPage.tsx + the ruleMap/vehicleMap join in
// web/src/features/notifications/components/InboxBody.tsx). No Compose, no Android framework, no HTTP lives
// here: every type is exercised off-device, keeping the composable a thin render layer.
//
// The page itself owns only two web hooks (`useVehicles`, `useAlertRules`); the shared A3 InboxBody owns the
// notification-log feeds. The web component builds a `ruleMap` (rule.id -> rule) and `vehicleMap`
// (vehicle.id -> vehicle) from those two lists, then per row resolves `rule = ruleMap[log.alert_id]` and
// `vehicle = vehicleMap[rule.vehicle_id]` to label the row and decide whether a "View context" drill-through
// exists. This file reproduces exactly that join, decoded once and shared with the [InboxNotification] render
// model. No notification field here is unit-bearing (ids, ISO timestamps, free text, a severity enum), so
// there is no SI conversion — locale / date formatting is applied at the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/notifications — the P3 prompt's allowed-files path) cannot form the package the rest of the
// app's `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly
// as the sibling FeedbackQueuePage / TemperatureImpactPage surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.notifications.archived

import io.teslasync.android.featureviews.inboxbody.InboxGroup
import io.teslasync.android.featureviews.inboxbody.InboxNotification
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.NotificationFilters
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationLogGroup
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException

/**
 * Canonical metadata for the ArchivedPage surface. The web page is a top-level notifications route, not a
 * draggable dashboard widget, so there is no web registry row to mirror — this object carries the
 * cross-cutting concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (already a
 * metadata-only destination at Destinations.kt) and the diagnostics [SLUG] emitted with the one-shot
 * `view.opened` event (P1/S11).
 */
object ArchivedPageRegistration {
    /** The navigation destination id (Destinations.kt `page("notificationsArchived", "/notifications/archived", …)`). */
    const val ROUTE_ID: String = "notificationsArchived"

    /** The web route this surface mirrors (deep-link target + the copy-link payload). */
    const val WEB_PATH: String = "/notifications/archived"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ArchivedPage"
}

/**
 * The notification-log filter the page scopes its feeds to — the web `archived` prop turned into the
 * `archived=true` server filter the shared `useNotificationLogs` / `useNotificationGroups` reads carry on the
 * Archive tab. Every other field defaults so the page asks the backend only for archived rows.
 */
val ARCHIVED_FILTERS: NotificationFilters = NotificationFilters(archived = true)

/**
 * Joins the flat notification-log list with the page's alert-rule + vehicle lists into the render-ready
 * [InboxNotification] rows the shared InboxBody draws — the native mirror of the web component's `ruleMap`
 * / `vehicleMap` enrichment. [rules] and [vehicles] are the latest values of the page's two web hooks
 * (`useAlertRules`, `useVehicles`); when either has not loaded yet the row simply renders without that label,
 * exactly as the web defaults both to `[]`.
 */
fun toInboxNotifications(
    logs: List<NotificationLog>,
    rules: List<AlertRule>,
    vehicles: List<Vehicle>,
): List<InboxNotification> {
    val ruleMap = rules.associateBy { it.id }
    val vehicleMap = vehicles.associateBy { it.id }
    return logs.map { log -> toInboxNotification(log, ruleMap, vehicleMap) }
}

/**
 * Joins the server-aggregated notification threads with the same rule + vehicle maps into [InboxGroup] heads.
 * Mirrors [toInboxNotifications] for the grouped feed; the Archive tab never renders the grouped view (web
 * disables grouping when `archived`), but the feed is bound so the surface carries no synthetic state.
 */
fun toInboxGroups(
    groups: List<NotificationLogGroup>,
    rules: List<AlertRule>,
    vehicles: List<Vehicle>,
): List<InboxGroup> {
    val ruleMap = rules.associateBy { it.id }
    val vehicleMap = vehicles.associateBy { it.id }
    return groups.map { group ->
        InboxGroup(
            groupKey = group.groupKey,
            latest = toInboxNotification(group.latest, ruleMap, vehicleMap),
            count = group.count,
        )
    }
}

/**
 * The single-row join — the verbatim port of the web `buildRowContextMenu` lookups: `rule` is the alert rule
 * keyed by `log.alert_id`, `vehicle` is the rule's vehicle, `canViewContext` is whether a drill-through
 * target (a rule) exists, and the read/archived flags come from the `read_at` / `archived_at` stamps.
 */
private fun toInboxNotification(
    log: NotificationLog,
    ruleMap: Map<Long, AlertRule>,
    vehicleMap: Map<Long, Vehicle>,
): InboxNotification {
    val rule = log.alertId?.let { ruleMap[it] }
    val vehicle = rule?.vehicleId?.let { vehicleMap[it] }
    return InboxNotification(
        id = log.id,
        title = log.title,
        message = log.message,
        severity = log.severity,
        createdAtMillis = parseIsoMillis(log.createdAt),
        isRead = log.readAt != null,
        isArchived = log.archivedAt != null,
        canViewContext = rule != null,
        ruleName = rule?.name?.takeIf { it.isNotBlank() },
        vehicleName = vehicle?.displayName?.takeIf { it.isNotBlank() },
    )
}

/**
 * Parses an RFC-3339 / ISO-8601 instant (the web `new Date(log.created_at)`) into epoch millis for the
 * render-boundary day grouping + relative formatting. Tolerates both an explicit offset and a bare `Z`, and
 * falls back to the epoch for a missing/unparseable stamp so a partial payload still renders rather than
 * throwing.
 */
internal fun parseIsoMillis(iso: String): Long {
    if (iso.isBlank()) return 0L
    return try {
        OffsetDateTime.parse(iso).toInstant().toEpochMilli()
    } catch (_: DateTimeParseException) {
        try {
            Instant.parse(iso).toEpochMilli()
        } catch (_: DateTimeParseException) {
            0L
        }
    }
}

/** Maps a [Resource]'s `data`/`cached` payload through [transform], preserving the freshness flags (ADR-013). */
internal fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ArchivedPageRegistration.SLUG] (P1/S11);
 * carries no notification content. The composable calls it from its first-composition effect.
 */
internal fun recordArchivedPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ArchivedPageRegistration.SLUG))
}
