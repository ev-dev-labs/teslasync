package io.teslasync.android.featureviews.sliderenderer

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SlideRenderer pure dispatch — the native port of the web component's
 * `renderSlideContent()` switch (web/src/features/analytics/components/review/SlideRenderer.tsx) and its
 * slide deck (web/src/features/analytics/components/review/slides.ts): the `type` → [SlideKind] mapping,
 * the slide-deck order + gradient stops, the drive-highlight branch (field selection, drive decode, label,
 * emoji), the `data` threading, and the empty-data gate. Runs in the :app:testReleaseUnitTest gate; no
 * Compose, no device.
 */
class SlideRendererProjectionTest {
    private val strings = SlideRendererStrings(longestDrive = "Longest Drive", mostEfficient = "Most Efficient Drive")

    private val data: JsonObject =
        buildJsonObject {
            put("year", 2026)
            put(
                "longest_drive",
                buildJsonObject {
                    put("drive_id", 7)
                    put("date", "2026-04-04")
                    put("distance_km", 412.5)
                    put("duration_min", 287)
                    put("start_address", "San Jose, CA")
                    put("end_address", "Los Angeles, CA")
                    put("efficiency_wh_km", 165.0)
                },
            )
            put(
                "most_efficient_drive",
                buildJsonObject {
                    put("drive_id", 9)
                    put("date", "2026-06-01")
                    put("distance_km", 88.0)
                    put("duration_min", 75)
                    put("start_address", "Palo Alto, CA")
                    put("end_address", "Santa Cruz, CA")
                    put("efficiency_wh_km", 121.0)
                },
            )
        }

    private fun def(
        type: String,
        field: String? = null,
    ): SlideDefinition = SlideDefinition(type = type, background = SLIDE_DEFS[0].background, field = field)

    // ── slideKindOf: the web `switch (slide.type)` arms + the default fall-through ──────────────────────

    @Test
    fun slideKindOfMapsEveryKnownTypeAndFoldsUnknownToUnknown() {
        assertEquals(SlideKind.Title, slideKindOf("title"))
        assertEquals(SlideKind.StatHero, slideKindOf("stat-hero"))
        assertEquals(SlideKind.StatChart, slideKindOf("stat-chart"))
        assertEquals(SlideKind.DriveHighlight, slideKindOf("drive-highlight"))
        assertEquals(SlideKind.ChargingBreakdown, slideKindOf("charging-breakdown"))
        assertEquals(SlideKind.Savings, slideKindOf("savings"))
        assertEquals(SlideKind.Environment, slideKindOf("environment"))
        assertEquals(SlideKind.Patterns, slideKindOf("patterns"))
        assertEquals(SlideKind.Comparisons, slideKindOf("comparisons"))
        assertEquals(SlideKind.Summary, slideKindOf("summary"))
        assertEquals(SlideKind.Unknown, slideKindOf("totally-unknown"))
        assertEquals(SlideKind.Unknown, slideKindOf(""))
    }

    // ── driveHighlightFieldOf: web `slide.field === 'longest' ? longest : efficient` ────────────────────

    @Test
    fun driveHighlightFieldSelectsLongestOnlyForExactMatch() {
        assertEquals(DriveHighlightField.Longest, driveHighlightFieldOf("longest"))
        assertEquals(DriveHighlightField.Efficient, driveHighlightFieldOf("efficient"))
        assertEquals(DriveHighlightField.Efficient, driveHighlightFieldOf(null))
        assertEquals(DriveHighlightField.Efficient, driveHighlightFieldOf("Longest"))
        assertEquals(DriveHighlightField.Efficient, driveHighlightFieldOf(""))
    }

    // ── SLIDE_DEFS: the web slide deck (order, fields, gradients) ────────────────────────────────────────

    @Test
    fun slideDefsMatchWebDeckOrderAndFields() {
        assertEquals(12, SLIDE_DEFS.size)
        assertEquals(
            listOf(
                "title",
                "stat-hero",
                "stat-chart",
                "drive-highlight",
                "stat-hero",
                "charging-breakdown",
                "savings",
                "environment",
                "patterns",
                "drive-highlight",
                "comparisons",
                "summary",
            ),
            SLIDE_DEFS.map { it.type },
        )
        assertEquals(
            listOf(null, "distance", "drives", "longest", "energy", null, null, null, null, "efficient", null, null),
            SLIDE_DEFS.map { it.field },
        )
    }

    @Test
    fun slideDefsResolveTheExactTailwind900GradientStops() {
        assertEquals(SlideBackground(TW_BLUE_900, TW_INDIGO_900, TW_SLATE_900), SLIDE_DEFS[0].background)
        assertEquals(SlideBackground(TW_AMBER_900, TW_ORANGE_900, TW_YELLOW_900), SLIDE_DEFS[3].background)
        assertEquals(SlideBackground(TW_TEAL_900, TW_CYAN_900, TW_SKY_900), SLIDE_DEFS[9].background)
        assertEquals(SlideBackground(TW_BLUE_900, TW_INDIGO_900, TW_PURPLE_900), SLIDE_DEFS[11].background)
    }

    @Test
    fun buildSlidesReturnsTheStaticDeckRegardlessOfData() {
        assertSame(SLIDE_DEFS, buildSlides(null))
        assertSame(SLIDE_DEFS, buildSlides(data))
    }

    // ── parseDriveHighlight: web `YearReviewDriveHighlight | null` decode ────────────────────────────────

    @Test
    fun parseDriveHighlightDecodesEveryField() {
        val drive = parseDriveHighlight(data["longest_drive"])
        assertEquals(
            YearReviewDriveHighlight(
                driveId = 7,
                date = "2026-04-04",
                distanceKm = 412.5,
                durationMin = 287.0,
                startAddress = "San Jose, CA",
                endAddress = "Los Angeles, CA",
                efficiencyWhKm = 165.0,
            ),
            drive,
        )
    }

    @Test
    fun parseDriveHighlightReturnsNullForAbsentOrNonObjectValues() {
        assertNull(parseDriveHighlight(null))
        assertNull(parseDriveHighlight(JsonNull))
        assertNull(parseDriveHighlight(JsonArray(emptyList())))
        assertNull(parseDriveHighlight(JsonPrimitive("nope")))
    }

    @Test
    fun parseDriveHighlightDefaultsMissingFieldsToZeroAndEmpty() {
        val drive = parseDriveHighlight(buildJsonObject { put("date", "2026-01-01") })
        assertEquals(0L, drive?.driveId)
        assertEquals("2026-01-01", drive?.date)
        assertEquals(0.0, drive?.distanceKm)
        assertEquals("", drive?.startAddress)
        assertEquals("", drive?.endAddress)
    }

    // ── resolve: the full web renderSlideContent() dispatch ──────────────────────────────────────────────

    @Test
    fun resolveDispatchesEachPlainTypeAndThreadsData() {
        assertEquals(SlideContent.Title(data), SlideRendererProjection.resolve(def("title"), data, strings))
        assertEquals(SlideContent.StatChart(data), SlideRendererProjection.resolve(def("stat-chart"), data, strings))
        assertEquals(
            SlideContent.ChargingBreakdown(data),
            SlideRendererProjection.resolve(def("charging-breakdown"), data, strings),
        )
        assertEquals(SlideContent.Savings(data), SlideRendererProjection.resolve(def("savings"), data, strings))
        assertEquals(SlideContent.Environment(data), SlideRendererProjection.resolve(def("environment"), data, strings))
        assertEquals(SlideContent.Patterns(data), SlideRendererProjection.resolve(def("patterns"), data, strings))
        assertEquals(SlideContent.Comparisons(data), SlideRendererProjection.resolve(def("comparisons"), data, strings))
        assertEquals(SlideContent.Summary(data), SlideRendererProjection.resolve(def("summary"), data, strings))
    }

    @Test
    fun resolveUnknownTypeYieldsUnknownContent() {
        val content = SlideRendererProjection.resolve(def("mystery"), data, strings)
        assertEquals(SlideKind.Unknown, content.kind)
        assertTrue(content is SlideContent.Unknown)
        assertSame(data, content.data)
    }

    @Test
    fun resolveStatHeroUsesSlideFieldElseDefaultsToDistance() {
        val withField = SlideRendererProjection.resolve(def("stat-hero", field = "energy"), data, strings)
        assertEquals(SlideContent.StatHero(data, "energy"), withField)

        val withoutField = SlideRendererProjection.resolve(def("stat-hero"), data, strings)
        assertEquals(SlideContent.StatHero(data, DEFAULT_STAT_HERO_FIELD), withoutField)
        assertEquals("distance", (withoutField as SlideContent.StatHero).field)
    }

    @Test
    fun resolveLongestDriveHighlightSelectsLongestDriveLabelAndEmoji() {
        val content = SlideRendererProjection.resolve(def("drive-highlight", field = "longest"), data, strings)
        assertTrue(content is SlideContent.DriveHighlight)
        val highlight = content as SlideContent.DriveHighlight
        assertEquals(DriveHighlightField.Longest, highlight.field)
        assertEquals("Longest Drive", highlight.label)
        assertEquals(EMOJI_LONGEST_DRIVE, highlight.emoji)
        assertEquals(7L, highlight.drive?.driveId)
        assertEquals(412.5, highlight.drive?.distanceKm)
        assertSame(data, highlight.data)
    }

    @Test
    fun resolveEfficientDriveHighlightSelectsEfficientDriveLabelAndEmoji() {
        val content = SlideRendererProjection.resolve(def("drive-highlight", field = "efficient"), data, strings)
        val highlight = content as SlideContent.DriveHighlight
        assertEquals(DriveHighlightField.Efficient, highlight.field)
        assertEquals("Most Efficient Drive", highlight.label)
        assertEquals(EMOJI_MOST_EFFICIENT, highlight.emoji)
        assertEquals(9L, highlight.drive?.driveId)
        assertEquals(121.0, highlight.drive?.efficiencyWhKm)
    }

    @Test
    fun resolveDriveHighlightWithoutFieldFallsBackToEfficient() {
        val highlight =
            SlideRendererProjection.resolve(def("drive-highlight"), data, strings) as SlideContent.DriveHighlight
        assertEquals(DriveHighlightField.Efficient, highlight.field)
        assertEquals("Most Efficient Drive", highlight.label)
    }

    @Test
    fun resolveDriveHighlightWithNullDriveStillResolvesLabelAndEmoji() {
        val empty = buildJsonObject { put("year", 2026) }
        val highlight =
            SlideRendererProjection.resolve(def("drive-highlight", field = "longest"), empty, strings)
                as SlideContent.DriveHighlight
        assertNull(highlight.drive)
        assertEquals("Longest Drive", highlight.label)
        assertEquals(EMOJI_LONGEST_DRIVE, highlight.emoji)
    }

    @Test
    fun everyDeckSlideResolvesToContentCarryingTheSourceData() {
        SLIDE_DEFS.forEach { slide ->
            val content = SlideRendererProjection.resolve(slide, data, strings)
            assertSame("slide ${slide.type} must thread the source document", data, content.data)
            assertEquals(slideKindOf(slide.type), content.kind)
        }
    }

    // ── hasReviewData: the web `data ?` empty gate (loading/error are UiState flags) ─────────────────────

    @Test
    fun hasReviewDataIsTrueOnlyForPopulatedObjects() {
        assertTrue(hasReviewData(data))
        assertTrue(hasReviewData(buildJsonObject { put("year", 2026) }))
    }

    @Test
    fun hasReviewDataIsFalseForNullEmptyOrNonObject() {
        assertFalse(hasReviewData(null))
        assertFalse(hasReviewData(JsonNull))
        assertFalse(hasReviewData(JsonObject(emptyMap())))
        assertFalse(hasReviewData(JsonArray(emptyList())))
        assertFalse(hasReviewData(JsonPrimitive(3)))
    }
}
