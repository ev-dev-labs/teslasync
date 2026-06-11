package io.teslasync.android.featureviews.securitystatuscards

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit tests for the pure SecurityStatusCards data adapter — the field guards + helpers.ts ports
 * (`jsTruthy` / `asNonEmptyString` / `doorClosed` / `parseWindowState` / `allWindowsClosed` /
 * `windowsSummary`) and the six-card [SecurityStatusCardsProjection] — covering the web `latest`-undefined
 * defaults, a fully-secure snapshot, an insecure snapshot (raw open-door string + open windows + guest mode),
 * and the boolean/string/number/object field shapes the backend can emit. Run by the offline
 * `:android:testReleaseUnitTest` gate.
 */
class SecurityStatusCardsProjectionTest {
    private fun strings(): SecurityStatusCardsStrings =
        SecurityStatusCardsStrings(
            lockStatus = "Lock Status",
            lockDesc = "Vehicle lock state",
            locked = "Locked",
            unlocked = "Unlocked",
            sentryMode = "Sentry Mode",
            sentryDesc = "Camera surveillance system",
            active = "Active",
            inactive = "Inactive",
            doors = "Doors",
            doorsDesc = "All vehicle doors",
            closed = "Closed",
            open = "Open",
            windows = "Windows",
            windowsDesc = "Window positions",
            windowsAllClosed = "All Closed",
            homelink = "HomeLink",
            homelinkDesc = "Garage door opener",
            nearby = "Nearby",
            away = "Away",
            guestMode = "Guest Mode",
            guestDesc = "Temporary access mode",
            enabled = "Enabled",
            disabled = "Disabled",
            snapshotLabel = "Security & Access",
        )

    // ── jsTruthy ──────────────────────────────────────────────────────────────────
    @Test
    fun jsTruthyMatchesJavaScriptSemantics() {
        assertFalse(jsTruthy(null))
        assertFalse(jsTruthy(JsonNull))
        assertTrue(jsTruthy(JsonPrimitive(true)))
        assertFalse(jsTruthy(JsonPrimitive(false)))
        // A non-empty string is truthy in JS — including "Off"/"false"/"0" (the web card reads raw truthiness).
        assertTrue(jsTruthy(JsonPrimitive("Off")))
        assertTrue(jsTruthy(JsonPrimitive("false")))
        assertTrue(jsTruthy(JsonPrimitive("0")))
        assertFalse(jsTruthy(JsonPrimitive("")))
        assertTrue(jsTruthy(JsonPrimitive(1)))
        assertFalse(jsTruthy(JsonPrimitive(0)))
        assertTrue(jsTruthy(buildJsonObject { put("k", true) }))
    }

    // ── asNonEmptyString ────────────────────────────────────────────────────────────
    @Test
    fun asNonEmptyStringOnlyAcceptsNonEmptyStrings() {
        assertEquals("x", asNonEmptyString(JsonPrimitive("x")))
        assertNull(asNonEmptyString(JsonPrimitive("")))
        assertNull(asNonEmptyString(JsonPrimitive(true)))
        assertNull(asNonEmptyString(JsonPrimitive(3)))
        assertNull(asNonEmptyString(JsonNull))
        assertNull(asNonEmptyString(null))
    }

    // ── doorClosed ──────────────────────────────────────────────────────────────────
    @Test
    fun doorClosedHandlesEveryBackendShape() {
        assertTrue(doorClosed(null))
        assertTrue(doorClosed(JsonNull))
        assertTrue(doorClosed(JsonPrimitive(false)))
        assertFalse(doorClosed(JsonPrimitive(true)))
        assertTrue(doorClosed(JsonPrimitive(0)))
        assertFalse(doorClosed(JsonPrimitive(2)))
        assertTrue(doorClosed(JsonPrimitive("closed")))
        assertTrue(doorClosed(JsonPrimitive("ClosedAll")))
        assertTrue(doorClosed(JsonPrimitive("")))
        assertTrue(doorClosed(JsonPrimitive("0")))
        assertFalse(doorClosed(JsonPrimitive("df_open,pf_open")))
        val allFalseDoors =
            buildJsonObject {
                put("df", false)
                put("pf", false)
            }
        assertTrue(doorClosed(allFalseDoors))
        assertFalse(doorClosed(buildJsonObject { put("df", true) }))
        assertTrue(doorClosed(JsonPrimitive("""{"df":false,"pf":false}""")))
        assertFalse(doorClosed(JsonPrimitive("""{"df":true}""")))
        assertTrue(doorClosed(buildJsonArray { add(JsonPrimitive("df")) }))
    }

    // ── parseWindowState / allWindowsClosed / windowsSummary ──────────────────────────
    @Test
    fun parseWindowStateMatchesHelper() {
        assertEquals(WindowState.Closed, parseWindowState(JsonPrimitive("closed")))
        assertEquals(WindowState.Closed, parseWindowState(JsonPrimitive("0")))
        assertEquals(WindowState.Venting, parseWindowState(JsonPrimitive("Venting")))
        assertEquals(WindowState.Open, parseWindowState(JsonPrimitive("open")))
        assertEquals(WindowState.Open, parseWindowState(JsonPrimitive("ajar")))
        // A boolean window value is rejected by asNonEmptyString → Unknown (web parity quirk).
        assertEquals(WindowState.Unknown, parseWindowState(JsonPrimitive(true)))
        assertEquals(WindowState.Unknown, parseWindowState(JsonPrimitive("")))
        assertEquals(WindowState.Unknown, parseWindowState(null))
    }

    @Test
    fun windowsSummaryAndAllClosedMatchHelper() {
        assertTrue(allWindowsClosed(null))
        assertEquals(WindowsSummary.NoData, windowsSummary(null))

        val allClosed = windowsObject(fd = "closed", fp = "closed", rd = "closed", rp = "closed")
        assertTrue(allWindowsClosed(allClosed))
        assertEquals(WindowsSummary.AllClosed, windowsSummary(allClosed))

        val oneOpen = windowsObject(fd = "open", fp = "closed", rd = "closed", rp = "closed")
        assertFalse(allWindowsClosed(oneOpen))
        assertEquals(WindowsSummary.OpenOrVenting(1), windowsSummary(oneOpen))

        // A present snapshot with no window fields → all four parse Unknown → counted non-closed.
        val noWindows = buildJsonObject { put("locked", true) }
        assertFalse(allWindowsClosed(noWindows))
        assertEquals(WindowsSummary.OpenOrVenting(4), windowsSummary(noWindows))
    }

    // ── doorsValueOf ──────────────────────────────────────────────────────────────────
    @Test
    fun doorsValueReproducesWebTernary() {
        assertEquals(DoorsValue.Closed, doorsValueOf(doorsClosed = true, doorState = JsonPrimitive("closed")))
        assertEquals(DoorsValue.OpenRaw("df_open"), doorsValueOf(doorsClosed = false, doorState = JsonPrimitive("df_open")))
        assertEquals(DoorsValue.OpenFallback, doorsValueOf(doorsClosed = false, doorState = JsonPrimitive(true)))
        assertEquals(DoorsValue.OpenFallback, doorsValueOf(doorsClosed = false, doorState = null))
    }

    // ── projection: empty (web latest undefined defaults) ────────────────────────────
    @Test
    fun emptySnapshotRendersWebDefaultCards() {
        val cards = SecurityStatusCardsProjection.project(JsonNull, strings()).cards
        assertEquals(6, cards.size)
        assertEquals(
            listOf(CardKind.Lock, CardKind.Sentry, CardKind.Doors, CardKind.Windows, CardKind.HomeLink, CardKind.Guest),
            cards.map { it.kind },
        )
        assertCard(cards[0], CardTone.Danger, "Unlocked")
        assertCard(cards[1], CardTone.Muted, "Inactive")
        assertCard(cards[2], CardTone.Positive, "Closed")
        assertCard(cards[3], CardTone.Positive, EM_DASH)
        assertCard(cards[4], CardTone.Muted, "Away")
        assertCard(cards[5], CardTone.Muted, "Disabled")
    }

    @Test
    fun emptySnapshotIsClassifiedEmpty() {
        assertTrue(SecurityStatusCardsProjection.isEmptySnapshot(JsonNull))
        assertTrue(SecurityStatusCardsProjection.isEmptySnapshot(null))
        assertTrue(SecurityStatusCardsProjection.isEmptySnapshot(JsonPrimitive("x")))
        assertFalse(SecurityStatusCardsProjection.isEmptySnapshot(buildJsonObject { put("locked", true) }))
    }

    // ── projection: fully secure snapshot ────────────────────────────────────────────
    @Test
    fun secureSnapshotRendersPositiveCards() {
        val snapshot =
            buildJsonObject {
                put("locked", true)
                put("sentry_mode", "On")
                put("door_state", "Closed")
                put("fd_window", "closed")
                put("fp_window", "closed")
                put("rd_window", "closed")
                put("rp_window", "closed")
                put("homelink_nearby", true)
                put("guest_mode", false)
            }
        val cards = SecurityStatusCardsProjection.project(snapshot, strings()).cards
        assertCard(cards[0], CardTone.Positive, "Locked")
        assertCard(cards[1], CardTone.Info, "Active")
        assertCard(cards[2], CardTone.Positive, "Closed")
        assertCard(cards[3], CardTone.Positive, "All Closed")
        assertCard(cards[4], CardTone.Highlight, "Nearby")
        assertCard(cards[5], CardTone.Muted, "Disabled")
    }

    // ── projection: insecure snapshot (raw open door + open windows + guest) ─────────
    @Test
    fun insecureSnapshotRendersWarningAndRawDoorState() {
        val snapshot =
            buildJsonObject {
                put("locked", false)
                put("sentry_mode", false)
                put("door_state", "df_open,pf_open")
                put("fd_window", "open")
                put("fp_window", "vent")
                put("rd_window", "closed")
                put("rp_window", "closed")
                put("homelink_nearby", false)
                put("guest_mode", true)
            }
        val cards = SecurityStatusCardsProjection.project(snapshot, strings()).cards
        assertCard(cards[0], CardTone.Danger, "Unlocked")
        assertCard(cards[1], CardTone.Muted, "Inactive")
        // Doors open with a non-empty raw string → rendered verbatim (web `asNonEmptyString(doorState)`).
        assertCard(cards[2], CardTone.Warning, "df_open,pf_open")
        // Two corners non-closed (open + venting) → "2 Open" using the catalogued open label.
        assertCard(cards[3], CardTone.Warning, "2 Open")
        assertCard(cards[5], CardTone.Warning, "Enabled")
    }

    @Test
    fun doorsFallbackWhenOpenButNoString() {
        val snapshot = buildJsonObject { put("door_state", true) }
        val doors = SecurityStatusCardsProjection.project(snapshot, strings()).cards[2]
        assertCard(doors, CardTone.Warning, "Open")
    }

    @Test
    fun accessibilityLabelFoldsTitleValueDescription() {
        val cards = SecurityStatusCardsProjection.project(JsonNull, strings()).cards
        assertEquals("Lock Status, Unlocked, Vehicle lock state", cards[0].accessibilityLabel())
    }

    // ── helpers ───────────────────────────────────────────────────────────────────
    private fun assertCard(
        card: SecurityCard,
        tone: CardTone,
        value: String,
    ) {
        assertEquals(tone, card.tone)
        assertEquals(value, card.value)
    }

    private fun windowsObject(
        fd: String,
        fp: String,
        rd: String,
        rp: String,
    ): JsonObject =
        buildJsonObject {
            put("fd_window", fd)
            put("fp_window", fp)
            put("rd_window", rd)
            put("rp_window", rp)
        }
}
