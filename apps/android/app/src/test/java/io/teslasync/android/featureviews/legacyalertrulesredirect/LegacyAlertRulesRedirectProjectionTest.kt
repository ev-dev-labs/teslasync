package io.teslasync.android.featureviews.legacyalertrulesredirect

import io.teslasync.android.navigation.Destinations
import io.teslasync.android.navigation.RouteTable
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LegacyAlertRulesRedirect surface's pure logic — the native analogue of the
 * redirect the web component owns (web/src/features/notifications/components/LegacyAlertRulesRedirect.tsx):
 * the canonical target (web `to: '/notifications/rules'`), the preserved query string (web `${search}`), the
 * history-replace flag (web `replace`), and the PII-safe `view.opened` diagnostic. It also locks the port to
 * the canonical navigation graph by asserting the target agrees with [RouteTable] aliases + [Destinations].
 * Runs in the offline `:android:testReleaseUnitTest` gate; the Compose render + accessibility are covered by
 * the on-device LegacyAlertRulesRedirectUiTest.
 */
class LegacyAlertRulesRedirectProjectionTest {
    // ── Target identity: web `to` = '/notifications/rules' ───────────────────────────

    @Test
    fun resolveTargetsTheCanonicalNotificationRulesRoute() {
        val target = LegacyAlertRulesRedirectProjection.resolve(LegacyLocation.None)

        assertEquals("notificationsRules", target.destinationId)
        assertEquals("notifications/rules", target.route)
    }

    @Test
    fun resolveReplacesTheHistoryEntry() {
        // web `<Navigate replace />` — Back must skip the dead /alert-rules URL.
        assertTrue(LegacyAlertRulesRedirectProjection.resolve(LegacyLocation.None).replace)
    }

    // ── Query preservation: web `${search}` carried verbatim ─────────────────────────

    @Test
    fun resolvePreservesAPresentQueryStringVerbatim() {
        val target = LegacyAlertRulesRedirectProjection.resolve(LegacyLocation(search = "?tab=active&sort=name"))

        assertEquals("?tab=active&sort=name", target.search)
        assertEquals("notifications/rules?tab=active&sort=name", target.routeWithSearch)
        assertEquals("/notifications/rules?tab=active&sort=name", target.webTarget)
    }

    @Test
    fun resolveLeavesAnAbsentQueryStringEmpty() {
        val target = LegacyAlertRulesRedirectProjection.resolve(LegacyLocation.None)

        assertEquals("", target.search)
        assertEquals("notifications/rules", target.routeWithSearch)
        assertEquals("/notifications/rules", target.webTarget)
    }

    @Test
    fun normalizeSearchAddsAMissingLeadingQuestionMark() {
        assertEquals("?tab=active", LegacyAlertRulesRedirectProjection.normalizeSearch("tab=active"))
    }

    @Test
    fun normalizeSearchCollapsesBlankToEmpty() {
        assertEquals("", LegacyAlertRulesRedirectProjection.normalizeSearch(""))
        assertEquals("", LegacyAlertRulesRedirectProjection.normalizeSearch("   "))
    }

    @Test
    fun normalizeSearchKeepsAnExistingLeadingQuestionMark() {
        assertEquals("?a=1", LegacyAlertRulesRedirectProjection.normalizeSearch("  ?a=1  "))
    }

    // ── Canonical-graph lock: the port must agree with the native RouteTable + Destinations ──

    @Test
    fun legacyPathAliasesToTheSameTargetInTheCanonicalRouteTable() {
        assertEquals(
            LegacyAlertRulesRedirectProjection.CANONICAL_DESTINATION_ID,
            RouteTable.aliases.getValue(LegacyAlertRulesRedirectProjection.LEGACY_PATH),
        )
    }

    @Test
    fun canonicalRouteMatchesTheTargetDestinationRoute() {
        val destination = Destinations.require(LegacyAlertRulesRedirectProjection.CANONICAL_DESTINATION_ID)

        assertEquals(LegacyAlertRulesRedirectProjection.CANONICAL_ROUTE, destination.route)
        assertEquals("/notifications/rules", destination.webPath)
    }

    @Test
    fun routeTableResolvesTheLegacyPathToTheTargetDestination() {
        assertEquals(
            "/" + LegacyAlertRulesRedirectProjection.CANONICAL_ROUTE,
            RouteTable.canonicalPath(LegacyAlertRulesRedirectProjection.LEGACY_PATH),
        )
        assertEquals(
            LegacyAlertRulesRedirectProjection.CANONICAL_DESTINATION_ID,
            RouteTable.match(LegacyAlertRulesRedirectProjection.LEGACY_PATH)?.id,
        )
    }

    // ── Diagnostics: PII-safe view.opened ────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        LegacyAlertRulesRedirectDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "LegacyAlertRulesRedirect"), fields)
    }

    @Test
    fun diagnosticsCarriesNoQueryOrUserData() {
        val logger = RecordingLogger()

        LegacyAlertRulesRedirectDiagnostics.recordViewOpened(logger)

        val fields = logger.records.single().fields
        assertEquals(setOf("surface"), fields.keys)
        assertFalse(fields.values.any { it.contains("?") || it.contains("=") })
    }

    @Test
    fun diagnosticsSlugAndIdAreStable() {
        assertEquals("LegacyAlertRulesRedirect", LegacyAlertRulesRedirectDiagnostics.SLUG)
        assertEquals("legacy-alert-rules-redirect", LegacyAlertRulesRedirectDiagnostics.ID)
    }

    // ── Location model ───────────────────────────────────────────────────────────────

    @Test
    fun locationNoneHasNoQueryString() {
        assertEquals("", LegacyLocation.None.search)
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
