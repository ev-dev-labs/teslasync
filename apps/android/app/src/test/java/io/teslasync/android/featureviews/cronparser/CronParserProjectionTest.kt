package io.teslasync.android.featureviews.cronparser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDateTime
import java.util.Locale

/**
 * Off-device unit tests for the pure Cron Parser model + projection — the adapter test the prompt requires
 * (typed expression + localized strings → render-ready surface model). They pin the web-parity cron engine
 * (the describeCron phrasing, the getNextCronRuns scheduling, and matchField's exact parseInt/Number
 * semantics), the input-driven states (empty/invalid → no blocks; valid → description + runs), the i18n
 * fallback contract, the preset list, the timestamp format, and the folded catalog key names.
 */
class CronParserProjectionTest {
    private val fixedNow = LocalDateTime.of(2026, 4, 4, 10, 0, 0)
    private val identityFormat: (LocalDateTime) -> String = { it.toString() }

    private val strings =
        CronParserStrings(
            title = "Cron Parser",
            toolDescription = "Cron Parser Desc",
            expressionLabel = "Cron Expression",
            descriptionLabel = "Description",
            nextRunsLabel = "Next Runs",
            everyMinute = "Every Minute",
            everyHour = "Every Hour",
            everyDay = "Every Day",
            everyWeek = "Every Week",
            everyMonth = "Every Month",
        )

    // ---- registration ------------------------------------------------------------

    @Test
    fun registrationCarriesDiagnosticsSlugAndRunCount() {
        assertEquals("CronParser", CronParserRegistration.SLUG)
        assertEquals(5, CronParserRegistration.DEFAULT_RUN_COUNT)
    }

    // ---- i18n key folding + fallback (web t(key, default)) -----------------------

    @Test
    fun foldCatalogKeyMatchesGeneratedResourceNames() {
        // Verified against the real translation_Description resource; spaces fold to underscores.
        assertEquals("translation_Description", foldCatalogKey("Description"))
        assertEquals("translation_Cron_Parser", foldCatalogKey("Cron Parser"))
        assertEquals("translation_Cron_Parser_Desc", foldCatalogKey("Cron Parser Desc"))
        assertEquals("translation_Next_Runs", foldCatalogKey("Next Runs"))
        assertEquals("translation_Every_Minute", foldCatalogKey("Every Minute"))
    }

    @Test
    fun cronParserTextCarriesWebKeysAndResourceNames() {
        assertEquals("Cron Parser", CronParserText.Title.webKey)
        assertEquals("Cron Parser Desc", CronParserText.ToolDescription.webKey)
        assertEquals("translation_Description", CronParserText.DescriptionLabel.androidResourceName)
        assertEquals("translation_Next_Runs", CronParserText.NextRunsLabel.androidResourceName)
        assertEquals("translation_Every_Month", CronParserText.EveryMonth.androidResourceName)
    }

    @Test
    fun resolveOptionalPrefersCatalogValueThenFallsBack() {
        assertEquals("Localized", resolveOptional({ "Localized" }, "translation_Description", "Description"))
        assertEquals("Description", resolveOptional({ null }, "translation_Description", "Description"))
        assertEquals("Next Runs", resolveOptional({ "  " }, "translation_Next_Runs", "Next Runs"))
    }

    @Test
    fun buildStringsFallsBackToWebKeysWhenCatalogEmpty() {
        val built = buildCronParserStrings { null }
        assertEquals("Cron Parser", built.title)
        assertEquals("Cron Parser Desc", built.toolDescription)
        assertEquals("Cron Expression", built.expressionLabel)
        assertEquals("Description", built.descriptionLabel)
        assertEquals("Next Runs", built.nextRunsLabel)
        assertEquals("Every Minute", built.everyMinute)
        assertEquals("Every Month", built.everyMonth)
    }

    @Test
    fun buildStringsResolvesDescriptionLiveFromCatalog() {
        val catalog = mapOf("translation_Description" to "Localized Description")
        val built = buildCronParserStrings { catalog[it] }
        assertEquals("Localized Description", built.descriptionLabel)
        // Absent keys still fall back to the web natural-language text.
        assertEquals("Cron Parser", built.title)
    }

    // ---- presets -----------------------------------------------------------------

    @Test
    fun presetsAreFiveInWebOrderWithExpressions() {
        val presets = CronParserProjection.presets(strings)
        assertEquals(
            listOf("* * * * *", "0 * * * *", "0 0 * * *", "0 0 * * 0", "0 0 1 * *"),
            presets.map { it.expression },
        )
        assertEquals(
            listOf("Every Minute", "Every Hour", "Every Day", "Every Week", "Every Month"),
            presets.map { it.label },
        )
    }

    @Test
    fun presetLabelsTrackTheLocalizedStrings() {
        val localized = strings.copy(everyMinute = "Cada minuto")
        assertEquals("Cada minuto", localized.labelFor(CronPreset.EveryMinute))
        assertEquals("Every Month", localized.labelFor(CronPreset.EveryMonth))
    }

    // ---- field splitting ---------------------------------------------------------

    @Test
    fun fieldsSplitLikeTheWeb() {
        assertEquals(listOf(""), CronExpression.fields(""))
        assertEquals(listOf(""), CronExpression.fields("   "))
        assertEquals(listOf("*", "*", "*", "*", "*"), CronExpression.fields("* * * * *"))
        assertEquals(listOf("a", "b"), CronExpression.fields("  a   b  "))
        assertTrue(CronExpression.isValid("0 0 1 * *"))
        assertFalse(CronExpression.isValid("0 0 1 *"))
    }

    // ---- describe (web describeCron) ---------------------------------------------

    @Test
    fun describeRendersTimeClauses() {
        assertEquals("Every minute", CronExpression.describe(listOf("*", "*", "*", "*", "*")))
        assertEquals("At minute 5 of every hour", CronExpression.describe(listOf("5", "*", "*", "*", "*")))
        assertEquals("At 14:30", CronExpression.describe(listOf("30", "14", "*", "*", "*")))
        assertEquals("Every minute of hour 9", CronExpression.describe(listOf("*", "9", "*", "*", "*")))
    }

    @Test
    fun describeAppendsDayMonthAndWeekday() {
        assertEquals("At 00:00 on day 1", CronExpression.describe(listOf("0", "0", "1", "*", "*")))
        assertEquals("At 00:00 in month 6", CronExpression.describe(listOf("0", "0", "*", "6", "*")))
        assertEquals("At 00:00 on Sun", CronExpression.describe(listOf("0", "0", "*", "*", "0")))
        assertEquals("At 00:00 on Fri", CronExpression.describe(listOf("0", "0", "*", "*", "5")))
    }

    @Test
    fun describeHandlesOutOfRangeAndNonNumericWeekday() {
        // Web: days[idx] ?? dow — index 7 is undefined, so the raw field is shown.
        assertEquals("At 00:00 on 7", CronExpression.describe(listOf("0", "0", "*", "*", "7")))
        assertEquals("At 00:00 on MON", CronExpression.describe(listOf("0", "0", "*", "*", "MON")))
    }

    @Test
    fun describeGuardsNonFiveFieldInput() {
        assertEquals("Invalid cron expression", CronExpression.describe(listOf("0", "0", "*")))
    }

    // ---- matchField (web matchField) ---------------------------------------------

    @Test
    fun matchFieldWildcardAndExact() {
        assertTrue(CronExpression.matchField("*", 7))
        assertTrue(CronExpression.matchField("5", 5))
        assertFalse(CronExpression.matchField("5", 6))
        // parseInt leading-digit parse: "5x" -> 5.
        assertTrue(CronExpression.matchField("5x", 5))
        assertFalse(CronExpression.matchField("abc", 0))
    }

    @Test
    fun matchFieldStep() {
        assertTrue(CronExpression.matchField("*/15", 0))
        assertTrue(CronExpression.matchField("*/15", 30))
        assertFalse(CronExpression.matchField("*/15", 7))
        // A zero or empty step matches nothing (and never divides by zero).
        assertFalse(CronExpression.matchField("*/0", 0))
        assertFalse(CronExpression.matchField("5/", 5))
    }

    @Test
    fun matchFieldListAndRange() {
        assertTrue(CronExpression.matchField("1,2,3", 2))
        assertFalse(CronExpression.matchField("1,2,3", 4))
        assertTrue(CronExpression.matchField("10-20", 10))
        assertTrue(CronExpression.matchField("10-20", 20))
        assertFalse(CronExpression.matchField("10-20", 25))
        // A non-numeric range bound (Number -> NaN) matches nothing.
        assertFalse(CronExpression.matchField("1-x", 1))
    }

    // ---- JS number semantics -----------------------------------------------------

    @Test
    fun jsParseIntMirrorsLeadingDigitParse() {
        assertEquals(5, CronExpression.jsParseInt("5"))
        assertEquals(12, CronExpression.jsParseInt("  12abc"))
        assertEquals(-3, CronExpression.jsParseInt("-3"))
        assertEquals(4, CronExpression.jsParseInt("+4"))
        assertNull(CronExpression.jsParseInt(""))
        assertNull(CronExpression.jsParseInt("x"))
    }

    @Test
    fun jsNumberMirrorsStrictWholeStringParse() {
        assertEquals(0.0, CronExpression.jsNumber(""))
        assertEquals(0.0, CronExpression.jsNumber("   "))
        assertEquals(3.0, CronExpression.jsNumber("3"))
        assertEquals(5.0, CronExpression.jsNumber(" 5 "))
        assertNull(CronExpression.jsNumber("3a"))
    }

    // ---- nextRuns (web getNextCronRuns) ------------------------------------------

    @Test
    fun nextRunsEveryMinuteStartsAtNextWholeMinute() {
        val runs = CronExpression.nextRuns(listOf("*", "*", "*", "*", "*"), 5, fixedNow)
        assertEquals(5, runs.size)
        assertEquals(listOf(1, 2, 3, 4, 5), runs.map { it.minute })
        assertTrue(runs.all { it.hour == 10 && it.second == 0 })
    }

    @Test
    fun nextRunsHonoursTheCount() {
        val runs = CronExpression.nextRuns(listOf("*", "*", "*", "*", "*"), 3, fixedNow)
        assertEquals(3, runs.size)
    }

    @Test
    fun nextRunsTopOfHour() {
        val runs = CronExpression.nextRuns(listOf("0", "*", "*", "*", "*"), 5, LocalDateTime.of(2026, 4, 4, 10, 30))
        assertEquals(5, runs.size)
        assertTrue(runs.all { it.minute == 0 })
        assertEquals(listOf(11, 12, 13, 14, 15), runs.map { it.hour })
    }

    @Test
    fun nextRunsWeeklyAlwaysLandsOnSunday() {
        val runs = CronExpression.nextRuns(listOf("0", "0", "*", "*", "0"), 3, fixedNow)
        assertEquals(3, runs.size)
        assertTrue(runs.all { it.dayOfWeek == DayOfWeek.SUNDAY && it.hour == 0 && it.minute == 0 })
    }

    @Test
    fun nextRunsImpossibleDateHitsSafetyBoundAndReturnsEmpty() {
        // Feb 31 never occurs; the one-year safety bound stops the search with no matches (web parity).
        assertTrue(CronExpression.nextRuns(listOf("0", "0", "31", "2", "*"), 5, fixedNow).isEmpty())
    }

    @Test
    fun nextRunsRejectsNonFiveFieldInput() {
        assertTrue(CronExpression.nextRuns(listOf("0", "0", "*"), 5, fixedNow).isEmpty())
    }

    // ---- parse projection (web useMemo chain) ------------------------------------

    @Test
    fun parseEmptyInputYieldsNoDescriptionOrRuns() {
        val result = CronParserProjection.parse("", fixedNow, identityFormat)
        assertNull(result.description)
        assertTrue(result.nextRuns.isEmpty())
    }

    @Test
    fun parseInvalidInputYieldsNoDescriptionOrRuns() {
        val result = CronParserProjection.parse("* * *", fixedNow, identityFormat)
        assertNull(result.description)
        assertTrue(result.nextRuns.isEmpty())
    }

    @Test
    fun parseValidInputProducesDescriptionAndNumberedRuns() {
        val result = CronParserProjection.parse("* * * * *", fixedNow, identityFormat)
        assertEquals("Every minute", result.description)
        assertEquals(5, result.nextRuns.size)
        assertEquals(listOf(1, 2, 3, 4, 5), result.nextRuns.map { it.position })
        assertEquals(listOf("1", "2", "3", "4", "5"), result.nextRuns.map { it.badge })
        // The injected formatter is applied to each run timestamp.
        assertEquals(fixedNow.plusMinutes(1).toString(), result.nextRuns.first().time)
    }

    @Test
    fun parseAppliesTheRunCount() {
        val result = CronParserProjection.parse("* * * * *", fixedNow, identityFormat, count = 2)
        assertEquals(2, result.nextRuns.size)
    }

    // ---- time format (web formatDateTime) ----------------------------------------

    @Test
    fun timeFormatMatchesTheWebShape() {
        assertEquals(
            "Apr 4, 2026, 02:30 AM",
            CronTimeFormat.format(LocalDateTime.of(2026, 4, 4, 2, 30), Locale.US),
        )
        assertEquals(
            "Apr 4, 2026, 12:00 AM",
            CronTimeFormat.format(LocalDateTime.of(2026, 4, 4, 0, 0), Locale.US),
        )
        assertEquals(
            "Apr 4, 2026, 12:00 PM",
            CronTimeFormat.format(LocalDateTime.of(2026, 4, 4, 12, 0), Locale.US),
        )
    }
}
