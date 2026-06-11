package io.teslasync.android.dashboard.widgets.safetyhistory

import io.teslasync.android.components.datadisplay.FreshnessAge
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SafetyHistoryWidget's pure logic — the raw-value narrowing
 * ([safetyValueOf]), the `cleanSafetyEnum` / `isSafetyEnumActive` helpers, the `classifySnapshot` priority
 * ladder + titles, the `buildSubtitle` fragments, the JSON parse, the 30-day stats (count / most-common /
 * 30-vs-60-day trend), the feed projection (newest-first sort, ten-row cap, a11y label), the compact text,
 * the registry metadata, the tolerant timestamp parse, the relative-time tiers, and vehicle resolution.
 * Mirrors the web spec (web/src/features/dashboard/widgets/SafetyHistoryWidget.tsx, web/src/lib/safetyEnum.ts).
 */
class SafetyHistoryProjectionTest {
    private val now = parseEpochMillis("2026-06-06T12:00:00Z")!!

    // Long vendor-prefixed enum fixtures, aliased to keep call sites within the line-length budget.
    private val fcwLate = SafetyValue.StringValue("ForwardCollisionSensitivityLate")
    private val laneWarn = SafetyValue.StringValue("LaneAssistLevelWarning")

    private fun strings(): SafetyHistoryStrings =
        SafetyHistoryStrings(
            title = "Safety History",
            eventsWord = "events",
            noEventsMessage = "No safety events",
            totalLabel = "Events (30d)",
            mostCommonLabel = "Most Common",
            trendLabel = "Trend",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            formatEventTime = ::renderEventTime,
            formatRelative = ::renderRelative,
        )

    @Suppress("LongParameterList")
    private fun entry(
        id: Long = 1L,
        createdAt: String? = "2026-06-06T11:00:00Z",
        aebOff: Boolean? = null,
        fcw: SafetyValue = SafetyValue.Absent,
        lane: SafetyValue = SafetyValue.Absent,
        blindSpot: Boolean? = null,
        emergencyLane: Boolean? = null,
        speedLimit: SafetyValue = SafetyValue.Absent,
        follow: SafetyValue = SafetyValue.Absent,
        pin: SafetyValue = SafetyValue.Absent,
    ): SafetyEntry =
        SafetyEntry(
            id = id,
            createdAt = createdAt,
            automaticEmergencyBrakingOff = aebOff,
            forwardCollisionWarning = fcw,
            laneDepartureAvoidance = lane,
            blindSpotCollisionWarning = blindSpot,
            emergencyLaneDepartureAvoidance = emergencyLane,
            speedLimitWarning = speedLimit,
            cruiseFollowDistance = follow,
            pinToDriveEnabled = pin,
        )

    private fun project(
        entries: List<SafetyEntry>,
        size: SafetyHistorySize = SafetyHistoryRegistration.defaultSize,
    ): SafetyHistoryDisplay = SafetyHistoryProjection.project(entries, size, strings(), now)

    // ---- safetyValueOf: runtime-shape narrowing (web typeGuards) --------------------

    @Test
    fun safetyValueNarrowsEachJsonShape() {
        // A JSON string wins first so "true" stays a string, never a coerced boolean (the web bug guard).
        assertEquals(SafetyValue.StringValue("true"), safetyValueOf(JsonPrimitive("true")))
        assertEquals(SafetyValue.BoolValue(true), safetyValueOf(JsonPrimitive(true)))
        assertEquals(SafetyValue.NumberValue(3.0), safetyValueOf(JsonPrimitive(3.0)))
        assertEquals(SafetyValue.Absent, safetyValueOf(JsonNull))
        assertEquals(SafetyValue.Absent, safetyValueOf(null))
        assertEquals(SafetyValue.Absent, safetyValueOf(buildJsonObject { put("x", 1) }))
    }

    // ---- cleanSafetyEnum (web cleanSafetyEnum) --------------------------------------

    @Test
    fun cleanSafetyEnumRendersBooleansAndNumbers() {
        assertEquals("On", SafetyHistoryProjection.cleanSafetyEnum(SafetyValue.BoolValue(true), SafetyEnumField.ForwardCollisionWarning))
        assertEquals("Off", SafetyHistoryProjection.cleanSafetyEnum(SafetyValue.BoolValue(false), SafetyEnumField.ForwardCollisionWarning))
        assertEquals("3", SafetyHistoryProjection.cleanSafetyEnum(SafetyValue.NumberValue(3.0), SafetyEnumField.CruiseFollowDistance))
        assertEquals("3.5", SafetyHistoryProjection.cleanSafetyEnum(SafetyValue.NumberValue(3.5), SafetyEnumField.CruiseFollowDistance))
    }

    @Test
    fun cleanSafetyEnumStripsVendorPrefixes() {
        assertEquals(
            "Late",
            SafetyHistoryProjection.cleanSafetyEnum(fcwLate, SafetyEnumField.ForwardCollisionWarning),
        )
        assertEquals(
            "Warning",
            SafetyHistoryProjection.cleanSafetyEnum(laneWarn, SafetyEnumField.LaneDepartureAvoidance),
        )
        // The speed-assist `None` suffix special-cases to "Off".
        assertEquals(
            "Off",
            SafetyHistoryProjection.cleanSafetyEnum(SafetyValue.StringValue("SpeedAssistLevelNone"), SafetyEnumField.SpeedLimitWarning),
        )
        // A bare prefix with nothing after it falls back to the raw string.
        assertEquals(
            "FollowDistance",
            SafetyHistoryProjection.cleanSafetyEnum(SafetyValue.StringValue("FollowDistance"), SafetyEnumField.CruiseFollowDistance),
        )
    }

    @Test
    fun cleanSafetyEnumFallsBackForEmptyAndAbsent() {
        assertEquals(
            "\u2014",
            SafetyHistoryProjection.cleanSafetyEnum(SafetyValue.StringValue(""), SafetyEnumField.ForwardCollisionWarning),
        )
        assertEquals("\u2014", SafetyHistoryProjection.cleanSafetyEnum(SafetyValue.Absent, SafetyEnumField.ForwardCollisionWarning))
    }

    // ---- isSafetyEnumActive (web isSafetyEnumActive) --------------------------------

    @Test
    fun isSafetyEnumActiveClassifiesEachShape() {
        assertFalse(SafetyHistoryProjection.isSafetyEnumActive(SafetyValue.Absent, SafetyEnumField.ForwardCollisionWarning))
        assertTrue(SafetyHistoryProjection.isSafetyEnumActive(SafetyValue.BoolValue(true), SafetyEnumField.ForwardCollisionWarning))
        assertFalse(SafetyHistoryProjection.isSafetyEnumActive(SafetyValue.BoolValue(false), SafetyEnumField.ForwardCollisionWarning))
        assertTrue(SafetyHistoryProjection.isSafetyEnumActive(fcwLate, SafetyEnumField.ForwardCollisionWarning))
        assertFalse(SafetyHistoryProjection.isSafetyEnumActive(SafetyValue.StringValue("Off"), SafetyEnumField.ForwardCollisionWarning))
        assertFalse(SafetyHistoryProjection.isSafetyEnumActive(SafetyValue.StringValue("disabled"), SafetyEnumField.LaneDepartureAvoidance))
        assertFalse(SafetyHistoryProjection.isSafetyEnumActive(SafetyValue.NumberValue(0.0), SafetyEnumField.CruiseFollowDistance))
        assertTrue(SafetyHistoryProjection.isSafetyEnumActive(SafetyValue.NumberValue(3.0), SafetyEnumField.CruiseFollowDistance))
    }

    // ---- classifySnapshot priority ladder + titles ----------------------------------

    @Test
    fun classifyFollowsWebPriorityLadder() {
        assertEquals(SafetyEventType.Aeb, SafetyHistoryProjection.classify(entry(aebOff = true)))
        assertEquals(SafetyEventType.Fcw, SafetyHistoryProjection.classify(entry(fcw = fcwLate)))
        assertEquals(SafetyEventType.Lane, SafetyHistoryProjection.classify(entry(lane = laneWarn)))
        assertEquals(SafetyEventType.Bsw, SafetyHistoryProjection.classify(entry(blindSpot = true)))
        assertEquals(SafetyEventType.Elda, SafetyHistoryProjection.classify(entry(emergencyLane = true)))
        assertEquals(SafetyEventType.General, SafetyHistoryProjection.classify(entry()))
        // AEB outranks an active FCW (web checks AEB first).
        assertEquals(
            SafetyEventType.Aeb,
            SafetyHistoryProjection.classify(entry(aebOff = true, fcw = SafetyValue.StringValue("ForwardCollisionSensitivityLate"))),
        )
    }

    @Test
    fun titlesMatchWebClassifier() {
        assertEquals("AEB Activation", SafetyHistoryProjection.titleFor(entry(aebOff = true)))
        assertEquals("FCW: Late", SafetyHistoryProjection.titleFor(entry(fcw = SafetyValue.StringValue("ForwardCollisionSensitivityLate"))))
        assertEquals(
            "Lane Departure: Warning",
            SafetyHistoryProjection.titleFor(entry(lane = SafetyValue.StringValue("LaneAssistLevelWarning"))),
        )
        assertEquals("Blind Spot Warning", SafetyHistoryProjection.titleFor(entry(blindSpot = true)))
        assertEquals("Emergency Lane Departure Avoidance", SafetyHistoryProjection.titleFor(entry(emergencyLane = true)))
        assertEquals("Safety State Update", SafetyHistoryProjection.titleFor(entry()))
    }

    // ---- buildSubtitle (web buildSubtitle) ------------------------------------------

    @Test
    fun buildSubtitleJoinsRawFragments() {
        val subtitle =
            SafetyHistoryProjection.buildSubtitle(
                entry(
                    speedLimit = SafetyValue.StringValue("Chime"),
                    follow = SafetyValue.NumberValue(3.0),
                    pin = SafetyValue.BoolValue(true),
                ),
            )
        assertEquals("Speed Limit: Chime \u00b7 Follow: 3 \u00b7 PIN to Drive", subtitle)
    }

    @Test
    fun buildSubtitleDropsFalsyPinAndEmptyIsEmDash() {
        // A present-but-falsy PIN flag contributes nothing (web pushes '' then filters it out).
        val onlyFollow = entry(follow = SafetyValue.NumberValue(5.0), pin = SafetyValue.BoolValue(false))
        assertEquals("Follow: 5", SafetyHistoryProjection.buildSubtitle(onlyFollow))
        // No fragments at all -> the em dash.
        assertEquals("\u2014", SafetyHistoryProjection.buildSubtitle(entry()))
    }

    // ---- JSON parse (web select: safeArray) -----------------------------------------

    @Test
    fun parseListDecodesSnakeCaseRowsAndClassifies() {
        val json =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", 7L)
                        put("created_at", "2026-06-06T11:00:00Z")
                        put("forward_collision_warning", "ForwardCollisionSensitivityLate")
                    },
                )
                add(JsonPrimitive("not-an-object"))
            }
        val parsed = SafetyEntry.parseList(json)
        assertEquals(1, parsed.size)
        val row = parsed.single()
        assertEquals(7L, row.id)
        assertEquals(SafetyEventType.Fcw, SafetyHistoryProjection.classify(row))
    }

    @Test
    fun parseListStrictBooleanAndTolerance() {
        val json =
            buildJsonArray {
                add(buildJsonObject { put("automatic_emergency_braking_off", true) })
                // A string "true" must NOT satisfy the strict `=== true` AEB test.
                add(buildJsonObject { put("automatic_emergency_braking_off", "true") })
            }
        val parsed = SafetyEntry.parseList(json)
        assertEquals(SafetyEventType.Aeb, SafetyHistoryProjection.classify(parsed[0]))
        assertEquals(SafetyEventType.General, SafetyHistoryProjection.classify(parsed[1]))
        assertTrue(SafetyEntry.parseList(JsonPrimitive("nope")).isEmpty())
        assertTrue(SafetyEntry.parseList(null).isEmpty())
    }

    // ---- 30-day stats (web stats memo) ----------------------------------------------

    @Test
    fun statsCountMostCommonAndUpTrend() {
        val recent =
            listOf(
                entry(id = 1, createdAt = "2026-06-01T12:00:00Z", aebOff = true),
                entry(id = 2, createdAt = "2026-05-20T12:00:00Z", aebOff = true),
                entry(id = 3, createdAt = "2026-05-18T12:00:00Z", fcw = SafetyValue.StringValue("ForwardCollisionSensitivityLate")),
            )
        val prior = listOf(entry(id = 4, createdAt = "2026-04-20T12:00:00Z"))
        val stats = SafetyHistoryProjection.computeStats(recent + prior, now)
        assertEquals(3, stats.totalEvents)
        assertEquals("AEB", stats.mostCommon)
        assertEquals(SafetyTrend.Up, stats.trend)
    }

    @Test
    fun statsTrendDownFlatAndUnknown() {
        val priorTwo =
            listOf(
                entry(id = 10, createdAt = "2026-04-20T12:00:00Z"),
                entry(id = 11, createdAt = "2026-04-22T12:00:00Z"),
            )
        val recentOne = listOf(entry(id = 12, createdAt = "2026-06-01T12:00:00Z"))
        assertEquals(SafetyTrend.Down, SafetyHistoryProjection.computeStats(recentOne + priorTwo, now).trend)

        val recentOneFlat = listOf(entry(id = 13, createdAt = "2026-06-02T12:00:00Z"))
        val priorOne = listOf(entry(id = 14, createdAt = "2026-04-21T12:00:00Z"))
        assertEquals(SafetyTrend.Flat, SafetyHistoryProjection.computeStats(recentOneFlat + priorOne, now).trend)

        // No prior-window baseline -> Unknown, even with recent events.
        assertEquals(SafetyTrend.Unknown, SafetyHistoryProjection.computeStats(recentOneFlat, now).trend)
    }

    @Test
    fun statsEmptyWhenNoEntries() {
        val stats = SafetyHistoryProjection.computeStats(emptyList(), now)
        assertEquals(0, stats.totalEvents)
        assertEquals("\u2014", stats.mostCommon)
        assertEquals(SafetyTrend.Unknown, stats.trend)
    }

    // ---- feed projection ------------------------------------------------------------

    @Test
    fun rowProjectsTitleSubtitleToneSeverityAndAccessibleName() {
        val display =
            project(
                listOf(
                    entry(
                        aebOff = true,
                        speedLimit = SafetyValue.StringValue("Chime"),
                        createdAt = "2026-06-06T11:00:00Z",
                    ),
                ),
            )
        val row = display.items.single()
        assertEquals("AEB Activation", row.title)
        assertEquals("Speed Limit: Chime", row.subtitle)
        assertEquals(SafetyEventTone.Critical, row.tone)
        assertEquals(SafetyEventSeverity.Critical, row.severity)
        assertEquals(SafetyEventGlyph.AlertOctagon, row.glyph)
        assertEquals("1h ago", row.relativeTime)
        assertEquals("AEB Activation, Speed Limit: Chime, 1h ago", row.contentDescription)
    }

    @Test
    fun feedSortsNewestFirstAndCapsAtTen() {
        val older = entry(id = 1, createdAt = "2026-06-06T08:00:00Z")
        val newer = entry(id = 2, createdAt = "2026-06-06T11:30:00Z")
        val display = project(listOf(older, newer))
        assertEquals(2L, display.items.first().id)

        val many = (1..12).map { entry(id = it.toLong(), createdAt = "2026-06-06T%02d:00:00Z".format(it)) }
        assertEquals(SafetyHistorySize.MAX_FEED_ITEMS, project(many).items.size)
    }

    @Test
    fun subtitleEmDashIsOmittedFromAccessibleName() {
        val display = project(listOf(entry(emergencyLane = true)))
        val row = display.items.single()
        assertEquals("\u2014", row.subtitle)
        // The em-dash subtitle is dropped from the TalkBack phrase, leaving title + time.
        assertEquals("Emergency Lane Departure Avoidance, 1h ago", row.contentDescription)
    }

    // ---- compact text (web CompactView) ---------------------------------------------

    @Test
    fun compactTextShowsCountAndMostCommonTrend() {
        val recent =
            listOf(
                entry(id = 1, createdAt = "2026-06-01T12:00:00Z", aebOff = true),
                entry(id = 2, createdAt = "2026-05-20T12:00:00Z", aebOff = true),
            )
        val prior = listOf(entry(id = 3, createdAt = "2026-04-20T12:00:00Z"))
        val display = project(recent + prior, size = SafetyHistorySize(cols = 1, rows = 4))
        assertTrue(display.isCompact)
        assertTrue(display.hasEvents)
        assertEquals("2 events (30d)", display.compactPrimaryText)
        assertEquals("AEB \u2191", display.compactSecondaryText)
    }

    @Test
    fun compactTextShowsNoEventsWhenWindowEmptyButListNonEmpty() {
        // Events exist but all fall outside the 30-day window -> count 0 -> "No safety events", no subline.
        val display = project(listOf(entry(createdAt = "2026-01-01T12:00:00Z")), size = SafetyHistorySize(cols = 1, rows = 4))
        assertTrue(display.hasEvents)
        assertEquals("No safety events", display.compactPrimaryText)
        assertNull(display.compactSecondaryText)
    }

    @Test
    fun emptyEntriesYieldNoEventsAndNoItems() {
        val display = project(emptyList())
        assertFalse(display.hasEvents)
        assertTrue(display.items.isEmpty())
        assertEquals(0, display.stats.totalEvents)
    }

    @Test
    fun isCompactFollowsColumnCount() {
        assertTrue(project(listOf(entry()), SafetyHistorySize(cols = 1, rows = 4)).isCompact)
        assertFalse(project(listOf(entry()), SafetyHistorySize(cols = 2, rows = 4)).isCompact)
    }

    // ---- registry metadata (web registry/security.ts) -------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("safety-history", SafetyHistoryRegistration.ID)
        assertEquals("security", SafetyHistoryRegistration.CATEGORY)
        assertEquals("SafetyHistoryWidget", SafetyHistoryRegistration.SLUG)
        assertEquals(SafetyHistorySize(cols = 2, rows = 4), SafetyHistoryRegistration.defaultSize)
        assertEquals(SafetyHistorySize(cols = 2, rows = 4), SafetyHistoryRegistration.minSize)
        assertEquals(SafetyHistorySize(cols = 4, rows = 40), SafetyHistoryRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(SafetyHistoryRegistration.isWithinBounds(SafetyHistorySize(cols = 2, rows = 4)))
        assertFalse(SafetyHistoryRegistration.isWithinBounds(SafetyHistorySize(cols = 1, rows = 4)))
        assertFalse(SafetyHistoryRegistration.isWithinBounds(SafetyHistorySize(cols = 5, rows = 50)))
        assertEquals(SafetyHistorySize(cols = 2, rows = 4), SafetyHistoryRegistration.clamp(SafetyHistorySize(cols = 0, rows = 0)))
        assertEquals(SafetyHistorySize(cols = 4, rows = 40), SafetyHistoryRegistration.clamp(SafetyHistorySize(cols = 9, rows = 99)))
    }

    // ---- relative-time tiers + tolerant parse + vehicle resolution -------------------

    @Test
    fun eventTimeTiersMatchWebCutoffs() {
        assertEquals(SafetyEventTime.JustNow, SafetyHistoryProjection.computeEventTime("2026-06-06T11:59:30Z", now))
        assertEquals(SafetyEventTime.MinutesAgo(5), SafetyHistoryProjection.computeEventTime("2026-06-06T11:55:00Z", now))
        assertEquals(SafetyEventTime.HoursAgo(2), SafetyHistoryProjection.computeEventTime("2026-06-06T10:00:00Z", now))
        val twoDaysAgo = "2026-06-04T12:00:00Z"
        assertEquals(SafetyEventTime.Absolute(parseEpochMillis(twoDaysAgo)!!), SafetyHistoryProjection.computeEventTime(twoDaysAgo, now))
        // Web `created_at ?? new Date(0)`: null -> epoch (Absolute); present-but-unparseable -> Unknown.
        assertEquals(SafetyEventTime.Absolute(0L), SafetyHistoryProjection.computeEventTime(null, now))
        assertEquals(SafetyEventTime.Unknown, SafetyHistoryProjection.computeEventTime("garbage", now))
    }

    @Test
    fun parseEpochMillisIsTolerant() {
        assertNull(parseEpochMillis(null))
        assertNull(parseEpochMillis(""))
        assertNull(parseEpochMillis("not-a-date"))
        assertEquals(0L, parseEpochMillis("1970-01-01T00:00:00Z"))
        assertEquals(parseEpochMillis("2026-06-06T12:00:00Z"), parseEpochMillis("2026-06-06T14:00:00+02:00"))
    }

    @Test
    fun resolveVehicleIdPrefersExplicitThenFirstVehicle() {
        assertEquals(42L, resolveVehicleId(42L, vehicles = null))
        assertNull(resolveVehicleId(null, vehicles = null))
        assertNull(resolveVehicleId(0L, vehicles = emptyList()))
        assertNull(firstVehicleId(null))
        assertNull(firstVehicleId(emptyList()))
    }

    private fun renderEventTime(time: SafetyEventTime): String =
        when (time) {
            SafetyEventTime.Unknown -> "\u2014"
            SafetyEventTime.JustNow -> "just now"
            is SafetyEventTime.MinutesAgo -> "${time.value}m ago"
            is SafetyEventTime.HoursAgo -> "${time.value}h ago"
            is SafetyEventTime.Absolute -> "abs:${time.epochMillis}"
        }

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
