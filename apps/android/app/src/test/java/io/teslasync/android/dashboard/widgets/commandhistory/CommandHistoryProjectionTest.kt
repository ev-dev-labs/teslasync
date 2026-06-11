package io.teslasync.android.dashboard.widgets.commandhistory

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
 * Off-device verification of the CommandHistoryWidget's pure logic — the JSON parse, the status→glyph/tone
 * map, the compact badge variant, the `formatCommandName` boundary rule, the `WidgetEventFeed`-equivalent
 * relative-time tiers, the projection (newest-first sort, ten-row cap, row title/subtitle/a11y label,
 * compact raw-first pick), the registry metadata, and the tolerant timestamp parse. Mirrors the web spec
 * (web/src/features/dashboard/widgets/CommandHistoryWidget.tsx).
 */
class CommandHistoryProjectionTest {
    private val now = parseEpochMillis("2026-06-06T12:05:00Z")!!

    private fun strings(): CommandHistoryStrings =
        CommandHistoryStrings(
            title = "Command History",
            emptyMessage = "No commands sent",
            successLabel = "Success",
            failedLabel = "Failed",
            pendingLabel = "Pending",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            formatEventTime = ::renderEventTime,
            formatRelative = ::renderRelative,
        )

    private fun entry(
        id: Long = 1,
        command: String? = "lock",
        status: String? = "success",
        createdAt: String? = "2026-06-06T12:00:00Z",
    ): CommandLogEntry = CommandLogEntry(id = id, command = command, status = status, createdAt = createdAt)

    private fun project(
        entries: List<CommandLogEntry>,
        size: CommandHistorySize = CommandHistoryRegistration.defaultSize,
    ): CommandHistoryDisplay = CommandHistoryProjection.project(entries, size, strings(), now)

    // ---- JSON parse (web select: data ?? []) ----------------------------------------

    @Test
    fun parseListDecodesObjectsAndSkipsNonObjects() {
        val json =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", 7L)
                        put("command", "remote_start_drive")
                        put("status", "failed")
                        put("created_at", "2026-06-06T11:00:00Z")
                    },
                )
                add(JsonPrimitive("not-an-object"))
            }
        val parsed = CommandLogEntry.parseList(json)
        assertEquals(1, parsed.size)
        assertEquals(CommandLogEntry(7L, "remote_start_drive", "failed", "2026-06-06T11:00:00Z"), parsed.single())
    }

    @Test
    fun parseListIsTolerantOfMissingAndNullFieldsAndNonArrays() {
        val json =
            buildJsonArray {
                add(
                    buildJsonObject {
                        // id absent -> 0; command JSON null -> null; status/created_at absent -> null
                        put("command", JsonNull)
                    },
                )
            }
        val parsed = CommandLogEntry.parseList(json)
        assertEquals(CommandLogEntry(0L, null, null, null), parsed.single())
        assertTrue(CommandLogEntry.parseList(JsonPrimitive("nope")).isEmpty())
        assertTrue(CommandLogEntry.parseList(null).isEmpty())
    }

    // ---- status -> glyph/tone map (web STATUS_MAP / DEFAULT_STATUS) ------------------

    @Test
    fun statusTokensMatchWebMap() {
        assertEquals(CommandStatusGlyph.Check to CommandStatusTone.Success, CommandStatusTokens.of("success"))
        assertEquals(CommandStatusGlyph.Cross to CommandStatusTone.Danger, CommandStatusTokens.of("failed"))
        assertEquals(CommandStatusGlyph.Clock to CommandStatusTone.Warning, CommandStatusTokens.of("pending"))
    }

    @Test
    fun unknownNullAndCasedStatusFallBackToDefaultExactly() {
        assertEquals(CommandStatusGlyph.Terminal to CommandStatusTone.Muted, CommandStatusTokens.of("queued"))
        assertEquals(CommandStatusGlyph.Terminal to CommandStatusTone.Muted, CommandStatusTokens.of(null))
        // Web indexes STATUS_MAP with the raw string — a cased value misses and falls to DEFAULT.
        assertEquals(CommandStatusGlyph.Terminal to CommandStatusTone.Muted, CommandStatusTokens.of("SUCCESS"))
    }

    // ---- compact badge variant (web CompactView) ------------------------------------

    @Test
    fun compactBadgeToneMatchesWeb() {
        assertEquals(CommandBadgeTone.Success, CommandHistoryProjection.compactBadgeTone("success"))
        assertEquals(CommandBadgeTone.Danger, CommandHistoryProjection.compactBadgeTone("failed"))
        // Web's `else` arm: pending AND any other/cased value render the warning "Pending" badge.
        assertEquals(CommandBadgeTone.Warning, CommandHistoryProjection.compactBadgeTone("pending"))
        assertEquals(CommandBadgeTone.Warning, CommandHistoryProjection.compactBadgeTone("queued"))
        assertEquals(CommandBadgeTone.Warning, CommandHistoryProjection.compactBadgeTone(null))
    }

    // ---- formatCommandName (web /\b\w/g -> toUpperCase) -----------------------------

    @Test
    fun formatCommandNameMatchesWeb() {
        assertEquals("Remote Start Drive", CommandHistoryProjection.formatCommandName("remote_start_drive"))
        assertEquals("Flash Lights", CommandHistoryProjection.formatCommandName("flash_lights"))
        assertEquals("Set Charge Limit 80", CommandHistoryProjection.formatCommandName("set_charge_limit_80"))
        // Web only upper-cases boundary chars; it never lower-cases the rest.
        assertEquals("HONK HORN", CommandHistoryProjection.formatCommandName("HONK_HORN"))
        assertEquals("", CommandHistoryProjection.formatCommandName(""))
        assertEquals("\u2014", CommandHistoryProjection.formatCommandName("\u2014"))
    }

    // ---- relative-time tiers (web WidgetEventFeed.formatRelativeTime) ----------------

    @Test
    fun eventTimeTiersMatchWebCutoffs() {
        assertEquals(CommandEventTime.JustNow, CommandHistoryProjection.computeEventTime("2026-06-06T12:04:30Z", now))
        assertEquals(CommandEventTime.MinutesAgo(5), CommandHistoryProjection.computeEventTime("2026-06-06T12:00:00Z", now))
        assertEquals(CommandEventTime.HoursAgo(2), CommandHistoryProjection.computeEventTime("2026-06-06T10:00:00Z", now))
        val twoDaysAgo = "2026-06-04T12:00:00Z"
        assertEquals(
            CommandEventTime.Absolute(parseEpochMillis(twoDaysAgo)!!),
            CommandHistoryProjection.computeEventTime(twoDaysAgo, now),
        )
    }

    @Test
    fun eventTimeNullIsEpochAndUnparseableIsUnknown() {
        // Web `created_at ?? new Date(0)` -> a null timestamp is the epoch (always > 24h ago).
        assertEquals(CommandEventTime.Absolute(0L), CommandHistoryProjection.computeEventTime(null, now))
        // A present-but-unparseable timestamp renders the em dash rather than throwing.
        assertEquals(CommandEventTime.Unknown, CommandHistoryProjection.computeEventTime("garbage", now))
    }

    // ---- feed projection ------------------------------------------------------------

    @Test
    fun rowProjectsTitleSubtitleGlyphToneAndAccessibleName() {
        val display = project(listOf(entry(command = "remote_start_drive", status = "failed")))
        val row = display.items.single()
        assertEquals("Remote Start Drive", row.title)
        assertEquals("failed", row.subtitle)
        assertEquals(CommandStatusGlyph.Cross, row.glyph)
        assertEquals(CommandStatusTone.Danger, row.tone)
        assertEquals("5m ago", row.relativeTime)
        assertEquals("Remote Start Drive, failed, 5m ago", row.contentDescription)
    }

    @Test
    fun nullCommandAndStatusFallBackToEmDash() {
        val display = project(listOf(entry(command = null, status = null)))
        val row = display.items.single()
        assertEquals("\u2014", row.title)
        assertEquals("\u2014", row.subtitle)
        assertEquals(CommandStatusGlyph.Terminal, row.glyph)
    }

    @Test
    fun feedSortsNewestFirstButCompactUsesRawFirstItem() {
        val older = entry(id = 1, command = "older", createdAt = "2026-06-06T09:00:00Z")
        val newer = entry(id = 2, command = "newer", createdAt = "2026-06-06T12:03:00Z")
        val display = project(listOf(older, newer))
        // Feed head is the newest command …
        assertEquals("Newer", display.items.first().title)
        // … but the compact row reads the raw first item (web list[0]), which is the older one.
        assertEquals("Older", display.compactCommandName)
    }

    @Test
    fun feedCapsAtTenRows() {
        val entries = (1..12).map { entry(id = it.toLong(), createdAt = "2026-06-06T%02d:00:00Z".format(it)) }
        val display = project(entries)
        assertEquals(CommandHistorySize.MAX_FEED_ITEMS, display.items.size)
    }

    @Test
    fun emptyEntriesYieldNoItemsAndEmptyDescription() {
        val display = project(emptyList())
        assertFalse(display.hasItems)
        assertTrue(display.items.isEmpty())
        assertEquals("No commands sent", display.compactContentDescription)
    }

    @Test
    fun compactProjectsNameBadgeAndAccessibleName() {
        val display = project(listOf(entry(command = "lock", status = "success")), CommandHistorySize(cols = 1, rows = 2))
        assertTrue(display.isCompact)
        assertEquals("Lock", display.compactCommandName)
        assertEquals(CommandBadgeTone.Success, display.compactBadgeTone)
        assertEquals("Success", display.compactBadgeLabel)
        assertEquals("Lock, Success", display.compactContentDescription)
    }

    @Test
    fun isCompactFollowsColumnCount() {
        assertTrue(project(listOf(entry()), CommandHistorySize(cols = 1, rows = 4)).isCompact)
        assertFalse(project(listOf(entry()), CommandHistorySize(cols = 2, rows = 4)).isCompact)
    }

    // ---- registry metadata (web registry/commands.ts) -------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("command-history", CommandHistoryRegistration.ID)
        assertEquals("commands", CommandHistoryRegistration.CATEGORY)
        assertEquals("CommandHistoryWidget", CommandHistoryRegistration.SLUG)
        assertEquals(200, CommandHistoryRegistration.DEFAULT_LIMIT)
        assertEquals(CommandHistorySize(cols = 2, rows = 4), CommandHistoryRegistration.defaultSize)
        assertEquals(CommandHistorySize(cols = 1, rows = 2), CommandHistoryRegistration.minSize)
        assertEquals(CommandHistorySize(cols = 4, rows = 40), CommandHistoryRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(CommandHistoryRegistration.isWithinBounds(CommandHistorySize(cols = 2, rows = 4)))
        assertFalse(CommandHistoryRegistration.isWithinBounds(CommandHistorySize(cols = 0, rows = 1)))
        assertFalse(CommandHistoryRegistration.isWithinBounds(CommandHistorySize(cols = 5, rows = 50)))
        assertEquals(
            CommandHistorySize(cols = 1, rows = 2),
            CommandHistoryRegistration.clamp(CommandHistorySize(cols = 0, rows = 0)),
        )
        assertEquals(
            CommandHistorySize(cols = 4, rows = 40),
            CommandHistoryRegistration.clamp(CommandHistorySize(cols = 9, rows = 99)),
        )
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

    private fun renderEventTime(time: CommandEventTime): String =
        when (time) {
            CommandEventTime.Unknown -> "\u2014"
            CommandEventTime.JustNow -> "just now"
            is CommandEventTime.MinutesAgo -> "${time.value}m ago"
            is CommandEventTime.HoursAgo -> "${time.value}h ago"
            is CommandEventTime.Absolute -> "abs:${time.epochMillis}"
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
