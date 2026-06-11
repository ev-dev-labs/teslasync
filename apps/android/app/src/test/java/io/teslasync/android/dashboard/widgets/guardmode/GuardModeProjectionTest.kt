package io.teslasync.android.dashboard.widgets.guardmode

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.guard.GuardConfig
import io.teslasync.shared.core.presentation.guard.GuardEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the GuardModeWidget's pure logic — the event-type → glyph/tone/label map, the
 * int formatter, the sensitivity subtitle, the projection (armed/disarmed + ON/OFF, the event-count badge
 * text, the feed sort+cap+subtitle+a11y, the compact a11y phrase), the [combineGuard] adapter (the web
 * `isLoading || isError || isStale` OR-combination + the config-primary body/hard-error gate), the registry
 * metadata, and the tolerant timestamp parse. Mirrors the web spec
 * (web/src/features/dashboard/widgets/GuardModeWidget.tsx) and the shared S8 Guard contract.
 */
class GuardModeProjectionTest {
    private val now = parseEpochMillis("2026-06-06T12:05:00Z")!!

    private fun strings(): GuardModeStrings =
        GuardModeStrings(
            title = "Guard Mode",
            armed = "Armed",
            disarmed = "Disarmed",
            on = "ON",
            off = "OFF",
            sensitivityLabel = "Sensitivity",
            autoPanicLabel = "Auto-panic",
            eventsWord = "events",
            acknowledged = "Acknowledged",
            unacknowledged = "Unacknowledged",
            noEventsMessage = "No guard events",
            noDataMessage = "No guard data",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            formatRelative = ::renderRelative,
        )

    private fun config(
        enabled: Boolean = true,
        sensitivity: String = "medium",
        autoPanic: Boolean = false,
    ): GuardConfig =
        GuardConfig(
            vehicleId = 1L,
            enabled = enabled,
            homeGeofenceId = null,
            sensitivity = sensitivity,
            autoPanic = autoPanic,
            createdAt = "2026-06-01T00:00:00Z",
            updatedAt = "2026-06-06T12:00:00Z",
        )

    private fun event(
        id: Long = 1,
        eventType: String = "vehicle_moved",
        ts: String = "2026-06-06T12:00:00Z",
        acknowledgedAt: String? = null,
    ): GuardEvent =
        GuardEvent(
            id = id,
            vehicleId = 1L,
            ts = ts,
            eventType = eventType,
            acknowledgedAt = acknowledgedAt,
        )

    private fun project(
        config: GuardConfig,
        events: List<GuardEvent>,
        size: GuardModeSize = GuardModeRegistration.defaultSize,
    ): GuardModeDisplay = GuardModeProjection.project(config, events, size, strings(), now)

    // ---- status (armed/disarmed, ON/OFF) --------------------------------------------

    @Test
    fun armedConfigProjectsArmedAndOn() {
        val display = project(config(enabled = true), emptyList())
        assertEquals("Armed", display.statusLabel)
        assertEquals("ON", display.onOffLabel)
        assertTrue(display.enabled)
        assertTrue(display.statusIsArmed)
    }

    @Test
    fun disarmedConfigProjectsDisarmedAndOff() {
        val display = project(config(enabled = false), emptyList())
        assertEquals("Disarmed", display.statusLabel)
        assertEquals("OFF", display.onOffLabel)
        assertFalse(display.statusIsArmed)
    }

    // ---- sensitivity subtitle (web "Sensitivity: x · Auto-panic") --------------------

    @Test
    fun sensitivitySubtitleOmitsAutoPanicWhenOff() {
        assertEquals("Sensitivity: medium", GuardModeProjection.sensitivitySubtitle(config(autoPanic = false), strings()))
    }

    @Test
    fun sensitivitySubtitleAppendsAutoPanicWhenOn() {
        assertEquals(
            "Sensitivity: high \u00b7 Auto-panic",
            GuardModeProjection.sensitivitySubtitle(config(sensitivity = "high", autoPanic = true), strings()),
        )
    }

    @Test
    fun blankSensitivityFallsBackToEmDash() {
        assertEquals("Sensitivity: \u2014", GuardModeProjection.sensitivitySubtitle(config(sensitivity = ""), strings()))
    }

    // ---- event-count badge (web "{fmtInt(n)} events") -------------------------------

    @Test
    fun eventCountTextAndActiveFlag() {
        val none = project(config(), emptyList())
        assertEquals("0 events", none.eventCountText)
        assertFalse(none.eventCountIsActive)

        val some = project(config(), listOf(event(id = 1), event(id = 2)))
        assertEquals("2 events", some.eventCountText)
        assertTrue(some.eventCountIsActive)
    }

    @Test
    fun eventCountFormatsWithGroupingSeparator() {
        val events = (1..1_200).map { event(id = it.toLong()) }
        assertEquals("1,200 events", project(config(), events).eventCountText)
    }

    @Test
    fun compactContentDescriptionFoldsStatusAndCount() {
        val display = project(config(enabled = true), listOf(event()), GuardModeSize(cols = 1, rows = 2))
        assertEquals("Armed, 1 events", display.compactContentDescription)
        assertTrue(display.isCompact)
    }

    // ---- event-type → glyph/tone/label map (web EVENT_TYPE_MAP + default) ------------

    @Test
    fun eventTypeTokensMatchWebMap() {
        assertEquals(GuardEventTypeTokens.Info(GuardEventGlyph.Location, GuardEventTone.Warning, "Vehicle Moved"), tok("vehicle_moved"))
        assertEquals(
            GuardEventTypeTokens.Info(GuardEventGlyph.Lock, GuardEventTone.Critical, "Unauthorized Unlock"),
            tok("unauthorized_unlock"),
        )
        assertEquals(
            GuardEventTypeTokens.Info(GuardEventGlyph.Drive, GuardEventTone.Critical, "Unauthorized Drive"),
            tok("unauthorized_drive"),
        )
        assertEquals(GuardEventTypeTokens.Info(GuardEventGlyph.Eye, GuardEventTone.Info, "Sentry Triggered"), tok("sentry_triggered"))
        assertEquals(GuardEventTypeTokens.Info(GuardEventGlyph.Siren, GuardEventTone.Critical, "Panic Alert"), tok("manual_panic"))
        assertEquals(GuardEventTypeTokens.Info(GuardEventGlyph.Flask, GuardEventTone.Accent, "Test Alert"), tok("test_alert"))
        assertEquals(GuardEventTypeTokens.Info(GuardEventGlyph.Shield, GuardEventTone.Info, "Lock State Changed"), tok("locked"))
        assertEquals(GuardEventTypeTokens.Info(GuardEventGlyph.Eye, GuardEventTone.Warning, "Sentry Mode"), tok("sentry_mode"))
        assertEquals(GuardEventTypeTokens.Info(GuardEventGlyph.Shield, GuardEventTone.Info, "Valet Mode"), tok("valet_mode_enabled"))
    }

    @Test
    fun unknownEventTypeFallsBackToRawLabelAndShield() {
        assertEquals(GuardEventTypeTokens.Info(GuardEventGlyph.Shield, GuardEventTone.Muted, "geofence_breach"), tok("geofence_breach"))
        assertEquals(GuardEventTypeTokens.Info(GuardEventGlyph.Shield, GuardEventTone.Muted, "\u2014"), tok(""))
    }

    // ---- feed projection ------------------------------------------------------------

    @Test
    fun rowProjectsTitleAckSubtitleAndAccessibleName() {
        val display = project(config(), listOf(event(eventType = "unauthorized_unlock", acknowledgedAt = "2026-06-06T12:01:00Z")))
        val row = display.items.single()
        assertEquals("Unauthorized Unlock", row.title)
        assertEquals("Acknowledged", row.subtitle)
        assertEquals(GuardEventGlyph.Lock, row.glyph)
        assertEquals(GuardEventTone.Critical, row.tone)
        assertEquals("5m ago", row.relativeTime)
        assertEquals("Unauthorized Unlock, Acknowledged, 5m ago", row.contentDescription)
    }

    @Test
    fun unacknowledgedEventProjectsUnacknowledgedSubtitle() {
        val row = project(config(), listOf(event(acknowledgedAt = null))).items.single()
        assertEquals("Unacknowledged", row.subtitle)
    }

    @Test
    fun feedSortsNewestFirst() {
        val older = event(id = 1, ts = "2026-06-06T10:00:00Z", eventType = "sentry_mode")
        val newer = event(id = 2, ts = "2026-06-06T12:04:00Z", eventType = "manual_panic")
        val display = project(config(), listOf(older, newer))
        assertEquals(2L, display.items.first().id)
        assertEquals("Panic Alert", display.items.first().title)
    }

    @Test
    fun feedCapsAtFiveRows() {
        val events = (1..6).map { event(id = it.toLong(), ts = "2026-06-06T%02d:00:00Z".format(it)) }
        val display = project(config(), events)
        assertEquals(GuardModeRegistration.MAX_FEED_ITEMS, display.items.size)
    }

    @Test
    fun emptyEventsYieldNoRows() {
        val display = project(config(), emptyList())
        assertFalse(display.hasItems)
        assertTrue(display.items.isEmpty())
    }

    @Test
    fun unparseableTimestampRendersEmDashRelative() {
        val row = project(config(), listOf(event(ts = "garbage"))).items.single()
        assertEquals("\u2014", row.relativeTime)
    }

    // ---- combineGuard adapter (web isLoading/isError/isStale OR + config-primary gate)

    @Test
    fun bothFirstLoadingProjectsLoadingSkeleton() {
        val combined = combineGuard(Resource.Loading(null, null, false), Resource.Loading(null, null, false))
        assertTrue(combined is Resource.Loading && combined.cached == null)
    }

    @Test
    fun configLoadedButEventsFirstLoadingStillSkeletons() {
        // Web parity: isLoading = configLoading || eventsLoading — events still first-loading keeps the skeleton.
        val combined = combineGuard(Resource.Success(config(), 100L, false), Resource.Loading(null, null, false))
        assertTrue(combined is Resource.Loading && combined.cached == null)
    }

    @Test
    fun bothLoadedProjectsContentSnapshotWithMaxFetchedAt() {
        val combined =
            combineGuard(
                Resource.Success(config(enabled = true), 100L, false),
                Resource.Success(listOf(event()), 250L, false),
            )
        assertTrue(combined is Resource.Success)
        val success = combined as Resource.Success
        assertEquals(true, success.data.config?.enabled)
        assertEquals(1, success.data.events.size)
        assertEquals(250L, success.fetchedAt)
    }

    @Test
    fun configHardErrorWithNoCacheProjectsHardError() {
        val combined =
            combineGuard(
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                Resource.Success(listOf(event()), 100L, false),
            )
        assertTrue(combined is Resource.Error && combined.cached == null)
    }

    @Test
    fun eventsErrorWithConfigPresentKeepsContentAsOffline() {
        // Web parity: an events-only failure never blanks the body (config gates it); it surfaces as stale/offline.
        val combined =
            combineGuard(
                Resource.Success(config(), 100L, false),
                Resource.Error(cached = null, fetchedAt = 90L, stale = true, error = ApiError.Timeout()),
            )
        assertTrue(combined is Resource.Error)
        val error = combined as Resource.Error
        assertEquals(true, error.cached?.config != null)
        assertTrue(error.stale)
    }

    @Test
    fun refreshInFlightOverCachedConfigProjectsRefreshingLoading() {
        val combined =
            combineGuard(
                Resource.Loading(cached = config(), fetchedAt = 100L, stale = false),
                Resource.Success(listOf(event()), 120L, false),
            )
        assertTrue(combined is Resource.Loading)
        val loading = combined as Resource.Loading
        assertEquals(true, loading.cached?.config != null)
        assertEquals(120L, loading.fetchedAt)
    }

    // ---- registry metadata (web registry/security.ts) -------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("guard-mode", GuardModeRegistration.ID)
        assertEquals("security", GuardModeRegistration.CATEGORY)
        assertEquals("GuardModeWidget", GuardModeRegistration.SLUG)
        assertEquals(5, GuardModeRegistration.MAX_FEED_ITEMS)
        assertEquals(GuardModeSize(cols = 2, rows = 4), GuardModeRegistration.defaultSize)
        assertEquals(GuardModeSize(cols = 1, rows = 2), GuardModeRegistration.minSize)
        assertEquals(GuardModeSize(cols = 4, rows = 40), GuardModeRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(GuardModeRegistration.isWithinBounds(GuardModeSize(cols = 2, rows = 4)))
        assertFalse(GuardModeRegistration.isWithinBounds(GuardModeSize(cols = 0, rows = 1)))
        assertFalse(GuardModeRegistration.isWithinBounds(GuardModeSize(cols = 5, rows = 50)))
        assertEquals(GuardModeSize(cols = 1, rows = 2), GuardModeRegistration.clamp(GuardModeSize(cols = 0, rows = 0)))
        assertEquals(GuardModeSize(cols = 4, rows = 40), GuardModeRegistration.clamp(GuardModeSize(cols = 9, rows = 99)))
    }

    @Test
    fun isCompactFollowsColumnCount() {
        assertTrue(project(config(), emptyList(), GuardModeSize(cols = 1, rows = 4)).isCompact)
        assertFalse(project(config(), emptyList(), GuardModeSize(cols = 2, rows = 4)).isCompact)
    }

    // ---- tolerant timestamp parse ---------------------------------------------------

    @Test
    fun parseEpochMillisIsTolerant() {
        assertNull(parseEpochMillis(null))
        assertNull(parseEpochMillis(""))
        assertNull(parseEpochMillis("not-a-date"))
        assertEquals(0L, parseEpochMillis("1970-01-01T00:00:00Z"))
        assertEquals(parseEpochMillis("2026-06-06T12:00:00Z"), parseEpochMillis("2026-06-06T14:00:00+02:00"))
    }

    private fun tok(eventType: String): GuardEventTypeTokens.Info = GuardEventTypeTokens.of(eventType)

    private fun renderRelative(age: FreshnessAge): String =
        when (age) {
            FreshnessAge.Unknown -> "\u2014"
            FreshnessAge.JustNow -> "just now"
            is FreshnessAge.Seconds -> "${age.value}s ago"
            is FreshnessAge.Minutes -> "${age.value}m ago"
            is FreshnessAge.Hours -> "${age.value}h ago"
            is FreshnessAge.Days -> "${age.value}d ago"
            is FreshnessAge.Weeks -> "${age.value}w ago"
        }
}
