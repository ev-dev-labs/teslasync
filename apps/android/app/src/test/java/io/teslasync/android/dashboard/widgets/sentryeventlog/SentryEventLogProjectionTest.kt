package io.teslasync.android.dashboard.widgets.sentryeventlog

import io.teslasync.android.components.datadisplay.FreshnessAge
import kotlinx.serialization.json.JsonElement
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
 * Off-device verification of the SentryEventLogWidget's pure logic — the per-footprint event limit, the
 * `deriveEvent` glyph/tone/title branches (incl. comma-split door parsing), the lock/sentry subtitle, the
 * `feedItems` projection (newest-first sort, cap, wide-only subtitle, a11y phrase, relative time), the
 * `SecurityEvent` decode (created_at ?? ts, id fallback), the registry metadata, and the tolerant
 * timestamp parse. Mirrors the web spec (web/src/features/dashboard/widgets/SentryEventLogWidget.tsx).
 */
class SentryEventLogProjectionTest {
    private val now = parseEpochMillis("2026-06-06T12:05:00Z")!!

    private fun strings(): SentryEventLogStrings = SentryEventLogStrings(formatRelative = ::renderRelative)

    private fun event(
        id: Long? = 1,
        ts: String = "2026-06-06T12:00:00Z",
        locked: Boolean? = null,
        sentryMode: Boolean? = null,
        doorState: String? = null,
    ): SecurityEvent =
        SecurityEvent(
            id = id,
            vehicleId = 1L,
            ts = ts,
            createdAt = null,
            eventType = "security_state",
            doorState = doorState,
            locked = locked,
            sentryMode = sentryMode,
        )

    private fun project(
        events: List<SecurityEvent>,
        size: SentryEventLogSize = SentryEventLogRegistration.defaultSize,
    ): SentryEventLogDisplay = SentryEventLogProjection.project(SentryEventLogSnapshot(events), size, strings(), now)

    // ---- per-footprint event limit (web `isWide ? 10 : isTall ? 7 : 4`) -------------

    @Test
    fun eventLimitFollowsFootprint() {
        assertEquals(10, SentryEventLogSize(cols = 3, rows = 4).eventLimit)
        assertEquals(10, SentryEventLogSize(cols = 4, rows = 40).eventLimit)
        assertEquals(7, SentryEventLogSize(cols = 2, rows = 4).eventLimit)
        assertEquals(7, SentryEventLogSize(cols = 2, rows = 2).eventLimit)
        assertEquals(4, SentryEventLogSize(cols = 2, rows = 1).eventLimit)
        assertEquals(4, SentryEventLogSize(cols = 1, rows = 1).eventLimit)
    }

    @Test
    fun isWideAndIsTallFollowDimensions() {
        assertTrue(SentryEventLogSize(cols = 3, rows = 1).isWide)
        assertFalse(SentryEventLogSize(cols = 2, rows = 9).isWide)
        assertTrue(SentryEventLogSize(cols = 2, rows = 2).isTall)
        assertFalse(SentryEventLogSize(cols = 2, rows = 1).isTall)
    }

    // ---- deriveEvent branches (web deriveEvent order + colors) -----------------------

    @Test
    fun openDoorDerivesWarningTriangleAndJoinedTitle() {
        val d = SecurityEventTokens.derive(event(doorState = "Front Left Open, Rear Right Open"))
        assertEquals(SecurityEventGlyph.DoorOpen, d.glyph)
        assertEquals(SecurityEventTone.Warning, d.tone)
        assertEquals("Door open: Front Left Open, Rear Right Open", d.title)
    }

    @Test
    fun openDoorTakesPrecedenceOverLockAndSentry() {
        // Web evaluates the open-door branch first, before sentry_mode / locked.
        val d = SecurityEventTokens.derive(event(doorState = "Trunk open", locked = true, sentryMode = true))
        assertEquals(SecurityEventGlyph.DoorOpen, d.glyph)
        assertEquals("Door open: Trunk open", d.title)
    }

    @Test
    fun sentryModeOnDerivesEyeInfo() {
        val d = SecurityEventTokens.derive(event(sentryMode = true))
        assertEquals(SecurityEventGlyph.Eye, d.glyph)
        assertEquals(SecurityEventTone.Info, d.tone)
        assertEquals("Sentry Mode activated", d.title)
    }

    @Test
    fun sentryModeOffDerivesEyeOffMuted() {
        val d = SecurityEventTokens.derive(event(sentryMode = false))
        assertEquals(SecurityEventGlyph.EyeOff, d.glyph)
        assertEquals(SecurityEventTone.Muted, d.tone)
        assertEquals("Sentry Mode deactivated", d.title)
    }

    @Test
    fun lockedDerivesLockSuccess() {
        val d = SecurityEventTokens.derive(event(locked = true))
        assertEquals(SecurityEventGlyph.Lock, d.glyph)
        assertEquals(SecurityEventTone.Success, d.tone)
        assertEquals("Vehicle locked", d.title)
    }

    @Test
    fun unlockedDerivesUnlockCritical() {
        val d = SecurityEventTokens.derive(event(locked = false))
        assertEquals(SecurityEventGlyph.Unlock, d.glyph)
        assertEquals(SecurityEventTone.Critical, d.tone)
        assertEquals("Vehicle unlocked", d.title)
    }

    @Test
    fun sentryModeOffTakesPrecedenceOverLockedFalse() {
        // Web order: the `sentry_mode === false` branch is checked before `locked === false`.
        val d = SecurityEventTokens.derive(event(sentryMode = false, locked = false))
        assertEquals(SecurityEventGlyph.EyeOff, d.glyph)
        assertEquals("Sentry Mode deactivated", d.title)
    }

    @Test
    fun noSignalsDerivesNeutralUpdated() {
        val d = SecurityEventTokens.derive(event())
        assertEquals(SecurityEventGlyph.DoorClosed, d.glyph)
        assertEquals(SecurityEventTone.Accent, d.tone)
        assertEquals("Security state updated", d.title)
    }

    @Test
    fun openDoorsFiltersToOpenTokensOnly() {
        assertEquals(listOf("Front Left open", "Rear open"), SecurityEventTokens.openDoors("Front Left open, closed, Rear open"))
        assertTrue(SecurityEventTokens.openDoors("all closed").isEmpty())
        assertTrue(SecurityEventTokens.openDoors(null).isEmpty())
        assertTrue(SecurityEventTokens.openDoors("").isEmpty())
    }

    // ---- subtitle (web "🔒 Locked · 🛡️ Sentry On" / "—") ----------------------------

    @Test
    fun subtitleJoinsLockAndSentryParts() {
        val lockedAndSentry = SecurityEventTokens.subtitle(event(locked = true, sentryMode = true))
        assertEquals("\uD83D\uDD12 Locked \u00b7 \uD83D\uDEE1\uFE0F Sentry On", lockedAndSentry)
        val unlockedAndOff = SecurityEventTokens.subtitle(event(locked = false, sentryMode = false))
        assertEquals("\uD83D\uDD13 Unlocked \u00b7 Sentry Off", unlockedAndOff)
    }

    @Test
    fun subtitleOmitsNullBooleans() {
        assertEquals("\uD83D\uDD12 Locked", SecurityEventTokens.subtitle(event(locked = true, sentryMode = null)))
        assertEquals("\uD83D\uDEE1\uFE0F Sentry On", SecurityEventTokens.subtitle(event(locked = null, sentryMode = true)))
    }

    @Test
    fun subtitleFallsBackToEmDashWhenNeitherReported() {
        assertEquals("\u2014", SecurityEventTokens.subtitle(event(locked = null, sentryMode = null)))
    }

    @Test
    fun subtitleAttachedOnlyOnWideFootprint() {
        val wide = project(listOf(event(locked = true)), SentryEventLogSize(cols = 3, rows = 4)).items.single()
        assertEquals("\uD83D\uDD12 Locked", wide.subtitle)

        val narrow = project(listOf(event(locked = true)), SentryEventLogSize(cols = 2, rows = 4)).items.single()
        assertNull(narrow.subtitle)
    }

    // ---- feed projection (sort, cap, relative time, a11y) ---------------------------

    @Test
    fun feedSortsNewestFirstByTimestamp() {
        val older = event(id = 1, ts = "2026-06-06T10:00:00Z", sentryMode = true)
        val newer = event(id = 2, ts = "2026-06-06T12:04:00Z", locked = false)
        val items = project(listOf(older, newer)).items
        assertEquals("2", items.first().id)
        assertEquals("Vehicle unlocked", items.first().title)
    }

    @Test
    fun feedCapsAtFootprintLimit() {
        val events = (1..12).map { event(id = it.toLong(), ts = "2026-06-06T%02d:00:00Z".format(it)) }
        assertEquals(10, project(events, SentryEventLogSize(cols = 4, rows = 6)).items.size)
        assertEquals(7, project(events, SentryEventLogSize(cols = 2, rows = 4)).items.size)
    }

    @Test
    fun rowProjectsRelativeTimeAndAccessiblePhrase() {
        val row = project(listOf(event(locked = false)), SentryEventLogSize(cols = 3, rows = 4)).items.single()
        assertEquals("5m ago", row.relativeTime)
        // Wide footprint folds title + subtitle + relative time into the TalkBack phrase.
        assertEquals("Vehicle unlocked, \uD83D\uDD13 Unlocked, 5m ago", row.contentDescription)
    }

    @Test
    fun narrowRowAccessiblePhraseOmitsSubtitle() {
        val row = project(listOf(event(locked = true)), SentryEventLogSize(cols = 2, rows = 4)).items.single()
        assertEquals("Vehicle locked, 5m ago", row.contentDescription)
    }

    @Test
    fun unparseableTimestampRendersEmDashRelative() {
        val row = project(listOf(event(ts = "garbage"))).items.single()
        assertEquals("\u2014", row.relativeTime)
    }

    @Test
    fun emptyEventsYieldNoRows() {
        val display = project(emptyList())
        assertFalse(display.hasItems)
        assertTrue(display.items.isEmpty())
    }

    @Test
    fun rowIdPrefersExplicitIdThenFallsBackToVehicleAndTs() {
        assertEquals("42", project(listOf(event(id = 42))).items.single().id)
        assertEquals("1-2026-06-06T12:00:00Z", project(listOf(event(id = null))).items.single().id)
    }

    // ---- SecurityEvent decode -------------------------------------------------------

    @Test
    fun timestampPrefersCreatedAtThenTs() {
        val withCreatedAt =
            SecurityEvent(
                id = 1,
                vehicleId = 1L,
                ts = "2026-06-06T08:00:00Z",
                createdAt = "2026-06-06T09:00:00Z",
                eventType = "security_state",
                doorState = null,
                locked = null,
                sentryMode = null,
            )
        assertEquals("2026-06-06T09:00:00Z", withCreatedAt.timestamp)
        assertEquals("2026-06-06T08:00:00Z", withCreatedAt.copy(createdAt = null).timestamp)
    }

    @Test
    fun parseListDecodesArrayAndToleratesNonObjects() {
        val json: JsonElement =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", 7)
                        put("vehicle_id", 3)
                        put("ts", "2026-06-06T12:00:00Z")
                        put("locked", true)
                        put("sentry_mode", false)
                        put("door_state", "closed")
                    },
                )
                add(buildJsonObject { put("vehicle_id", 3) })
            }
        val events = SecurityEvent.parseList(json)
        assertEquals(2, events.size)
        assertEquals(7L, events.first().id)
        assertEquals(true, events.first().locked)
        assertEquals(false, events.first().sentryMode)
        // Second row carries no id → rowId falls back to "vehicleId-ts" (ts blank here).
        assertNull(events[1].id)
    }

    @Test
    fun snapshotFromJsonNullOrNonArrayIsEmpty() {
        assertFalse(SentryEventLogSnapshot.fromJson(null).hasRows)
        assertFalse(SentryEventLogSnapshot.fromJson(buildJsonObject { put("x", 1) }).hasRows)
    }

    // ---- registry metadata (web registry/security.ts) -------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("sentry-event-log", SentryEventLogRegistration.ID)
        assertEquals("security", SentryEventLogRegistration.CATEGORY)
        assertEquals("Sentry Event Log", SentryEventLogRegistration.NAME)
        assertEquals("Recent sentry events with timestamps", SentryEventLogRegistration.DESCRIPTION)
        assertEquals("SentryEventLogWidget", SentryEventLogRegistration.SLUG)
        assertEquals(SentryEventLogSize(cols = 2, rows = 4), SentryEventLogRegistration.defaultSize)
        assertEquals(SentryEventLogSize(cols = 2, rows = 4), SentryEventLogRegistration.minSize)
        assertEquals(SentryEventLogSize(cols = 4, rows = 40), SentryEventLogRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(SentryEventLogRegistration.isWithinBounds(SentryEventLogSize(cols = 2, rows = 4)))
        assertFalse(SentryEventLogRegistration.isWithinBounds(SentryEventLogSize(cols = 1, rows = 4)))
        assertFalse(SentryEventLogRegistration.isWithinBounds(SentryEventLogSize(cols = 5, rows = 50)))
        assertEquals(SentryEventLogSize(cols = 2, rows = 4), SentryEventLogRegistration.clamp(SentryEventLogSize(cols = 0, rows = 0)))
        assertEquals(SentryEventLogSize(cols = 4, rows = 40), SentryEventLogRegistration.clamp(SentryEventLogSize(cols = 9, rows = 99)))
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
