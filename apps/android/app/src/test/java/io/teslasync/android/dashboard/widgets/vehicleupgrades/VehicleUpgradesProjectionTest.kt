package io.teslasync.android.dashboard.widgets.vehicleupgrades

import io.teslasync.shared.core.presentation.sharing.ShareToken
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
 * Off-device verification of the VehicleUpgradesWidget's pure logic — the `asString` / `u.eligible !== false`
 * coercions, the `upgradesData` envelope read, the `parseUpgrades` known-array + top-level-keys parse, the
 * `daysUntil` expiry math, the `activeShareLinks` / `nearestExpiry` derivation, `formatExpiryDate`, and the
 * compact / standard projection (rows + price/eligibility badges + a11y descriptions, eligible count, active
 * count, nearest expiry, compact tile text) plus the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx).
 */
class VehicleUpgradesProjectionTest {
    private val strings =
        VehicleUpgradesStrings(
            title = "Upgrades & Sharing",
            available = "available",
            upToDate = "Up to date",
            upgradesHeading = "Available Upgrades",
            eligible = "Eligible",
            notEligible = "Not eligible",
            allApplied = "All upgrades applied",
            shareLinksHeading = "Share Links",
            activeLinks = "Active links",
            nearestExpiry = "Nearest expiry",
            noShareLinks = "No active share links",
        )

    // ── primitive coercions ────────────────────────────────────────────────────────

    @Test
    fun asStringCoercesLikeWeb() {
        assertEquals("hello", asString(JsonPrimitive("hello")))
        assertEquals("2000", asString(JsonPrimitive(2000)))
        assertNull(asString(JsonPrimitive("")))
        assertNull(asString(JsonPrimitive(true)))
        assertNull(asString(JsonNull))
        assertNull(asString(null))
    }

    @Test
    fun isEligibleIsFalseOnlyForBooleanFalse() {
        assertFalse(isEligible(JsonPrimitive(false)))
        assertTrue(isEligible(JsonPrimitive(true)))
        // Web `u.eligible !== false`: a string (even "false"), a number, JSON-null, or an absent key is eligible.
        assertTrue(isEligible(JsonPrimitive("false")))
        assertTrue(isEligible(JsonPrimitive(0)))
        assertTrue(isEligible(JsonNull))
        assertTrue(isEligible(null))
    }

    @Test
    fun upgradesDataReadsTheEnvelopeDataKey() {
        val envelope = buildJsonObject { put("data", buildJsonObject { put("x", 1) }) }
        assertEquals(buildJsonObject { put("x", 1) }, upgradesData(envelope))
        assertNull(upgradesData(buildJsonObject { put("data", JsonNull) }))
        assertNull(upgradesData(buildJsonObject { put("other", 1) }))
        assertNull(upgradesData(null))
    }

    // ── parseUpgrades ───────────────────────────────────────────────────────────────

    @Test
    fun parseUpgradesReadsTheUpgradesArray() {
        val data =
            buildJsonObject {
                put(
                    "upgrades",
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("title", "Acceleration Boost")
                                put("cost", "2000")
                                put("summary", "Quicker 0-60")
                            },
                        )
                        add(
                            buildJsonObject {
                                put("name", "FSD")
                                put("eligible", false)
                            },
                        )
                    },
                )
            }
        val parsed = parseUpgrades(data)
        assertEquals(2, parsed.size)
        // name←title, price←cost, description←summary; eligible defaults true.
        assertEquals(ParsedUpgrade("Acceleration Boost", "2000", "Quicker 0-60", eligible = true), parsed[0])
        assertEquals(ParsedUpgrade("FSD", null, null, eligible = false), parsed[1])
    }

    @Test
    fun parseUpgradesNamesArrayEntryWithoutNameAsUnknown() {
        val data = buildJsonObject { put("upgrades", buildJsonArray { add(buildJsonObject { put("price", "10") }) }) }
        assertEquals("Unknown Upgrade", parseUpgrades(data).single().name)
    }

    @Test
    fun parseUpgradesFallsBackToTopLevelObjectKeys() {
        val data =
            buildJsonObject {
                put(
                    "ludicrous",
                    buildJsonObject {
                        put("price", "5000")
                        put("eligible", true)
                    },
                )
                put("note", "ignored-non-object")
            }
        val parsed = parseUpgrades(data)
        // The non-object "note" value is skipped; the object key names the upgrade (web `?? key`).
        assertEquals(1, parsed.size)
        assertEquals("ludicrous", parsed.single().name)
        assertEquals("5000", parsed.single().price)
    }

    @Test
    fun parseUpgradesIsEmptyForNullOrNonObject() {
        assertTrue(parseUpgrades(null).isEmpty())
        assertTrue(parseUpgrades(JsonPrimitive("x")).isEmpty())
    }

    // ── date math ─────────────────────────────────────────────────────────────────

    @Test
    fun parseDateMillisHandlesIsoVariants() {
        assertEquals(JUN_1_MIDNIGHT_UTC, parseDateMillis("2025-06-01"))
        assertEquals(JUN_1_MIDNIGHT_UTC, parseDateMillis("2025-06-01T00:00:00Z"))
        assertEquals(JUN_1_MIDNIGHT_UTC, parseDateMillis("2025-06-01T00:00:00"))
        assertEquals(JUN_1_MIDNIGHT_UTC, parseDateMillis("2025-06-01T00:00:00+00:00"))
        assertNull(parseDateMillis(null))
        assertNull(parseDateMillis("   "))
        assertNull(parseDateMillis("not-a-date"))
    }

    @Test
    fun daysUntilCeilsToWholeDays() {
        assertEquals(151, daysUntil("2025-06-01", NOW))
        assertEquals(152, daysUntil("2025-06-01T12:00:00Z", NOW))
        assertTrue((daysUntil("2024-06-01", NOW) ?: 0) < 0)
        assertNull(daysUntil(null, NOW))
    }

    @Test
    fun formatExpiryDateMatchesWebShortForm() {
        assertEquals("Jun 1, 2025", formatExpiryDate("2025-06-01"))
        assertEquals("Dec 31, 2025", formatExpiryDate("2025-12-31T23:59:00Z"))
        assertEquals("\u2014", formatExpiryDate(null))
        assertEquals("\u2014", formatExpiryDate("garbage"))
    }

    // ── share links ─────────────────────────────────────────────────────────────────

    @Test
    fun activeShareLinksKeepsFutureUndatedAndUnparseable() {
        val links =
            listOf(
                shareToken(1, expiresAt = null),
                shareToken(2, expiresAt = "2025-06-01"),
                shareToken(3, expiresAt = "2024-06-01"),
                shareToken(4, expiresAt = "not-a-date"),
            )
        val active = activeShareLinks(links, NOW).map { it.id }
        // No-expiry (1), future (2), unparseable (4) are active; the past link (3) is dropped.
        assertEquals(listOf(1L, 2L, 4L), active)
    }

    @Test
    fun nearestExpiryPicksTheSoonestFutureDatedLink() {
        val links =
            listOf(
                shareToken(1, expiresAt = null),
                shareToken(2, expiresAt = "2025-09-01"),
                shareToken(3, expiresAt = "2025-06-01"),
            )
        assertEquals(3L, nearestExpiry(activeShareLinks(links, NOW), NOW)?.id)
    }

    // ── projection ─────────────────────────────────────────────────────────────────

    @Test
    fun projectBuildsRowsCountsAndShareSummary() {
        val snapshot =
            VehicleUpgradesSnapshot(
                upgradesData =
                    buildJsonObject {
                        put(
                            "upgrades",
                            buildJsonArray {
                                add(
                                    buildJsonObject {
                                        put("name", "Boost")
                                        put("price", "2000")
                                        put("eligible", true)
                                    },
                                )
                                add(
                                    buildJsonObject {
                                        put("name", "FSD")
                                        put("eligible", false)
                                    },
                                )
                            },
                        )
                    },
                shareLinks = listOf(shareToken(1, expiresAt = "2025-06-01"), shareToken(2, expiresAt = "2024-06-01")),
            )
        val display = VehicleUpgradesProjection.project(snapshot, VehicleUpgradesSize(cols = 3, rows = 4), strings, NOW)

        assertEquals(2, display.upgrades.size)
        assertEquals(1, display.eligibleCount)
        assertTrue(display.hasUpgrades)
        assertEquals("$2000", display.upgrades[0].priceLabel)
        assertEquals("Eligible", display.upgrades[0].eligibilityLabel)
        assertEquals("Boost, $2000, Eligible", display.upgrades[0].contentDescription)
        assertEquals("FSD, Not eligible", display.upgrades[1].contentDescription)
        // Only the future-dated link is active; it is the nearest expiry.
        assertEquals(1, display.activeShareLinkCount)
        assertTrue(display.hasActiveShareLinks)
        assertEquals("Jun 1, 2025", display.nearestExpiryLabel)
        assertTrue(display.isWide)
    }

    @Test
    fun projectCompactDescriptionShowsCountOrUpToDate() {
        val withUpgrades =
            VehicleUpgradesSnapshot(
                upgradesData = buildJsonObject { put("upgrades", buildJsonArray { add(buildJsonObject { put("name", "A") }) }) },
                shareLinks = emptyList(),
            )
        val compact = VehicleUpgradesSize(cols = 1, rows = 2)
        assertEquals("1 available", VehicleUpgradesProjection.project(withUpgrades, compact, strings, NOW).compactDescription)
        assertEquals(
            "Up to date",
            VehicleUpgradesProjection.project(VehicleUpgradesSnapshot.EMPTY, compact, strings, NOW).compactDescription,
        )
    }

    @Test
    fun projectEmptySnapshotHasNoContent() {
        assertTrue(VehicleUpgradesSnapshot.EMPTY.hasNoContent())
        val withLink = VehicleUpgradesSnapshot(upgradesData = null, shareLinks = listOf(shareToken(1, null)))
        assertFalse(withLink.hasNoContent())
    }

    // ── registry ─────────────────────────────────────────────────────────────────

    @Test
    fun registrationMatchesTheWebRegistry() {
        assertEquals("vehicle-upgrades", VehicleUpgradesRegistration.ID)
        assertEquals("vehicle", VehicleUpgradesRegistration.CATEGORY)
        assertEquals("VehicleUpgradesWidget", VehicleUpgradesRegistration.SLUG)
        assertEquals(VehicleUpgradesSize(2, 4), VehicleUpgradesRegistration.defaultSize)
        assertEquals(VehicleUpgradesSize(1, 2), VehicleUpgradesRegistration.minSize)
        assertEquals(VehicleUpgradesSize(4, 40), VehicleUpgradesRegistration.maxSize)
        assertTrue(VehicleUpgradesRegistration.isWithinBounds(VehicleUpgradesSize(2, 4)))
        assertFalse(VehicleUpgradesRegistration.isWithinBounds(VehicleUpgradesSize(9, 99)))
        assertEquals(VehicleUpgradesSize(4, 40), VehicleUpgradesRegistration.clamp(VehicleUpgradesSize(9, 99)))
    }

    @Test
    fun sizeFlagsMatchWebBreakpoints() {
        assertTrue(VehicleUpgradesSize(1, 4).isCompact)
        assertFalse(VehicleUpgradesSize(2, 4).isCompact)
        assertTrue(VehicleUpgradesSize(3, 4).isWide)
        assertFalse(VehicleUpgradesSize(2, 4).isWide)
    }

    private fun shareToken(
        id: Long,
        expiresAt: String?,
    ): ShareToken =
        ShareToken(
            id = id,
            token = "tok$id",
            driveId = 1L,
            includeMap = true,
            includeTelemetry = false,
            includeSpeed = true,
            views = 0,
            expiresAt = expiresAt,
            createdAt = "2024-01-01T00:00:00Z",
        )

    private companion object {
        /** 2025-01-01T00:00:00Z — anchors the deterministic expiry math. */
        const val NOW: Long = 1_735_689_600_000L

        /** 2025-06-01T00:00:00Z. */
        const val JUN_1_MIDNIGHT_UTC: Long = 1_748_736_000_000L
    }
}
