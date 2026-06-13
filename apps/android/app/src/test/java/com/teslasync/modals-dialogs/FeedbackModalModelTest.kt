// Off-device unit coverage for the FeedbackModal surface's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the per-field length validators (web zod `title` 5..120 / `body` 20..4000), the
// maxLength clamps (web `maxLength`), the console-tail cap (web `getConsoleTail()` slice), the `recent_errors`
// JSON-array assembly (snake_case `occurred_at`, `stack` dropped when null), the create-payload assembly (web
// `submit.mutateAsync({...})` — trimmed title/body, always-present page_route/user_agent/app_version, opt-in
// diagnostics, no user_email), the category wire vocabulary + reverse lookup, the registry identifiers, and the
// PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.feedbackmodal

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FeedbackModalModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    // ---- Title / body validation (web zod min/max) -------------------------------

    @Test
    fun isTitleValid_enforcesTrimmedFiveToOneTwenty() {
        assertFalse(FeedbackModalProjection.isTitleValid(""))
        assertFalse(FeedbackModalProjection.isTitleValid("abcd"))
        assertFalse(FeedbackModalProjection.isTitleValid("   abcd   "))
        assertTrue(FeedbackModalProjection.isTitleValid("abcde"))
        assertTrue(FeedbackModalProjection.isTitleValid("  Battery widget shows NaN  "))
        assertFalse(FeedbackModalProjection.isTitleValid("x".repeat(121)))
        assertTrue(FeedbackModalProjection.isTitleValid("x".repeat(120)))
    }

    @Test
    fun isBodyValid_enforcesTrimmedTwentyToFourThousand() {
        assertFalse(FeedbackModalProjection.isBodyValid("too short"))
        assertFalse(FeedbackModalProjection.isBodyValid("x".repeat(19)))
        assertTrue(FeedbackModalProjection.isBodyValid("x".repeat(20)))
        assertTrue(FeedbackModalProjection.isBodyValid("x".repeat(4000)))
        assertFalse(FeedbackModalProjection.isBodyValid("x".repeat(4001)))
    }

    @Test
    fun isValid_requiresBothFields() {
        assertFalse(FeedbackModalProjection.isValid(FeedbackDraft(title = "Valid title", body = "short")))
        assertFalse(FeedbackModalProjection.isValid(FeedbackDraft(title = "no", body = "x".repeat(20))))
        assertTrue(FeedbackModalProjection.isValid(FeedbackDraft(title = "Valid title", body = "x".repeat(20))))
    }

    // ---- maxLength clamps + console-tail cap (web `maxLength` / `CONSOLE_TAIL_MAX`) --

    @Test
    fun clampTitle_truncatesToOneHundredTwenty() {
        assertEquals(FeedbackModalProjection.MAX_TITLE_LENGTH, FeedbackModalProjection.clampTitle("z".repeat(200)).length)
        assertEquals("short", FeedbackModalProjection.clampTitle("short"))
    }

    @Test
    fun clampBody_truncatesToFourThousand() {
        assertEquals(FeedbackModalProjection.MAX_BODY_LENGTH, FeedbackModalProjection.clampBody("y".repeat(5000)).length)
        assertEquals("note", FeedbackModalProjection.clampBody("note"))
    }

    @Test
    fun clampConsoleTail_keepsMostRecentCharacters() {
        val tail = "abcdefghij".repeat(500) // 5000 chars
        val clamped = FeedbackModalProjection.clampConsoleTail(tail)
        assertEquals(FeedbackModalProjection.MAX_CONSOLE_TAIL, clamped.length)
        assertEquals(tail.takeLast(FeedbackModalProjection.MAX_CONSOLE_TAIL), clamped)
        assertEquals("brief tail", FeedbackModalProjection.clampConsoleTail("brief tail"))
    }

    // ---- recent_errors JSON assembly (web ring -> JSONB) -------------------------

    @Test
    fun recentErrorsJson_emitsSnakeCaseKeysAndOmitsAbsentStack() {
        val reports =
            listOf(
                FeedbackErrorReport(
                    name = "TypeError",
                    message = "boom",
                    route = "/drives",
                    occurredAt = "2026-01-01T00:00:00Z",
                    source = "window",
                ),
                FeedbackErrorReport(
                    name = "QueryError",
                    message = "fetch failed",
                    route = "/charging",
                    occurredAt = "2026-01-01T00:01:00Z",
                    source = "query",
                    stack = "at fetch (api.ts:10)",
                ),
            )
        val array = FeedbackModalProjection.recentErrorsJson(reports) as JsonArray
        assertEquals(2, array.size)

        val first = array[0].jsonObject
        assertEquals("TypeError", first["name"]?.jsonPrimitive?.content)
        assertEquals("boom", first["message"]?.jsonPrimitive?.content)
        assertEquals("/drives", first["route"]?.jsonPrimitive?.content)
        assertEquals("2026-01-01T00:00:00Z", first["occurred_at"]?.jsonPrimitive?.content)
        assertEquals("window", first["source"]?.jsonPrimitive?.content)
        assertNull(first["stack"])

        val second = array[1].jsonObject
        assertEquals("at fetch (api.ts:10)", second["stack"]?.jsonPrimitive?.content)
    }

    // ---- Create-payload assembly (web `submit.mutateAsync({...})`) ----------------

    @Test
    fun buildSubmitInput_trimsTextAlwaysCarriesContextAndAttachesOptIns() {
        val draft =
            FeedbackDraft(
                category = FeedbackCategory.Feature,
                title = "  Add cells page  ",
                body = "  Please add a per-cell battery view to the app.  ",
                includeRecentErrors = true,
                includeConsoleTail = true,
            )
        val context =
            FeedbackContext(
                pageRoute = "/battery",
                appVersion = "1.4.2",
                userAgent = "TeslaSync-Android/1.4.2 (Pixel 8; Android 14)",
                recentErrors = listOf(sampleReport()),
                consoleTail = "[info] hydrated",
            )
        val input = FeedbackModalProjection.buildSubmitInput(draft, context)

        assertEquals("feature", input.category)
        assertEquals("Add cells page", input.title)
        assertEquals("Please add a per-cell battery view to the app.", input.body)
        assertEquals("/battery", input.pageRoute)
        assertEquals("1.4.2", input.appVersion)
        assertEquals("TeslaSync-Android/1.4.2 (Pixel 8; Android 14)", input.userAgent)
        assertEquals("[info] hydrated", input.consoleTail)
        assertNull(input.userEmail)
        assertEquals(1, (input.recentErrors as JsonArray).size)
    }

    @Test
    fun buildSubmitInput_dropsDiagnosticsWhenTogglesOff() {
        val draft =
            FeedbackDraft(
                title = "Valid title",
                body = "x".repeat(20),
                includeRecentErrors = false,
                includeConsoleTail = false,
            )
        val context =
            FeedbackContext(
                recentErrors = listOf(sampleReport()),
                consoleTail = "[warn] noise",
            )
        val input = FeedbackModalProjection.buildSubmitInput(draft, context)

        assertNull(input.recentErrors)
        assertNull(input.consoleTail)
        // Context keys are still always carried, mirroring the web object literal (even when empty).
        assertEquals("", input.pageRoute)
        assertEquals("", input.appVersion)
        assertEquals("", input.userAgent)
        assertEquals("bug", input.category)
    }

    @Test
    fun buildSubmitInput_togglesOnButEmptyBuffersStayNull() {
        val draft =
            FeedbackDraft(
                title = "Valid title",
                body = "x".repeat(20),
                includeRecentErrors = true,
                includeConsoleTail = true,
            )
        val input = FeedbackModalProjection.buildSubmitInput(draft, FeedbackContext())

        assertNull(input.recentErrors)
        assertNull(input.consoleTail)
    }

    // ---- Category vocabulary + reverse lookup ------------------------------------

    @Test
    fun categoryWireTokensMatchTheWebUnion() {
        assertEquals("bug", FeedbackCategory.Bug.wire)
        assertEquals("feature", FeedbackCategory.Feature.wire)
        assertEquals("other", FeedbackCategory.Other.wire)
    }

    @Test
    fun fromWire_resolvesKnownTokensAndFallsBackOnUnknown() {
        assertEquals(FeedbackCategory.Feature, FeedbackCategory.fromWire("feature"))
        assertEquals(FeedbackCategory.Other, FeedbackCategory.fromWire("other"))
        assertEquals(FeedbackCategory.Bug, FeedbackCategory.fromWire("nonsense"))
    }

    // ---- Registry + diagnostics --------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("feedback-modal", FeedbackModalRegistration.ID)
        assertEquals("FeedbackModal", FeedbackModalRegistration.SLUG)
    }

    @Test
    fun recordFeedbackModalOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordFeedbackModalOpened(logger)
        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "FeedbackModal"), fields)
    }

    private companion object {
        fun sampleReport(): FeedbackErrorReport =
            FeedbackErrorReport(
                name = "TypeError",
                message = "boom",
                route = "/drives",
                occurredAt = "2026-01-01T00:00:00Z",
                source = "window",
            )
    }
}
