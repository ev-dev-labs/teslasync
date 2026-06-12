package io.teslasync.android.featureviews.legacyalertsredirect

import io.teslasync.android.navigation.Destinations
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LegacyAlertsRedirect surface's pure logic — the adapter test the prompt
 * requires (a raw location search → resolved redirect target) plus the per-branch and metadata pins. Mirrors the
 * web source (web/src/features/notifications/components/LegacyAlertsRedirect.tsx): the web `TAB_TO_ROUTE` mapping
 * (default `alerts`), the first-wins `tab` read + `delete('tab')` strip, the forwarding of every other param via
 * `URLSearchParams`, and the PII-safe `view.opened` diagnostic. Runs in the offline `:app:testReleaseUnitTest`
 * gate; the Compose render + accessibility are covered by the on-device LegacyAlertsRedirectUiTest.
 */
class LegacyAlertsRedirectResolverTest {
    // ── Tab → destination mapping (web TAB_TO_ROUTE, default alerts) ─────────────────

    @Test
    fun knownTabsMapToTheWebDestinations() {
        assertEquals(LegacyAlertsDestination.Alerts, LegacyAlertsRedirectResolver.destinationForTab("alerts"))
        assertEquals(LegacyAlertsDestination.Inbox, LegacyAlertsRedirectResolver.destinationForTab("history"))
        assertEquals(
            LegacyAlertsDestination.QuietHours,
            LegacyAlertsRedirectResolver.destinationForTab("preferences"),
        )
    }

    @Test
    fun absentEmptyOrUnknownTabFallsBackToAlerts() {
        assertEquals(LegacyAlertsDestination.Alerts, LegacyAlertsRedirectResolver.destinationForTab(null))
        assertEquals(LegacyAlertsDestination.Alerts, LegacyAlertsRedirectResolver.destinationForTab(""))
        assertEquals(LegacyAlertsDestination.Alerts, LegacyAlertsRedirectResolver.destinationForTab("history2"))
        assertEquals(LegacyAlertsDestination.Alerts, LegacyAlertsRedirectResolver.destinationForTab("PREFERENCES"))
    }

    // ── resolve(): destination selection ─────────────────────────────────────────────

    @Test
    fun missingSearchRedirectsToAlertsWithNoQuery() {
        listOf(null, "", "?").forEach { search ->
            val target = LegacyAlertsRedirectResolver.resolve(search)
            assertEquals(LegacyAlertsDestination.Alerts, target.destination)
            assertTrue(target.forwardedQuery.isEmpty())
            assertEquals("/notifications/alerts", target.webTo)
        }
    }

    @Test
    fun historyTabRedirectsToInbox() {
        val target = LegacyAlertsRedirectResolver.resolve("?tab=history")
        assertEquals(LegacyAlertsDestination.Inbox, target.destination)
        assertEquals("/notifications/inbox", target.webTo)
    }

    @Test
    fun preferencesTabRedirectsToQuietHours() {
        val target = LegacyAlertsRedirectResolver.resolve("?tab=preferences")
        assertEquals(LegacyAlertsDestination.QuietHours, target.destination)
        assertEquals("/notifications/quiet-hours", target.webTo)
    }

    @Test
    fun unknownTabRedirectsToAlerts() {
        val target = LegacyAlertsRedirectResolver.resolve("?tab=settings")
        assertEquals(LegacyAlertsDestination.Alerts, target.destination)
    }

    // ── resolve(): param forwarding (web delete('tab') + URLSearchParams.toString) ───

    @Test
    fun forwardsEveryParamExceptTabInOriginalOrder() {
        val target = LegacyAlertsRedirectResolver.resolve("?tab=history&filter=unread&q=bolt&page=2")

        assertEquals(LegacyAlertsDestination.Inbox, target.destination)
        assertEquals(
            listOf("filter" to "unread", "q" to "bolt", "page" to "2"),
            target.forwardedQuery,
        )
        assertEquals("/notifications/inbox?filter=unread&q=bolt&page=2", target.webTo)
    }

    @Test
    fun forwardsParamsWhenTabIsAbsentDefaultingToAlerts() {
        val target = LegacyAlertsRedirectResolver.resolve("?severity=critical&vehicle_id=5&rule_id=9")

        assertEquals(LegacyAlertsDestination.Alerts, target.destination)
        assertEquals("/notifications/alerts?severity=critical&vehicle_id=5&rule_id=9", target.webTo)
    }

    @Test
    fun stripsTabFromForwardedQuery() {
        val target = LegacyAlertsRedirectResolver.resolve("?tab=history&filter=unread")
        assertFalse(target.forwardedQuery.any { it.first == "tab" })
    }

    @Test
    fun duplicateTabUsesFirstAndStripsAllOccurrences() {
        val target = LegacyAlertsRedirectResolver.resolve("?tab=history&tab=preferences&x=1")

        assertEquals(LegacyAlertsDestination.Inbox, target.destination)
        assertEquals(listOf("x" to "1"), target.forwardedQuery)
    }

    @Test
    fun emptyTabValueFallsBackToAlertsAndForwardsTheRest() {
        val target = LegacyAlertsRedirectResolver.resolve("?tab=&x=1")

        assertEquals(LegacyAlertsDestination.Alerts, target.destination)
        assertEquals(listOf("x" to "1"), target.forwardedQuery)
    }

    // ── LegacyAlertsTarget projections ───────────────────────────────────────────────

    @Test
    fun webToOmitsQuestionMarkWhenNoParamsSurvive() {
        val target = LegacyAlertsTarget(LegacyAlertsDestination.Inbox, emptyList())
        assertEquals("/notifications/inbox", target.webTo)
        assertEquals("notifications/inbox", target.routeWithQuery)
    }

    @Test
    fun routeWithQueryCarriesTheForwardedParams() {
        val target = LegacyAlertsTarget(LegacyAlertsDestination.Alerts, listOf("filter" to "unread"))
        assertEquals("notifications/alerts?filter=unread", target.routeWithQuery)
        assertEquals("/notifications/alerts?filter=unread", target.webTo)
    }

    // ── URLSearchParams codec parity ─────────────────────────────────────────────────

    @Test
    fun parseDecodesPlusAndPercentEscapesAndSkipsEmptySegments() {
        assertEquals(listOf("q" to "a b"), LegacyAlertsQuery.parse("?q=a+b"))
        assertEquals(listOf("q" to "a b"), LegacyAlertsQuery.parse("?q=a%20b"))
        assertEquals(listOf("a" to "1", "b" to "2"), LegacyAlertsQuery.parse("a=1&&b=2"))
    }

    @Test
    fun parseTreatsABareKeyAsAnEmptyValue() {
        assertEquals(listOf("ready" to ""), LegacyAlertsQuery.parse("?ready"))
        assertEquals("ready=", LegacyAlertsQuery.serialize(listOf("ready" to "")))
    }

    @Test
    fun serializeReEncodesSpacesAsPlus() {
        assertEquals("q=a+b", LegacyAlertsQuery.serialize(listOf("q" to "a b")))
    }

    @Test
    fun malformedPercentEscapeIsToleratedNotThrown() {
        // A hand-crafted deep link with a bad escape must never crash the redirect.
        assertEquals(listOf("x" to "%zz"), LegacyAlertsQuery.parse("?x=%zz"))
        assertEquals(LegacyAlertsDestination.Inbox, LegacyAlertsRedirectResolver.resolve("?tab=history&x=%zz").destination)
    }

    // ── Native route parity vs the canonical Destinations registry ───────────────────

    @Test
    fun destinationsMatchTheCanonicalNavigationRegistry() {
        assertEquals(Destinations.require("notificationsAlerts").route, LegacyAlertsDestination.Alerts.route)
        assertEquals(Destinations.require("notificationsInbox").route, LegacyAlertsDestination.Inbox.route)
        assertEquals(Destinations.require("notificationsQuietHours").route, LegacyAlertsDestination.QuietHours.route)

        assertEquals(Destinations.require("notificationsAlerts").webPath, LegacyAlertsDestination.Alerts.webPath)
        assertEquals(Destinations.require("notificationsInbox").webPath, LegacyAlertsDestination.Inbox.webPath)
        assertEquals(
            Destinations.require("notificationsQuietHours").webPath,
            LegacyAlertsDestination.QuietHours.webPath,
        )
    }

    // ── Diagnostics: PII-safe view.opened ────────────────────────────────────────────

    @Test
    fun diagnosticsSlugAndIdAreStable() {
        assertEquals("LegacyAlertsRedirect", LegacyAlertsRedirectDiagnostics.SLUG)
        assertEquals("legacy-alerts-redirect", LegacyAlertsRedirectDiagnostics.ID)
    }

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlugOnly() {
        val logger = RecordingLogger()

        LegacyAlertsRedirectDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "LegacyAlertsRedirect"), fields)
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
