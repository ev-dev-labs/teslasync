package io.teslasync.android.dashboard.widgets.softwareupdatehistory

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
 * Off-device verification of the SoftwareUpdateHistoryWidget's pure logic — the JSON parse (web camel-key
 * first with the canonical snake_case `installed_at` / `scheduled_at` / `created_at` fallbacks), the
 * `STATUS_MAP` glyph/accent + `DEFAULT_STATUS` fallback, the compact-badge tone, the
 * `installedAt ?? scheduledAt ?? createdAt ?? epoch` timestamp resolution, the `WidgetEventFeed`-equivalent
 * relative-time tiers, the projection (the `isCurrent = idx === 0 && installed` rule against raw order,
 * newest-first sort, fifteen-row cap, version title, current/status subtitle, clean a11y label, compact
 * raw-first version+badge), the registry metadata, the tolerant timestamp parse, and vehicle resolution.
 * Mirrors the web spec (web/src/features/dashboard/widgets/SoftwareUpdateHistoryWidget.tsx).
 */
class SoftwareUpdateHistoryProjectionTest {
    private val now = parseEpochMillis("2026-06-06T12:05:00Z")!!

    private fun strings(): SoftwareUpdateHistoryStrings =
        SoftwareUpdateHistoryStrings(
            title = "Update History",
            currentLabel = "Current",
            emptyMessage = "No update history",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            // Web `t('widget.updateStatus', status)` (the Android catalog value is the bare "%1$s"); the test
            // wraps it in brackets so an assertion can prove the formatter is actually wired for the badge.
            formatStatus = { "[$it]" },
            formatEventTime = ::renderEventTime,
            formatRelative = ::renderRelative,
        )

    private fun entry(
        id: Long = 1,
        version: String? = "2026.20.5",
        status: String? = "installed",
        installedAt: String? = "2026-06-06T12:00:00Z",
        createdAt: String? = "2026-06-01T00:00:00Z",
    ): SoftwareUpdateEntry = SoftwareUpdateEntry(id, version, status, installedAt, scheduledAt = null, createdAt = createdAt)

    private fun project(
        entries: List<SoftwareUpdateEntry>,
        size: SoftwareUpdateHistorySize = SoftwareUpdateHistoryRegistration.defaultSize,
    ): SoftwareUpdateHistoryDisplay = SoftwareUpdateHistoryProjection.project(entries, size, strings(), now)

    // ---- JSON parse: canonical backend keys (web camel reads resolve via fallback) --

    @Test
    fun parseListDecodesCanonicalSnakeCaseKeys() {
        val json =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", 7L)
                        put("version", "2026.20.5")
                        put("status", "installed")
                        put("installed_at", "2026-06-06T11:00:00Z")
                        put("scheduled_at", JsonNull)
                        put("created_at", "2026-06-01T00:00:00Z")
                    },
                )
                add(JsonPrimitive("not-an-object"))
            }
        val parsed = SoftwareUpdateEntry.parseList(json)
        assertEquals(1, parsed.size)
        assertEquals(
            SoftwareUpdateEntry(7L, "2026.20.5", "installed", "2026-06-06T11:00:00Z", null, "2026-06-01T00:00:00Z"),
            parsed.single(),
        )
    }

    @Test
    fun parseListPrefersWebCamelKeysOverCanonicalFallback() {
        // When a web-named camel key is present it wins; otherwise the canonical snake_case key is used.
        val json =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", 3L)
                        put("version", "2026.8.1")
                        put("status", "scheduled")
                        put("installedAt", "2026-06-06T10:00:00Z")
                        put("installed_at", "2020-01-01T00:00:00Z")
                        put("scheduledAt", "2026-06-07T00:00:00Z")
                    },
                )
            }
        val parsed = SoftwareUpdateEntry.parseList(json).single()
        assertEquals("2026-06-06T10:00:00Z", parsed.installedAt)
        assertEquals("2026-06-07T00:00:00Z", parsed.scheduledAt)
        assertNull(parsed.createdAt)
    }

    @Test
    fun parseListIsTolerantOfMissingNullFieldsAndNonArrays() {
        val json =
            buildJsonArray {
                add(
                    buildJsonObject {
                        // id absent -> 0; every other field absent/null -> null
                        put("version", JsonNull)
                    },
                )
            }
        assertEquals(SoftwareUpdateEntry(0L, null, null, null, null, null), SoftwareUpdateEntry.parseList(json).single())
        assertTrue(SoftwareUpdateEntry.parseList(JsonPrimitive("nope")).isEmpty())
        assertTrue(SoftwareUpdateEntry.parseList(null).isEmpty())
    }

    // ---- status tokens (web STATUS_MAP / DEFAULT_STATUS) ----------------------------

    @Test
    fun statusTokensMapGlyphAndToneLikeWeb() {
        assertEquals(SoftwareUpdateGlyph.Check to SoftwareUpdateTone.Installed, SoftwareUpdateStatusTokens.of("installed"))
        assertEquals(
            SoftwareUpdateGlyph.ArrowDownCircle to SoftwareUpdateTone.Installing,
            SoftwareUpdateStatusTokens.of("installing"),
        )
        assertEquals(
            SoftwareUpdateGlyph.ArrowDownCircle to SoftwareUpdateTone.Downloading,
            SoftwareUpdateStatusTokens.of("downloading"),
        )
        assertEquals(SoftwareUpdateGlyph.Download to SoftwareUpdateTone.Available, SoftwareUpdateStatusTokens.of("available"))
        assertEquals(SoftwareUpdateGlyph.Clock to SoftwareUpdateTone.Scheduled, SoftwareUpdateStatusTokens.of("scheduled"))
        // Unknown + null fall back to the web DEFAULT_STATUS (download glyph, muted accent).
        assertEquals(SoftwareUpdateGlyph.Download to SoftwareUpdateTone.Available, SoftwareUpdateStatusTokens.of("rebooting"))
        assertEquals(SoftwareUpdateGlyph.Download to SoftwareUpdateTone.Available, SoftwareUpdateStatusTokens.of(null))
        // Case-insensitive (web compares lower-cased status keys).
        assertEquals(SoftwareUpdateGlyph.Check to SoftwareUpdateTone.Installed, SoftwareUpdateStatusTokens.of("Installed"))
    }

    @Test
    fun badgeToneAndIsInstalledMatchWeb() {
        assertEquals(SoftwareUpdateBadgeTone.Success, SoftwareUpdateStatusTokens.badgeToneFor("installed"))
        assertEquals(SoftwareUpdateBadgeTone.Warning, SoftwareUpdateStatusTokens.badgeToneFor("installing"))
        assertEquals(SoftwareUpdateBadgeTone.Info, SoftwareUpdateStatusTokens.badgeToneFor("downloading"))
        assertEquals(SoftwareUpdateBadgeTone.Info, SoftwareUpdateStatusTokens.badgeToneFor("available"))
        assertEquals(SoftwareUpdateBadgeTone.Info, SoftwareUpdateStatusTokens.badgeToneFor(null))
        assertTrue(SoftwareUpdateStatusTokens.isInstalled("installed"))
        assertTrue(SoftwareUpdateStatusTokens.isInstalled("INSTALLED"))
        assertFalse(SoftwareUpdateStatusTokens.isInstalled("installing"))
        assertFalse(SoftwareUpdateStatusTokens.isInstalled(null))
    }

    // ---- effective timestamp (web installedAt ?? scheduledAt ?? createdAt ?? epoch) -

    @Test
    fun effectiveTimestampResolvesNullishChain() {
        assertEquals("i", SoftwareUpdateEntry(1, "v", "installed", "i", "s", "c").effectiveTimestamp)
        assertEquals("s", SoftwareUpdateEntry(1, "v", "installed", null, "s", "c").effectiveTimestamp)
        assertEquals("c", SoftwareUpdateEntry(1, "v", "installed", null, null, "c").effectiveTimestamp)
        // All absent -> the web `new Date(0).toISOString()` final fallback (epoch-millis 0).
        val epochIso = SoftwareUpdateEntry(1, "v", "installed", null, null, null).effectiveTimestamp
        assertEquals(0L, parseEpochMillis(epochIso))
    }

    // ---- relative-time tiers (web WidgetEventFeed.formatRelativeTime) ----------------

    @Test
    fun eventTimeTiersMatchWebCutoffs() {
        assertEquals(SoftwareUpdateEventTime.JustNow, SoftwareUpdateHistoryProjection.computeEventTime("2026-06-06T12:04:30Z", now))
        assertEquals(
            SoftwareUpdateEventTime.MinutesAgo(5),
            SoftwareUpdateHistoryProjection.computeEventTime("2026-06-06T12:00:00Z", now),
        )
        assertEquals(
            SoftwareUpdateEventTime.HoursAgo(2),
            SoftwareUpdateHistoryProjection.computeEventTime("2026-06-06T10:00:00Z", now),
        )
        val twoDaysAgo = "2026-06-04T12:00:00Z"
        assertEquals(
            SoftwareUpdateEventTime.Absolute(parseEpochMillis(twoDaysAgo)!!),
            SoftwareUpdateHistoryProjection.computeEventTime(twoDaysAgo, now),
        )
    }

    @Test
    fun eventTimeEpochIsAbsoluteAndUnparseableIsUnknown() {
        // The web `?? new Date(0)` final fallback renders as an absolute date (always > 24h ago).
        assertEquals(
            SoftwareUpdateEventTime.Absolute(0L),
            SoftwareUpdateHistoryProjection.computeEventTime("1970-01-01T00:00:00.000Z", now),
        )
        // A present-but-unparseable timestamp renders the em dash rather than throwing.
        assertEquals(SoftwareUpdateEventTime.Unknown, SoftwareUpdateHistoryProjection.computeEventTime("garbage", now))
    }

    // ---- feed projection ------------------------------------------------------------

    @Test
    fun firstInstalledRowIsCurrentWithCyanAccentAndCurrentSubtitle() {
        val row = project(listOf(entry(version = "2026.20.5", status = "installed"))).items.single()
        assertEquals("2026.20.5", row.title)
        assertEquals("Current", row.subtitle)
        assertEquals(SoftwareUpdateTone.Current, row.tone)
        assertEquals(SoftwareUpdateGlyph.Check, row.glyph)
        assertEquals("5m ago", row.relativeTime)
        assertEquals("2026.20.5, Current, 5m ago", row.contentDescription)
    }

    @Test
    fun installedButNotFirstIsNotCurrent() {
        val entries =
            listOf(
                entry(id = 10, version = "A", status = "installing", installedAt = null, createdAt = "2026-06-06T12:04:00Z"),
                entry(id = 20, version = "B", status = "installed", installedAt = "2026-06-06T12:00:00Z", createdAt = null),
            )
        val display = project(entries)
        val rowA = display.items.first { it.id == 10L }
        val rowB = display.items.first { it.id == 20L }
        // Index 0 (installing) is not "installed" -> not current; installing glyph/tone, raw status subtitle.
        assertEquals(SoftwareUpdateTone.Installing, rowA.tone)
        assertEquals(SoftwareUpdateGlyph.ArrowDownCircle, rowA.glyph)
        assertEquals("installing", rowA.subtitle)
        // Index 1 is installed but NOT index 0 -> not current; the success-toned installed marker.
        assertEquals(SoftwareUpdateTone.Installed, rowB.tone)
        assertEquals(SoftwareUpdateGlyph.Check, rowB.glyph)
        assertEquals("installed", rowB.subtitle)
    }

    @Test
    fun nonCurrentSubtitleUsesRawStatusNotFormatter() {
        // Feed rows use the raw status (web `upd.status ?? '—'`); only the COMPACT badge uses formatStatus.
        val entries =
            listOf(
                entry(id = 1, status = "installed"),
                entry(id = 2, version = "X", status = "available", installedAt = null, createdAt = "2026-06-06T11:00:00Z"),
            )
        val avail = project(entries).items.first { it.id == 2L }
        assertEquals("available", avail.subtitle)
        assertEquals(SoftwareUpdateTone.Available, avail.tone)
        assertEquals(SoftwareUpdateGlyph.Download, avail.glyph)
    }

    @Test
    fun nullVersionFallsBackToEmDash() {
        val row = project(listOf(entry(version = null, status = "scheduled"))).items.single()
        assertEquals("\u2014", row.title)
        assertEquals("scheduled", row.subtitle)
        assertEquals("\u2014, scheduled, 5m ago", row.contentDescription)
    }

    @Test
    fun feedSortsNewestFirstButCompactUsesRawFirstItem() {
        val older = entry(id = 1, version = "Older", status = "available", installedAt = null, createdAt = "2026-06-01T00:00:00Z")
        val newer = entry(id = 2, version = "Newer", status = "available", installedAt = null, createdAt = "2026-06-06T12:03:00Z")
        val display = project(listOf(older, newer))
        // Feed head is the newest update …
        assertEquals("Newer", display.items.first().title)
        // … but the compact row reads the raw first item (web list[0]), which is the older one.
        assertEquals("Older", display.compactVersion)
    }

    @Test
    fun feedCapsAtFifteenRows() {
        val entries =
            (1..20).map {
                entry(id = it.toLong(), status = "available", installedAt = null, createdAt = "2026-06-06T12:%02d:00Z".format(it))
            }
        assertEquals(SoftwareUpdateHistorySize.MAX_FEED_ITEMS, project(entries).items.size)
    }

    // ---- compact view (web CompactView) ---------------------------------------------

    @Test
    fun compactInstalledShowsCurrentBadge() {
        val display = project(listOf(entry(version = "2026.20.5", status = "installed")))
        assertEquals("2026.20.5", display.compactVersion)
        assertEquals("Current", display.compactBadgeText)
        assertEquals(SoftwareUpdateBadgeTone.Success, display.compactBadgeTone)
        assertEquals("2026.20.5, Current", display.compactContentDescription)
    }

    @Test
    fun compactNonInstalledShowsFormattedStatusBadge() {
        val display = project(listOf(entry(version = "2026.8.1", status = "available")))
        // Web `t('widget.updateStatus', latestStatus)` -> the injected formatter renders "[available]".
        assertEquals("[available]", display.compactBadgeText)
        assertEquals(SoftwareUpdateBadgeTone.Info, display.compactBadgeTone)
    }

    @Test
    fun compactInstallingShowsWarningBadge() {
        val display = project(listOf(entry(version = "2026.9.0", status = "installing")))
        assertEquals("[installing]", display.compactBadgeText)
        assertEquals(SoftwareUpdateBadgeTone.Warning, display.compactBadgeTone)
    }

    @Test
    fun emptyEntriesYieldNoItemsAndEmDashCompactVersion() {
        val display = project(emptyList())
        assertFalse(display.hasItems)
        assertTrue(display.items.isEmpty())
        assertEquals("\u2014", display.compactVersion)
    }

    @Test
    fun isCompactFollowsColumnCount() {
        assertTrue(project(listOf(entry()), SoftwareUpdateHistorySize(cols = 1, rows = 4)).isCompact)
        assertFalse(project(listOf(entry()), SoftwareUpdateHistorySize(cols = 2, rows = 4)).isCompact)
    }

    // ---- registry metadata (web registry/vehicle.ts) --------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("software-update-history", SoftwareUpdateHistoryRegistration.ID)
        assertEquals("vehicle", SoftwareUpdateHistoryRegistration.CATEGORY)
        assertEquals("SoftwareUpdateHistoryWidget", SoftwareUpdateHistoryRegistration.SLUG)
        assertEquals(SoftwareUpdateHistorySize(cols = 2, rows = 4), SoftwareUpdateHistoryRegistration.defaultSize)
        assertEquals(SoftwareUpdateHistorySize(cols = 1, rows = 4), SoftwareUpdateHistoryRegistration.minSize)
        assertEquals(SoftwareUpdateHistorySize(cols = 4, rows = 40), SoftwareUpdateHistoryRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(SoftwareUpdateHistoryRegistration.isWithinBounds(SoftwareUpdateHistorySize(cols = 2, rows = 4)))
        assertFalse(SoftwareUpdateHistoryRegistration.isWithinBounds(SoftwareUpdateHistorySize(cols = 0, rows = 1)))
        assertFalse(SoftwareUpdateHistoryRegistration.isWithinBounds(SoftwareUpdateHistorySize(cols = 5, rows = 50)))
        assertEquals(
            SoftwareUpdateHistorySize(cols = 1, rows = 4),
            SoftwareUpdateHistoryRegistration.clamp(SoftwareUpdateHistorySize(cols = 0, rows = 0)),
        )
        assertEquals(
            SoftwareUpdateHistorySize(cols = 4, rows = 40),
            SoftwareUpdateHistoryRegistration.clamp(SoftwareUpdateHistorySize(cols = 9, rows = 99)),
        )
    }

    // ---- vehicle resolution (web vehicleId ?? vehicles?.[0]?.id) --------------------

    @Test
    fun resolveVehicleIdPrefersExplicitThenFirstVehicle() {
        assertEquals(42L, resolveVehicleId(42L, vehicles = null))
        assertNull(resolveVehicleId(null, vehicles = null))
        assertNull(resolveVehicleId(0L, vehicles = emptyList()))
        assertNull(firstVehicleId(null))
        assertNull(firstVehicleId(emptyList()))
    }

    // ---- tolerant timestamp parse ---------------------------------------------------

    @Test
    fun parseEpochMillisIsTolerant() {
        assertNull(parseEpochMillis(null))
        assertNull(parseEpochMillis(""))
        assertNull(parseEpochMillis("not-a-date"))
        assertEquals(0L, parseEpochMillis("1970-01-01T00:00:00Z"))
        assertEquals(
            parseEpochMillis("2026-06-06T12:00:00Z"),
            parseEpochMillis("2026-06-06T14:00:00+02:00"),
        )
    }

    private fun renderEventTime(time: SoftwareUpdateEventTime): String =
        when (time) {
            SoftwareUpdateEventTime.Unknown -> "\u2014"
            SoftwareUpdateEventTime.JustNow -> "just now"
            is SoftwareUpdateEventTime.MinutesAgo -> "${time.value}m ago"
            is SoftwareUpdateEventTime.HoursAgo -> "${time.value}h ago"
            is SoftwareUpdateEventTime.Absolute -> "abs:${time.epochMillis}"
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
