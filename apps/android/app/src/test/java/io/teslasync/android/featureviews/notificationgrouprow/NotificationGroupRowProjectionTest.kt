package io.teslasync.android.featureviews.notificationgrouprow

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationLogGroup
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Off-device verification of the NotificationGroupRow's pure logic — the native analogue of everything the web
 * component derives from its `group` prop + lazily-fetched members
 * (web/src/features/notifications/components/NotificationGroupRow.tsx): the singleton guard, the extra count,
 * the chrome-visibility predicates, the latest/member row projection, the relative-age bucketing, and the
 * expanded-region surface decision. It also asserts the accessibility labels the strings holder carries. Runs
 * in the :android:testReleaseUnitTest gate.
 */
class NotificationGroupRowProjectionTest {
    private val now: Long = Instant.parse("2026-06-12T12:00:00Z").toEpochMilli()

    private fun log(
        id: Long,
        readAt: String? = null,
    ): NotificationLog =
        NotificationLog(
            id = id,
            title = "Battery low",
            message = "State of charge dropped below 20%.",
            severity = "warning",
            createdAt = "2026-06-12T11:30:00Z",
            readAt = readAt,
        )

    private fun group(
        groupKey: String? = "low_battery:warning",
        latest: NotificationLog = log(10),
        count: Long = 4,
        unreadCount: Long = 3,
        vehicleIds: List<Long> = listOf(1, 2),
    ): NotificationLogGroup =
        NotificationLogGroup(
            groupKey = groupKey,
            latest = latest,
            count = count,
            unreadCount = unreadCount,
            vehicleIds = vehicleIds,
        )

    // ── Group model (web isSingleton / extraCount / chrome predicates) ────────────

    @Test
    fun modelDerivesThreadChromeForAMultiMemberGroup() {
        val model = NotificationGroupRowProjection.model(group(), archived = false, nowMillis = now)

        assertFalse(model.isSingleton)
        assertEquals(3, model.extraCount)
        assertEquals(3, model.unreadCount)
        assertEquals(2, model.vehicleCount)
        assertTrue(model.showGroupingChrome)
        assertTrue(model.showExpandToggle)
        assertTrue(model.showUnreadChip)
        assertTrue(model.showVehiclesAffected)
        assertTrue(model.showMarkRead)
    }

    @Test
    fun modelHidesAllChromeForASingletonGroup() {
        val model =
            NotificationGroupRowProjection.model(
                group(groupKey = null, count = 1, unreadCount = 1, vehicleIds = emptyList()),
                archived = false,
                nowMillis = now,
            )

        assertTrue(model.isSingleton)
        assertEquals(0, model.extraCount)
        assertFalse(model.showGroupingChrome)
        assertFalse(model.showExpandToggle)
    }

    @Test
    fun modelClampsExtraCountAndUnreadAtZero() {
        val model =
            NotificationGroupRowProjection.model(
                group(count = 0, unreadCount = 0, vehicleIds = emptyList()),
                archived = false,
                nowMillis = now,
            )

        assertEquals(0, model.extraCount)
        assertEquals(0, model.unreadCount)
        assertFalse(model.showUnreadChip)
        assertFalse(model.showVehiclesAffected)
    }

    @Test
    fun groupingChromeShowsForAllReadThreadWhenExtraMembersExist() {
        // web: !isSingleton && (extraCount > 0 || unread_count > 1)
        val model = NotificationGroupRowProjection.model(group(count = 3, unreadCount = 0), archived = false, nowMillis = now)

        assertTrue(model.showGroupingChrome)
        assertFalse(model.showUnreadChip)
        assertFalse(model.showMarkRead)
    }

    @Test
    fun markReadIsHiddenInArchivedMode() {
        // web: group.unread_count > 0 && !archived
        val active = NotificationGroupRowProjection.model(group(), archived = false, nowMillis = now)
        val archived = NotificationGroupRowProjection.model(group(), archived = true, nowMillis = now)

        assertTrue(active.showMarkRead)
        assertFalse(archived.showMarkRead)
    }

    // ── Member row projection (web NotificationRow props) ─────────────────────────

    @Test
    fun memberRowMapsFieldsAndUnreadGuard() {
        val unread = NotificationGroupRowProjection.memberRow(log(7, readAt = null), now)
        val read = NotificationGroupRowProjection.memberRow(log(8, readAt = "2026-06-12T11:45:00Z"), now)
        val blankRead = NotificationGroupRowProjection.memberRow(log(9, readAt = "   "), now)

        assertEquals(7L, unread.id)
        assertEquals("Battery low", unread.title)
        assertEquals("warning", unread.severity)
        assertFalse(unread.isRead)
        assertTrue(read.isRead)
        assertFalse("a blank read_at is treated as unread", blankRead.isRead)
        assertEquals(FreshnessAge.Minutes(30), unread.age)
    }

    @Test
    fun otherMembersExcludesTheLatestMember() {
        val members = listOf(log(10), log(9), log(8))
        val others = NotificationGroupRowProjection.otherMembers(members, latestId = 10, nowMillis = now)

        assertEquals(2, others.size)
        assertEquals(listOf(9L, 8L), others.map { it.id })
    }

    // ── Members-region surface decision (web membersLoading / membersError / empty) ─

    @Test
    fun membersSurfaceMatchesTheWebBranchPriority() {
        assertEquals(
            GroupMembersSurface.Loading,
            NotificationGroupRowProjection.membersSurface(isLoading = true, isHardError = false, otherCount = 0),
        )
        assertEquals(
            GroupMembersSurface.Error,
            NotificationGroupRowProjection.membersSurface(isLoading = false, isHardError = true, otherCount = 0),
        )
        assertEquals(
            GroupMembersSurface.Empty,
            NotificationGroupRowProjection.membersSurface(isLoading = false, isHardError = false, otherCount = 0),
        )
        assertEquals(
            GroupMembersSurface.Ready,
            NotificationGroupRowProjection.membersSurface(isLoading = false, isHardError = false, otherCount = 2),
        )
    }

    // ── Stale auto-refresh gate (web refetchOnStale) ──────────────────────────────

    @Test
    fun autoRefreshGateOnlyFiresForExpandedStaleNonErrorData() {
        assertTrue(
            NotificationGroupRowProjection.shouldAutoRefreshMembers(expanded = true, stale = true, refreshing = false, hasError = false),
        )
        assertFalse(
            NotificationGroupRowProjection.shouldAutoRefreshMembers(expanded = false, stale = true, refreshing = false, hasError = false),
        )
        assertFalse(
            NotificationGroupRowProjection.shouldAutoRefreshMembers(expanded = true, stale = false, refreshing = false, hasError = false),
        )
        assertFalse(
            NotificationGroupRowProjection.shouldAutoRefreshMembers(expanded = true, stale = true, refreshing = true, hasError = false),
        )
        assertFalse(
            NotificationGroupRowProjection.shouldAutoRefreshMembers(expanded = true, stale = true, refreshing = false, hasError = true),
        )
    }

    // ── Relative-age parsing (web created_at → getTimeAgo) ────────────────────────

    @Test
    fun relativeAgeBucketsMinutesHoursDaysAndWeeks() {
        assertEquals(FreshnessAge.JustNow, NotificationGroupRowProjection.relativeAgeOf("2026-06-12T11:59:30Z", now))
        assertEquals(FreshnessAge.Minutes(30), NotificationGroupRowProjection.relativeAgeOf("2026-06-12T11:30:00Z", now))
        assertEquals(FreshnessAge.Hours(3), NotificationGroupRowProjection.relativeAgeOf("2026-06-12T09:00:00Z", now))
        assertEquals(FreshnessAge.Days(2), NotificationGroupRowProjection.relativeAgeOf("2026-06-10T12:00:00Z", now))
        assertEquals(FreshnessAge.Weeks(2), NotificationGroupRowProjection.relativeAgeOf("2026-05-29T12:00:00Z", now))
    }

    @Test
    fun relativeAgeIsUnknownForBlankOrUnparseableTimestamps() {
        assertEquals(FreshnessAge.Unknown, NotificationGroupRowProjection.relativeAgeOf("", now))
        assertEquals(FreshnessAge.Unknown, NotificationGroupRowProjection.relativeAgeOf("   ", now))
        assertEquals(FreshnessAge.Unknown, NotificationGroupRowProjection.relativeAgeOf("not-a-date", now))
        assertEquals(FreshnessAge.Unknown, NotificationGroupRowProjection.relativeAgeOf(null, now))
    }

    @Test
    fun parseIsoAcceptsZuluOffsetAndZonelessTimestamps() {
        val expected = Instant.parse("2026-06-12T11:30:00Z").toEpochMilli()
        assertEquals(expected, NotificationGroupRowProjection.parseIsoMillis("2026-06-12T11:30:00Z"))
        assertEquals(expected, NotificationGroupRowProjection.parseIsoMillis("2026-06-12T11:30:00+00:00"))
        assertEquals(expected, NotificationGroupRowProjection.parseIsoMillis("2026-06-12T11:30:00"))
        assertNull(NotificationGroupRowProjection.parseIsoMillis(""))
        assertNull(NotificationGroupRowProjection.parseIsoMillis("garbage"))
    }

    // ── Accessibility labels (every interactive element has a localized name) ──────

    @Test
    fun stringsHolderCarriesEveryInteractiveLabel() {
        val strings =
            NotificationGroupRowStrings(
                collapse = "Hide similar",
                loadingMembers = "Loading thread members…",
                membersError = "Could not load thread members",
                noMembers = "No thread members found",
                markGroupRead = "Mark group read",
                unread = "Unread",
                rowSelect = "Select notification",
                rowMarkRead = "Mark as read",
                rowMarkUnread = "Mark as unread",
                rowArchive = "Archive",
                rowUnarchive = "Restore",
            )

        // The labels that name the expand chip's state, the mark-group-read action, the unread dot, the
        // selection checkbox, and the per-row read/archive toggles must all be present and non-blank so every
        // interactive affordance is announced to TalkBack.
        listOf(
            strings.collapse,
            strings.markGroupRead,
            strings.unread,
            strings.rowSelect,
            strings.rowMarkRead,
            strings.rowMarkUnread,
            strings.rowArchive,
            strings.rowUnarchive,
        ).forEach { assertTrue("an interactive label must be non-blank", it.isNotBlank()) }
    }
}
