package io.teslasync.android.dashboard.widgets.subscriptions

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
 * Off-device verification of the SubscriptionsWidget's pure logic — the raw-JSON decode of the
 * `…/subscriptions` envelope, the `asString`/`Boolean(val)` coercions, the `daysUntil` expiry math, the
 * known-type + generic-array parse (incl. case-insensitive de-dup), and the compact/standard projection
 * (formatted detail rows + Active/Expired badge, active count, soonest expiry, empty branch) plus the registry
 * metadata. Mirrors the web spec (web/src/features/dashboard/widgets/SubscriptionsWidget.tsx).
 */
class SubscriptionsProjectionTest {
    private val strings =
        SubscriptionsStrings(
            title = "Subscriptions",
            active = "Active",
            expired = "Expired",
            activeCount = "active",
            noData = "No subscriptions",
            unknown = "Unknown",
            typeLabels = SUBSCRIPTION_TYPES.associate { it.dataKey to it.fallback },
        )

    private fun parse(json: kotlinx.serialization.json.JsonObject?) = parseSubscriptions(json, strings, NOW)

    // ── primitive coercions ───────────────────────────────────────────────────────

    @Test
    fun parseDateMillisHandlesIsoVariants() {
        assertEquals(JUN_1_MIDNIGHT_UTC, parseDateMillis("2025-06-01"))
        assertEquals(JUN_1_MIDNIGHT_UTC, parseDateMillis("2025-06-01T00:00:00Z"))
        assertEquals(JUN_1_MIDNIGHT_UTC, parseDateMillis("2025-06-01T00:00:00"))
        assertEquals(JUN_1_MIDNIGHT_UTC, parseDateMillis("2025-06-01T00:00:00+00:00"))
        assertNull(parseDateMillis(null))
        assertNull(parseDateMillis(""))
        assertNull(parseDateMillis("   "))
        assertNull(parseDateMillis("not-a-date"))
    }

    @Test
    fun daysUntilCeilsToWholeDays() {
        assertEquals(151, daysUntil("2025-06-01", NOW))
        // 151 days + 12h ⇒ ceil to 152 (web Math.ceil).
        assertEquals(152, daysUntil("2025-06-01T12:00:00Z", NOW))
        assertTrue((daysUntil("2024-06-01", NOW) ?: 0) < 0)
        assertNull(daysUntil(null, NOW))
        assertNull(daysUntil("garbage", NOW))
    }

    @Test
    fun asStringCoercesLikeWeb() {
        assertEquals("hello", asString(JsonPrimitive("hello")))
        assertEquals("5", asString(JsonPrimitive(5)))
        assertNull(asString(JsonPrimitive("")))
        assertNull(asString(JsonPrimitive(true)))
        assertNull(asString(JsonNull))
        assertNull(asString(null))
    }

    @Test
    fun jsTruthyMatchesJsBoolean() {
        assertTrue(jsTruthy(JsonPrimitive(true)))
        assertFalse(jsTruthy(JsonPrimitive(false)))
        assertFalse(jsTruthy(JsonPrimitive(0)))
        assertTrue(jsTruthy(JsonPrimitive(1)))
        assertTrue(jsTruthy(JsonPrimitive("x")))
        assertFalse(jsTruthy(JsonPrimitive("")))
        assertFalse(jsTruthy(JsonNull))
        assertFalse(jsTruthy(null))
    }

    // ── known-type parsing ────────────────────────────────────────────────────────

    @Test
    fun parseKnownTypesSkipsAbsentFalseOrEmptyFlags() {
        val data =
            buildJsonObject {
                put("premium_connectivity", true)
                put("full_self_driving", false)
                put("enhanced_autopilot", "")
                put("data_sharing", JsonNull)
                // standard_connectivity + satellite_connectivity absent
            }
        val subs = parse(data)
        assertEquals(1, subs.size)
        assertEquals("Premium Connectivity", subs.single().name)
    }

    @Test
    fun parseKnownTypeActiveFromExpiry() {
        val future =
            parse(
                buildJsonObject {
                    put("premium_connectivity", true)
                    put("premium_connectivity_expiry_date", "2025-06-01")
                },
            ).single()
        assertTrue(future.active)
        assertEquals(151, future.daysLeft)
        assertEquals("2025-06-01", future.expiryDate)

        val past =
            parse(
                buildJsonObject {
                    put("full_self_driving", true)
                    put("full_self_driving_expiry_date", "2024-06-01")
                },
            ).single()
        assertFalse(past.active)
    }

    @Test
    fun parseKnownTypeActiveFromFlagWhenNoExpiry() {
        // truthy flag, no expiry ⇒ active (web Boolean(val)).
        assertTrue(parse(buildJsonObject { put("premium_connectivity", true) }).single().active)
        // numeric 0 passes the present filter but is falsy ⇒ inactive.
        assertFalse(parse(buildJsonObject { put("premium_connectivity", 0) }).single().active)
    }

    @Test
    fun parseKnownTypeReadsAlternateExpiryAndRenewalKeys() {
        val data =
            buildJsonObject {
                put("standard_connectivity", true)
                put("standard_connectivity_expiry", "2025-06-01")
                put("standard_connectivity_renewal_type", "annual")
            }
        val sub = parse(data).single()
        assertEquals("2025-06-01", sub.expiryDate)
        assertEquals("annual", sub.renewalType)
    }

    // ── generic-array parsing ─────────────────────────────────────────────────────

    @Test
    fun parseGenericArrayResolvesNameStatusAndExpiry() {
        val data =
            buildJsonObject {
                put(
                    "subscriptions",
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("name", "Toy Box")
                                put("status", "active")
                            },
                        )
                        add(
                            buildJsonObject {
                                put("type", "Range Boost")
                                put("status", "expired")
                            },
                        )
                        add(buildJsonObject { put("expiry_date", "2025-06-01") }) // no name/type ⇒ Unknown
                    },
                )
            }
        val subs = parse(data)
        assertEquals(listOf("Toy Box", "Range Boost", "Unknown"), subs.map { it.name })
        assertTrue(subs[0].active)
        assertFalse(subs[1].active)
        assertTrue(subs[2].active) // future expiry, no status
    }

    @Test
    fun parseGenericArrayDeduplicatesByNameCaseInsensitively() {
        val data =
            buildJsonObject {
                put("premium_connectivity", true) // ⇒ "Premium Connectivity"
                put(
                    "subscriptions",
                    buildJsonArray {
                        add(buildJsonObject { put("name", "premium connectivity") }) // duplicate (case-insensitive)
                        add(buildJsonObject { put("name", "Track Mode") })
                    },
                )
            }
        val names = parse(data).map { it.name }
        assertEquals(listOf("Premium Connectivity", "Track Mode"), names)
    }

    // ── projection ────────────────────────────────────────────────────────────────

    @Test
    fun projectBuildsEntriesWithFormattedValuesAndBadges() {
        val data =
            buildJsonObject {
                put("premium_connectivity", true)
                put("premium_connectivity_expiry_date", "2025-06-01")
                put("full_self_driving", true)
                put("full_self_driving_expiry_date", "2024-06-01")
                put("standard_connectivity", true)
                put("standard_connectivity_renewal", "monthly")
            }
        val display = SubscriptionsProjection.project(parse(data), strings)
        assertEquals(3, display.entries.size)
        assertEquals(SubscriptionEntry("Premium Connectivity", "Jun 1, 2025", true), display.entries[0])
        assertEquals(SubscriptionEntry("Full Self-Driving", "Jun 1, 2024", false), display.entries[1])
        // No expiry ⇒ renewal descriptor is the value.
        assertEquals(SubscriptionEntry("Standard Connectivity", "monthly", true), display.entries[2])
        assertTrue(display.hasSubscriptions)
    }

    @Test
    fun projectComputesActiveCountAndSoonestExpiry() {
        val data =
            buildJsonObject {
                put("premium_connectivity", true)
                put("premium_connectivity_expiry_date", "2025-09-01") // further out
                put("full_self_driving", true)
                put("full_self_driving_expiry_date", "2025-06-01") // soonest active
                put("enhanced_autopilot", true)
                put("enhanced_autopilot_expiry_date", "2024-01-01") // expired
            }
        val display = SubscriptionsProjection.project(parse(data), strings)
        assertEquals(2, display.activeCount)
        assertEquals("Jun 1, 2025", display.nextExpiryLabel)
    }

    @Test
    fun projectEntryValueFallsBackToEmDashWhenNoExpiryOrRenewal() {
        val sub = ParsedSub(name = "X", active = true, expiryDate = null, renewalType = null, daysLeft = null)
        assertEquals("\u2014", SubscriptionsProjection.entryValue(sub))
    }

    @Test
    fun formatExpiryDateProducesShortMonthOrEmDash() {
        assertEquals("Jun 1, 2025", SubscriptionsProjection.formatExpiryDate("2025-06-01"))
        assertEquals("Jun 1, 2025", SubscriptionsProjection.formatExpiryDate("2025-06-01T08:30:00Z"))
        assertEquals("\u2014", SubscriptionsProjection.formatExpiryDate(null))
        assertEquals("\u2014", SubscriptionsProjection.formatExpiryDate("nonsense"))
    }

    @Test
    fun projectEmptyShowsNoDataMessage() {
        val display = SubscriptionsProjection.project(emptyList(), strings)
        assertTrue(display.entries.isEmpty())
        assertFalse(display.hasSubscriptions)
        assertEquals(0, display.activeCount)
        assertNull(display.nextExpiryLabel)
        assertEquals("No subscriptions", display.emptyMessage)
        assertEquals("No subscriptions", display.contentDescription)
    }

    @Test
    fun projectEnvelopeUnwrapsDataObjectAndEmptyForNull() {
        val envelope = buildJsonObject { put("data", buildJsonObject { put("premium_connectivity", true) }) }
        assertTrue(SubscriptionsProjection.projectEnvelope(envelope, strings, NOW).hasSubscriptions)
        assertFalse(SubscriptionsProjection.projectEnvelope(JsonNull, strings, NOW).hasSubscriptions)
        assertFalse(SubscriptionsProjection.projectEnvelope(null, strings, NOW).hasSubscriptions)
        assertNull(subscriptionsData(JsonPrimitive("x")))
    }

    // ── registry / size ───────────────────────────────────────────────────────────

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("subscriptions", SubscriptionsRegistration.ID)
        assertEquals("vehicle", SubscriptionsRegistration.CATEGORY)
        assertEquals("SubscriptionsWidget", SubscriptionsRegistration.SLUG)
        assertEquals(SubscriptionsSize(cols = 2, rows = 4), SubscriptionsRegistration.defaultSize)
        assertEquals(SubscriptionsSize(cols = 1, rows = 2), SubscriptionsRegistration.minSize)
        assertEquals(SubscriptionsSize(cols = 4, rows = 40), SubscriptionsRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(SubscriptionsSize(cols = 4, rows = 40), SubscriptionsRegistration.clamp(SubscriptionsSize(9, 99)))
        assertEquals(SubscriptionsSize(cols = 1, rows = 2), SubscriptionsRegistration.clamp(SubscriptionsSize(0, 0)))
        assertTrue(SubscriptionsRegistration.isWithinBounds(SubscriptionsSize(2, 4)))
        assertFalse(SubscriptionsRegistration.isWithinBounds(SubscriptionsSize(5, 4)))
    }

    @Test
    fun compactBranchFollowsColumnCount() {
        assertTrue(SubscriptionsSize(cols = 1, rows = 4).isCompact)
        assertFalse(SubscriptionsSize(cols = 2, rows = 4).isCompact)
    }

    private companion object {
        /** 2025-01-01T00:00:00Z. */
        const val NOW: Long = 1_735_689_600_000L

        /** 2025-06-01T00:00:00Z — 151 days after [NOW]. */
        const val JUN_1_MIDNIGHT_UTC: Long = 1_748_736_000_000L
    }
}
