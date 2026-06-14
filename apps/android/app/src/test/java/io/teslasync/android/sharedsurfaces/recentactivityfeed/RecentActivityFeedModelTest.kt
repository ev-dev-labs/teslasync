package io.teslasync.android.sharedsurfaces.recentactivityfeed

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset

/**
 * Off-device verification of the RecentActivityFeed surface's pure logic — the native analogue of the web
 * libraries the `RecentActivityFeed` component consumes: [getActivityVisual] mirrors `activityIcons.ts`
 * (the registry + prefix-walk fallback), [entityHref] / [encodeUriComponent] mirror the web `entityHref`,
 * [parseActivityTimestampMillis] + [activityTime] mirror `formatRelative`'s bucketing, [AuditLogRow.toActivityEntry]
 * + [UserActivityEntry.toRow] mirror the component's per-entry derivation, [RecentActivityFeedState] mirrors the
 * web parent's `entries` state + load lifecycle, and the PII-safe `view.opened` diagnostic carries only the
 * surface slug. Runs in the offline `:android:testReleaseUnitTest` gate; the Compose rendering + accessibility
 * are covered on-device by RecentActivityFeedUiTest.
 */
class RecentActivityFeedModelTest {
    // ── Registry parity (web `activityIcons.ts getActivityVisual`) ────────────────────────────────────

    @Test
    fun getActivityVisualReturnsTheExactRegistryHit() {
        val wake = getActivityVisual("vehicle.command.wake")
        assertEquals(ActivityGlyph.Power, wake.glyph)
        assertEquals(ActivityAccent.Amber, wake.accent)
        assertEquals("activity.action.vehicleCommandWake", wake.labelKey)
        assertEquals("Wake vehicle", wake.fallback)
    }

    @Test
    fun getActivityVisualWalksDownToAShorterPrefix() {
        // No `vehicle.command.foo` key -> falls back to `vehicle.command` (web prefix walk).
        val cmd = getActivityVisual("vehicle.command.foo")
        assertEquals("activity.action.vehicleCommand", cmd.labelKey)
        assertEquals(ActivityGlyph.Gamepad, cmd.glyph)

        // No `alert.rule.foo` and no bare `alert.rule` key -> walks past it to `alert`.
        val alert = getActivityVisual("alert.rule.foo")
        assertEquals("activity.action.alert", alert.labelKey)
    }

    @Test
    fun getActivityVisualFallsBackForAnUnknownOrBlankAction() {
        assertEquals(ACTIVITY_FALLBACK, getActivityVisual("totally.unknown.action"))
        assertEquals(ACTIVITY_FALLBACK, getActivityVisual(""))
        assertEquals(ActivityGlyph.History, getActivityVisual("nope").glyph)
        assertEquals(ActivityAccent.Muted, getActivityVisual("nope").accent)
    }

    @Test
    fun authLogoutAndAuthUseTheMutedAccent() {
        assertEquals(ActivityAccent.Muted, getActivityVisual("auth.logout").accent)
        assertEquals(ActivityAccent.Muted, getActivityVisual("auth").accent)
        assertEquals(ActivityAccent.Emerald, getActivityVisual("auth.login").accent)
    }

    @Test
    fun everyRegistryLabelKeyHasACatalogMappingAndOpaqueAccent() {
        // Every accent except the theme-resolved Muted carries a fully-opaque 0xFF ARGB (web fixed hex).
        (ACTIVITY_REGISTRY.values + ACTIVITY_FALLBACK).forEach { visual ->
            assertTrue("labelKey namespaced", visual.labelKey.startsWith("activity.action."))
            val argb = visual.accent.argb
            if (argb != null) {
                assertEquals("alpha of ${visual.accent}", 0xFFL, (argb ushr 24) and 0xFF)
            }
        }
    }

    // ── Entity routing (web `entityHref`) ─────────────────────────────────────────────────────────────

    @Test
    fun entityHrefMapsParameterisedRoutes() {
        assertEquals("/vehicles/3", entityHref("vehicle", "3"))
        assertEquals("/drives/9", entityHref("drive", "9"))
        assertEquals("/charging/7", entityHref("charging_session", "7"))
        assertEquals("/charging/7", entityHref("charge", "7"))
    }

    @Test
    fun entityHrefMapsFixedRoutesIgnoringTheId() {
        assertEquals("/notifications/alerts", entityHref("alert_rule", "12"))
        assertEquals("/automations", entityHref("automation", "5"))
        assertEquals("/geofences", entityHref("geofence", "1"))
        assertEquals("/data-export", entityHref("data_export", "1"))
        assertEquals("/data-export", entityHref("export", "1"))
        assertEquals("/api-keys", entityHref("api_key", "1"))
    }

    @Test
    fun entityHrefIsNullWhenUnroutableOrIncomplete() {
        assertNull(entityHref("widget", "1"))
        assertNull(entityHref(null, "1"))
        assertNull(entityHref("vehicle", null))
        assertNull(entityHref("vehicle", ""))
        assertNull(entityHref("", "1"))
    }

    @Test
    fun entityHrefPercentEncodesTheId() {
        assertEquals("/vehicles/a%20b", entityHref("vehicle", "a b"))
        assertEquals("/drives/x%2Fy", entityHref("drive", "x/y"))
    }

    @Test
    fun encodeUriComponentMatchesTheJsContract() {
        assertEquals("3", encodeUriComponent("3"))
        assertEquals("a%20b", encodeUriComponent("a b"))
        assertEquals("x%2Fy", encodeUriComponent("x/y"))
        // Unreserved characters are left untouched, exactly like encodeURIComponent.
        assertEquals("Az9-_.!~*'()", encodeUriComponent("Az9-_.!~*'()"))
    }

    // ── Timestamp parsing + bucketing (web `formatRelative`) ──────────────────────────────────────────

    @Test
    fun parseTimestampHandlesZoffsetAndBareForms() {
        assertEquals(
            Instant.parse("2024-05-01T12:00:00Z").toEpochMilli(),
            parseActivityTimestampMillis("2024-05-01T12:00:00Z"),
        )
        assertEquals(
            OffsetDateTime.parse("2024-05-01T12:00:00+02:00").toInstant().toEpochMilli(),
            parseActivityTimestampMillis("2024-05-01T12:00:00+02:00"),
        )
        assertEquals(
            LocalDateTime.parse("2024-05-01T12:00:00").toInstant(ZoneOffset.UTC).toEpochMilli(),
            parseActivityTimestampMillis("2024-05-01T12:00:00"),
        )
    }

    @Test
    fun parseTimestampReturnsNullForUnparseableInput() {
        assertNull(parseActivityTimestampMillis("not-a-date"))
        assertNull(parseActivityTimestampMillis(""))
        assertNull(parseActivityTimestampMillis("   "))
    }

    @Test
    fun activityTimeBucketsUnderSevenDaysRelatively() {
        val now = 1_000_000_000_000L
        assertEquals(ActivityTime.Relative(FreshnessAge.JustNow), activityTime(now, now))
        assertEquals(ActivityTime.Relative(FreshnessAge.Minutes(5)), activityTime(now - 5 * 60_000L, now))
        assertEquals(ActivityTime.Relative(FreshnessAge.Hours(3)), activityTime(now - 3 * 3_600_000L, now))
        assertEquals(ActivityTime.Relative(FreshnessAge.Days(2)), activityTime(now - 2 * 86_400_000L, now))
        assertEquals(ActivityTime.Relative(FreshnessAge.Days(6)), activityTime(now - 6 * 86_400_000L, now))
    }

    @Test
    fun activityTimeBecomesAbsoluteAtSevenDaysAndUnknownWhenNull() {
        val now = 1_000_000_000_000L
        val tenDaysAgo = now - 10 * 86_400_000L
        assertEquals(ActivityTime.Absolute(tenDaysAgo), activityTime(tenDaysAgo, now))
        // Exactly seven days crosses to absolute (web `days < 7` is the relative ceiling).
        val sevenDaysAgo = now - 7 * 86_400_000L
        assertEquals(ActivityTime.Absolute(sevenDaysAgo), activityTime(sevenDaysAgo, now))
        assertEquals(ActivityTime.Unknown, activityTime(null, now))
    }

    // ── Adapter: cached row -> render projection ──────────────────────────────────────────────────────

    @Test
    fun toActivityEntryDropsThePiiColumns() {
        val row =
            AuditLogRow(
                id = 42,
                ts = "2024-05-01T12:00:00Z",
                action = "vehicle.command.wake",
                entityType = "vehicle",
                entityId = "3",
                detail = "Model 3",
                ip = "10.0.0.1",
                userAgent = "Mozilla/5.0",
            )

        val entry = row.toActivityEntry()

        assertEquals(42L, entry.id)
        assertEquals("vehicle.command.wake", entry.action)
        assertEquals("vehicle", entry.entityType)
        assertEquals("3", entry.entityId)
        assertEquals("Model 3", entry.detail)
        // The render shape has no ip / user_agent fields — they never reach the view.
    }

    @Test
    fun toRowBuildsTheEntityAndDetailSubtitle() {
        val now = 1_000_000_000_000L
        val row = entry(action = "vehicle.command.wake", type = "vehicle", id = "3", detail = "Model 3").toRow(now)

        assertEquals("7", row.id)
        assertEquals(ActivityGlyph.Power, row.glyph)
        assertEquals("activity.action.vehicleCommandWake", row.titleKey)
        assertEquals("vehicle \u00B7 3 \u2014 Model 3", row.subtitle)
        assertEquals("/vehicles/3", row.href)
    }

    @Test
    fun toRowSubtitleVariantsMatchTheWeb() {
        val now = 1_000_000_000_000L
        // entity_type only (no id) -> just the type.
        assertEquals("vehicle", entry(type = "vehicle", id = null, detail = null).toRow(now).subtitle)
        // detail only -> just the detail.
        assertEquals("hello", entry(type = null, id = null, detail = "hello").toRow(now).subtitle)
        // nothing -> null (web `subtitleText || undefined`).
        assertNull(entry(type = null, id = null, detail = null).toRow(now).subtitle)
        // unroutable entity -> no href.
        assertNull(entry(type = "widget", id = "1", detail = null).toRow(now).href)
    }

    // ── State holder (web parent `entries` + load lifecycle) ──────────────────────────────────────────

    @Test
    fun stateStartsLoading() {
        assertTrue(RecentActivityFeedState().state.value.isLoading)
    }

    @Test
    fun submitPublishesContentOrEmpty() {
        val state = RecentActivityFeedState()
        state.submit(listOf(entry()), fetchedAtMillis = 123L)
        assertEquals(UiPhase.Content, state.state.value.phase)
        assertEquals(123L, state.state.value.fetchedAt)

        state.submit(emptyList())
        assertEquals(UiPhase.Empty, state.state.value.phase)
    }

    @Test
    fun submitRowsProjectsCachedRowsThroughTheAdapter() {
        val state = RecentActivityFeedState()
        state.submitRows(
            listOf(
                AuditLogRow(1, "2024-05-01T12:00:00Z", "auth.login", null, null, null, ip = "1.1.1.1"),
                AuditLogRow(2, "2024-05-01T12:05:00Z", "vehicle.command.lock", "vehicle", "9", null),
            ),
        )
        val data = state.state.value.data
        assertEquals(listOf(1L, 2L), data?.map { it.id })
        assertEquals(UiPhase.Content, state.state.value.phase)
    }

    @Test
    fun lifecycleWritersFlipTheExpectedFlags() {
        val state = RecentActivityFeedState()
        val cached = listOf(entry())

        state.refreshing(cached, fetchedAtMillis = 5L)
        assertTrue(state.state.value.refreshing)

        state.stale(cached, fetchedAtMillis = 5L)
        assertTrue(state.state.value.stale)
        assertNull(state.state.value.errorKind)

        state.offline(cached, fetchedAtMillis = 5L)
        assertTrue(state.state.value.stale)
        assertTrue(state.state.value.isOffline)
        assertEquals(ErrorKind.Network, state.state.value.errorKind)

        state.error(ErrorKind.Http, httpStatus = 500)
        assertEquals(UiPhase.Error, state.state.value.phase)
        assertEquals(ErrorKind.Http, state.state.value.errorKind)
        assertEquals(500, state.state.value.httpStatus)
    }

    // ── Diagnostics: PII-safe view.opened (P1/S11) ────────────────────────────────────────────────────

    @Test
    fun diagnosticsSlugMatchesThePromptMandatedSurfaceSlug() {
        assertEquals("RecentActivityFeed", RecentActivityFeedDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsThePiiSafeInfoEvent() {
        val logger = RecordingLogger()

        RecentActivityFeedDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        // Only the slug is logged — never an action, entity id, detail, or timestamp.
        assertEquals(mapOf("surface" to "RecentActivityFeed"), fields)
    }

    private fun entry(
        action: String = "auth.login",
        type: String? = "vehicle",
        id: String? = "3",
        detail: String? = null,
    ): UserActivityEntry =
        UserActivityEntry(
            id = 7,
            ts = "2024-05-01T12:00:00Z",
            action = action,
            entityType = type,
            entityId = id,
            detail = detail,
        )

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
