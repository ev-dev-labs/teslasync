package io.teslasync.android.featureviews.legacyalertstudioredirect

import io.teslasync.android.navigation.Destinations
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LegacyAlertStudioRedirect surface's pure logic — the native analogue of the
 * synchronous redirect the web component owns (web/src/features/notifications/components/
 * LegacyAlertStudioRedirect.tsx): the constant target (`/notifications/studio`), verbatim query-string
 * preservation (web `to={`/notifications/studio${search}`}`), the `replace` history semantics, parity with the
 * canonical navigation table, and the PII-safe `view.opened` diagnostic. Runs in the offline
 * `:app:testReleaseUnitTest` gate; the Compose render + accessibility are covered by the on-device UI test.
 */
class LegacyAlertStudioRedirectProjectionTest {
    // ── Target: empty search ─────────────────────────────────────────────────────────

    @Test
    fun targetForEmptySearchRedirectsToStudioWithNoQuery() {
        val target = LegacyAlertStudioRedirectProjection.target("")

        assertEquals("notifications/studio", target.route)
        assertEquals("", target.query)
        assertEquals("notifications/studio", target.routeWithQuery)
        assertEquals("/notifications/studio", target.webPath)
        assertEquals("notificationsStudio", target.destinationId)
    }

    // ── Target: query-string preservation (web `${search}`) ──────────────────────────

    @Test
    fun targetPreservesASingleQueryParamVerbatim() {
        val target = LegacyAlertStudioRedirectProjection.target("?rule=42")

        assertEquals("?rule=42", target.query)
        assertEquals("notifications/studio?rule=42", target.routeWithQuery)
        assertEquals("/notifications/studio?rule=42", target.webPath)
    }

    @Test
    fun targetAcceptsAQueryWithoutItsLeadingQuestionMark() {
        // The back-stack entry may expose the query without react-router's leading `?`; both forms resolve
        // to the identical canonical target.
        val withMark = LegacyAlertStudioRedirectProjection.target("?rule=42")
        val withoutMark = LegacyAlertStudioRedirectProjection.target("rule=42")

        assertEquals(withMark, withoutMark)
        assertEquals("?rule=42", withoutMark.query)
    }

    @Test
    fun targetPreservesMultipleParamsAndEncodingVerbatim() {
        // Mirrors the real legacy deep link `/alert-studio?signals=…&from=signal-diff`: order, encoding, and the
        // inner `&` separators are carried through untouched (web concatenates `search` verbatim).
        val target = LegacyAlertStudioRedirectProjection.target("?signals=a%2Cb&from=signal-diff")

        assertEquals("?signals=a%2Cb&from=signal-diff", target.query)
        assertEquals("notifications/studio?signals=a%2Cb&from=signal-diff", target.routeWithQuery)
        assertEquals("/notifications/studio?signals=a%2Cb&from=signal-diff", target.webPath)
    }

    // ── normalizeQuery: delimiter canonicalisation ───────────────────────────────────

    @Test
    fun normalizeQueryTreatsBlankAndBareDelimitersAsNoParams() {
        assertEquals("", LegacyAlertStudioRedirectProjection.normalizeQuery(""))
        assertEquals("", LegacyAlertStudioRedirectProjection.normalizeQuery("   "))
        assertEquals("", LegacyAlertStudioRedirectProjection.normalizeQuery("?"))
        assertEquals("", LegacyAlertStudioRedirectProjection.normalizeQuery("&"))
        assertEquals("", LegacyAlertStudioRedirectProjection.normalizeQuery("?&"))
    }

    @Test
    fun normalizeQueryStripsOnlyTheLeadingDelimiterNotInnerOnes() {
        assertEquals("?a=1&b=2", LegacyAlertStudioRedirectProjection.normalizeQuery("?a=1&b=2"))
        assertEquals("?a=1&b=2", LegacyAlertStudioRedirectProjection.normalizeQuery("a=1&b=2"))
        assertEquals("?a=1", LegacyAlertStudioRedirectProjection.normalizeQuery("&a=1"))
    }

    // ── replace semantics (web `replace`) ────────────────────────────────────────────

    @Test
    fun redirectAlwaysReplacesHistorySoTheLegacyUrlIsDropped() {
        assertTrue(LegacyAlertStudioRedirectProjection.target("").replace)
        assertTrue(LegacyAlertStudioRedirectProjection.target("?rule=42").replace)
        assertTrue(LegacyAlertStudioRedirectProjection.target("from=signal-diff").replace)
    }

    // ── Route shape ──────────────────────────────────────────────────────────────────

    @Test
    fun targetRouteHasNoLeadingSlashAndWebPathHasOne() {
        val target = LegacyAlertStudioRedirectProjection.target("?id=42")

        assertFalse("nav route must not carry a leading slash", target.route.startsWith("/"))
        assertTrue("web path must carry a leading slash", target.webPath.startsWith("/"))
    }

    // ── Parity with the canonical navigation table ───────────────────────────────────

    @Test
    fun targetMatchesTheCanonicalNotificationsStudioDestination() {
        val destination = Destinations.find(LegacyAlertStudioRedirectProjection.TARGET_DESTINATION_ID)

        assertNotNull("target destination must be a known route", destination)
        assertEquals(destination!!.route, LegacyAlertStudioRedirectProjection.TARGET_ROUTE)
        assertEquals(destination.webPath, LegacyAlertStudioRedirectProjection.TARGET_WEB_PATH)
    }

    // ── Diagnostics: PII-safe view.opened ────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        LegacyAlertStudioRedirectDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "LegacyAlertStudioRedirect"), fields)
    }

    @Test
    fun diagnosticsNeverCarriesTheQueryString() {
        // The query may hold user-meaningful values (a rule id, a signal list); the diagnostic must carry only
        // the surface slug so a line can never leak where the user is being routed.
        val logger = RecordingLogger()

        LegacyAlertStudioRedirectDiagnostics.recordViewOpened(logger)

        val record = logger.records.single()
        val emittedValues = record.fields.values
        assertEquals(setOf("LegacyAlertStudioRedirect"), emittedValues.toSet())
    }

    @Test
    fun diagnosticsSlugAndIdAreStable() {
        assertEquals("LegacyAlertStudioRedirect", LegacyAlertStudioRedirectDiagnostics.SLUG)
        assertEquals("legacy-alert-studio-redirect", LegacyAlertStudioRedirectDiagnostics.ID)
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
