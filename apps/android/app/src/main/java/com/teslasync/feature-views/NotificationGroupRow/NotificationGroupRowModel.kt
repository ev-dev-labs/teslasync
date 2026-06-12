// Pure, framework-free model + projection for the NotificationGroupRow feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/notifications/components/NotificationGroupRow.tsx). No Compose, no Android framework, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is a server-aggregated notification THREAD: it renders the group's latest row, a grouping
// chrome row outside it ("+N similar" expand chip, an unread-count chip, a "vehicles affected" caption, and a
// "Mark group read" action), and a lazily-fetched expanded member list. Singleton groups (group_key == null)
// hide all grouping chrome so they look identical to a flat row. This file owns exactly the parts the web
// component computes from its `group` prop: the singleton guard (web `group.group_key == null`), the extra
// count (web `Math.max(0, group.count - 1)`), the chrome-visibility predicates (web `!isSingleton && (...)`,
// `group.unread_count > 0`, `group.vehicle_ids.length > 0`, `... && !archived`), the latest/member row
// projection, and the expanded region's loading/error/empty/ready branch decision (web `membersLoading` /
// `membersError` / `otherMembers.length === 0`). Relative ages reuse the shared freshness bucketing so the row
// stamp agrees with the rest of the app.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/NotificationGroupRow — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.notificationgrouprow

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationLogGroup
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no notification id, title, or
 * VIN, so a diagnostics line can never leak the thread's content.
 */
const val NOTIFICATION_GROUP_ROW_SLUG: String = "NotificationGroupRow"

/** Em dash shown when a relative age is unavailable — the "no value" fallback for the row's time stamp. */
internal const val EM_DASH: String = "\u2014"

/**
 * The already-localized, non-plural microcopy the composable reads from the i18n catalog (P1/S10). The
 * plural-dependent strings (the "+N similar" chip, the "Show N similar" toggle label, the "N vehicles affected"
 * caption) are resolved inline with `pluralStringResource` at the Compose boundary, so this holder stays a thin
 * content carrier for the fixed-text labels and accessibility names.
 *
 * @property collapse the expanded region's name + the "Hide similar" toggle label (web `group.collapse`).
 * @property loadingMembers the thread-members loading status (web `group.loadingMembers`).
 * @property membersError the thread-members failure message (web `group.membersError`).
 * @property noMembers the thread-members empty message (web `group.noMembers`).
 * @property markGroupRead the "Mark group read" action label + accessibility name (web `group.markRead`).
 * @property unread the accessibility label for an unread row's status dot (web `Unread`).
 * @property rowSelect the accessibility label for a row's selection checkbox (web `inbox.row.select`).
 * @property rowMarkRead the accessibility name for a row's mark-read action (web `inbox.row.markRead`).
 * @property rowMarkUnread the accessibility name for a row's mark-unread action (web `inbox.row.markUnread`).
 * @property rowArchive the accessibility name for a row's archive action (web `inbox.row.archive`).
 * @property rowUnarchive the accessibility name for a row's restore action (web `inbox.row.unarchive`).
 */
data class NotificationGroupRowStrings(
    val collapse: String,
    val loadingMembers: String,
    val membersError: String,
    val noMembers: String,
    val markGroupRead: String,
    val unread: String,
    val rowSelect: String,
    val rowMarkRead: String,
    val rowMarkUnread: String,
    val rowArchive: String,
    val rowUnarchive: String,
)

/**
 * The projected render model for one notification row (the group's latest member, or any expanded member) — the
 * native analogue of the props the web component hands to its child `NotificationRow`.
 *
 * @property id the notification-log id; the selection set + the per-row callbacks key off it.
 * @property title the row title (web `log.title`).
 * @property message the row body (web `log.message`).
 * @property severity the raw wire severity, normalized by the render layer for the status dot.
 * @property isRead whether the row has been read (web `Boolean(log.read_at)`), gating the unread dot + actions.
 * @property age the relative-age bucket of `created_at`, formatted to a localized string by the render layer.
 */
data class NotificationMemberRow(
    val id: Long,
    val title: String,
    val message: String,
    val severity: String?,
    val isRead: Boolean,
    val age: FreshnessAge,
)

/**
 * The projected render model for the whole group row — every visibility predicate the web component evaluates
 * before drawing the grouping chrome, plus the latest-row projection.
 *
 * @property isSingleton whether the group is a single delivery (web `group.group_key == null`); hides chrome.
 * @property extraCount the additional members beyond the latest (web `Math.max(0, group.count - 1)`).
 * @property unreadCount the unread members in the thread (web `group.unread_count`).
 * @property vehicleCount the distinct vehicles the thread spans (web `group.vehicle_ids.length`).
 * @property showGroupingChrome whether the chrome row renders at all (web `!isSingleton && (extra>0 || unread>1)`).
 * @property showExpandToggle whether the "+N similar" expand toggle renders (web `extraCount > 0`).
 * @property showUnreadChip whether the unread-count chip renders (web `group.unread_count > 0`).
 * @property showVehiclesAffected whether the "N vehicles affected" caption renders (web `vehicle_ids.length > 0`).
 * @property showMarkRead whether the "Mark group read" action renders (web `group.unread_count > 0 && !archived`).
 * @property latest the projected latest-member row.
 */
data class NotificationGroupRowModel(
    val isSingleton: Boolean,
    val extraCount: Int,
    val unreadCount: Int,
    val vehicleCount: Int,
    val showGroupingChrome: Boolean,
    val showExpandToggle: Boolean,
    val showUnreadChip: Boolean,
    val showVehiclesAffected: Boolean,
    val showMarkRead: Boolean,
    val latest: NotificationMemberRow,
)

/**
 * Which surface the expanded thread-members region renders — the native analogue of the web member-region
 * ternary (`membersLoading` ▸ spinner, `membersError` ▸ error, `otherMembers.length === 0` ▸ empty, else rows).
 */
enum class GroupMembersSurface { Loading, Error, Empty, Ready }

/** Pure projection of a [NotificationLogGroup] + its lazily-fetched members onto the render models. */
object NotificationGroupRowProjection {
    /**
     * Projects the group + the parent's `archived` mode onto the [NotificationGroupRowModel]. [nowMillis] fixes
     * the relative-age clock for tests; production passes the wall clock.
     */
    fun model(
        group: NotificationLogGroup,
        archived: Boolean,
        nowMillis: Long,
    ): NotificationGroupRowModel {
        val singleton = group.groupKey == null
        val extra = (group.count - 1L).coerceAtLeast(0L).toInt()
        return NotificationGroupRowModel(
            isSingleton = singleton,
            extraCount = extra,
            unreadCount = group.unreadCount.coerceAtLeast(0L).toInt(),
            vehicleCount = group.vehicleIds.size,
            showGroupingChrome = !singleton && (extra > 0 || group.unreadCount > 1L),
            showExpandToggle = extra > 0,
            showUnreadChip = group.unreadCount > 0L,
            showVehiclesAffected = group.vehicleIds.isNotEmpty(),
            showMarkRead = group.unreadCount > 0L && !archived,
            latest = memberRow(group.latest, nowMillis),
        )
    }

    /** Projects one notification log onto a [NotificationMemberRow] (used for the latest + expanded members). */
    fun memberRow(
        log: NotificationLog,
        nowMillis: Long,
    ): NotificationMemberRow =
        NotificationMemberRow(
            id = log.id,
            title = log.title,
            message = log.message,
            severity = log.severity,
            isRead = !log.readAt.isNullOrBlank(),
            age = relativeAgeOf(log.createdAt, nowMillis),
        )

    /**
     * The expanded list minus the latest member — the web `members.filter((m) => m.id !== latest.id)`. Keeps the
     * latest from rendering twice (once as the always-visible row, once inside the thread).
     */
    fun otherMembers(
        members: List<NotificationLog>,
        latestId: Long,
        nowMillis: Long,
    ): List<NotificationMemberRow> =
        members
            .asSequence()
            .filter { it.id != latestId }
            .map { memberRow(it, nowMillis) }
            .toList()

    /**
     * Picks the expanded region's surface from the cache-then-network flags + the resolved member count. A first
     * load (no cache) shows the loading spinner; a hard failure (no cache) shows the error; an empty resolved
     * thread shows the friendly empty state; anything else shows the member rows (stale/offline is handled
     * separately by the freshness chip, which keeps the last-known rows visible).
     */
    fun membersSurface(
        isLoading: Boolean,
        isHardError: Boolean,
        otherCount: Int,
    ): GroupMembersSurface =
        when {
            isLoading -> GroupMembersSurface.Loading
            isHardError -> GroupMembersSurface.Error
            otherCount == 0 -> GroupMembersSurface.Empty
            else -> GroupMembersSurface.Ready
        }

    /**
     * Whether the expanded member feed should auto-refresh: it is showing stale/offline data, no refresh is
     * already in flight, and it is not a hard error (which offers an explicit retry instead). Extracted so the
     * Compose freshness effect stays a single-predicate call (web `refetchOnStale`).
     */
    fun shouldAutoRefreshMembers(
        expanded: Boolean,
        stale: Boolean,
        refreshing: Boolean,
        hasError: Boolean,
    ): Boolean = expanded && stale && !refreshing && !hasError

    /** Relative-age bucket of an ISO-8601 `created_at` against [nowMillis]; [FreshnessAge.Unknown] if unparseable. */
    fun relativeAgeOf(
        iso: String?,
        nowMillis: Long,
    ): FreshnessAge = relativeAge(computeAgeSeconds(parseIsoMillis(iso), nowMillis))

    /**
     * Parses an ISO-8601 timestamp to epoch millis, tolerating a trailing `Z`, an explicit offset, or a
     * zoneless local time (assumed UTC — the backend serves UTC). Returns `null` for blank/unparseable input.
     */
    internal fun parseIsoMillis(iso: String?): Long? {
        val raw = iso?.trim()
        if (raw.isNullOrEmpty()) return null
        return runCatching { Instant.parse(raw).toEpochMilli() }
            .recoverCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
            .recoverCatching { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC).toEpochMilli() }
            .getOrNull()
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [NOTIFICATION_GROUP_ROW_SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from a first-composition
 * effect.
 */
fun recordNotificationGroupRowOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to NOTIFICATION_GROUP_ROW_SLUG))
}
