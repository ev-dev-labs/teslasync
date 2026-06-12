package io.teslasync.android.featureviews.legacynotificationsredirect

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LegacyNotificationsRedirect surface's pure logic — a 1:1 check against the web
 * component body (web/src/features/notifications/components/LegacyNotificationsRedirect.tsx): the `TAB_TO_ROUTE`
 * map, the `params.get('tab') ?? 'inbox'` + `TAB_TO_ROUTE[tab] ?? inbox` double default, the
 * `params.delete('tab')` drop, the `params.toString()` param forwarding, and the `to = qs ? ... : target`
 * assembly. Also covers the PII-safe `view.opened` diagnostic. Runs in the offline `:app:testReleaseUnitTest`
 * gate; the Compose render + accessibility are covered by the on-device LegacyNotificationsRedirectUiTest.
 */
class LegacyNotificationsRedirectProjectionTest {
    // ── Tab catalogue: slugs + routes match the web TAB_TO_ROUTE / canonical Destinations ────────────

    @Test
    fun eachTabCarriesItsWebSlugAndRoute() {
        assertEquals("inbox", LegacyNotificationsTab.Inbox.slug)
        assertEquals("archived", LegacyNotificationsTab.Archived.slug)
        assertEquals("channels", LegacyNotificationsTab.Channels.slug)

        // Web target paths with the leading slash removed — the canonical Navigation-Compose routes.
        assertEquals("notifications/inbox", LegacyNotificationsTab.Inbox.route)
        assertEquals("notifications/archived", LegacyNotificationsTab.Archived.route)
        assertEquals("notifications/channels", LegacyNotificationsTab.Channels.route)
    }

    @Test
    fun routesAreNonBlankAndSlashFreeAtTheEdges() {
        LegacyNotificationsTab.entries.forEach { tab ->
            assertTrue("route must be non-blank", tab.route.isNotBlank())
            assertTrue("route must not carry a leading slash", !tab.route.startsWith("/"))
            assertTrue("route must not carry a trailing slash", !tab.route.endsWith("/"))
        }
    }

    @Test
    fun fromSlugMapsKnownValuesAndDefaultsToInbox() {
        assertEquals(LegacyNotificationsTab.Inbox, LegacyNotificationsTab.fromSlug("inbox"))
        assertEquals(LegacyNotificationsTab.Archived, LegacyNotificationsTab.fromSlug("archived"))
        assertEquals(LegacyNotificationsTab.Channels, LegacyNotificationsTab.fromSlug("channels"))
        // web `params.get('tab') ?? 'inbox'` (absent) and `TAB_TO_ROUTE[tab] ?? inbox` (unknown).
        assertEquals(LegacyNotificationsTab.Inbox, LegacyNotificationsTab.fromSlug(null))
        assertEquals(LegacyNotificationsTab.Inbox, LegacyNotificationsTab.fromSlug(""))
        assertEquals(LegacyNotificationsTab.Inbox, LegacyNotificationsTab.fromSlug("settings"))
        assertEquals(LegacyNotificationsTab.Inbox, LegacyNotificationsTab.Default)
    }

    // ── resolve(): the web redirect map (/notifications[?tab=…] → /notifications/{inbox|archived|channels}) ──

    @Test
    fun bareLocationRedirectsToInboxWithNoForwardedQuery() {
        listOf(null, "", "?").forEach { search ->
            val target = LegacyNotificationsRedirectProjection.resolve(search)
            assertEquals("search=$search", LegacyNotificationsTab.Inbox, target.tab)
            assertEquals("", target.forwardedQuery)
            assertEquals("notifications/inbox", target.routeWithQuery)
        }
    }

    @Test
    fun explicitTabSelectsItsRoute() {
        assertEquals(LegacyNotificationsTab.Inbox, LegacyNotificationsRedirectProjection.resolve("tab=inbox").tab)
        assertEquals(LegacyNotificationsTab.Archived, LegacyNotificationsRedirectProjection.resolve("tab=archived").tab)
        assertEquals(LegacyNotificationsTab.Channels, LegacyNotificationsRedirectProjection.resolve("tab=channels").tab)
    }

    @Test
    fun leadingQuestionMarkIsOptional() {
        assertEquals(
            LegacyNotificationsRedirectProjection.resolve("tab=archived"),
            LegacyNotificationsRedirectProjection.resolve("?tab=archived"),
        )
    }

    @Test
    fun unknownTabFallsBackToInboxAndIsNotForwarded() {
        // web: TAB_TO_ROUTE['nope'] ?? inbox, and params.delete('tab') drops the 'tab' pair regardless.
        val target = LegacyNotificationsRedirectProjection.resolve("tab=nope&keep=1")
        assertEquals(LegacyNotificationsTab.Inbox, target.tab)
        assertEquals("keep=1", target.forwardedQuery)
        assertEquals("notifications/inbox?keep=1", target.routeWithQuery)
    }

    @Test
    fun emptyTabValueFallsBackToInbox() {
        val target = LegacyNotificationsRedirectProjection.resolve("tab=&keep=1")
        assertEquals(LegacyNotificationsTab.Inbox, target.tab)
        assertEquals("keep=1", target.forwardedQuery)
    }

    @Test
    fun remainingParamsAreForwardedPreservingOrder() {
        // web `params.delete('tab'); params.toString()` keeps the surviving params in their original order.
        val target = LegacyNotificationsRedirectProjection.resolve("severity=critical&tab=archived&rule=42")
        assertEquals(LegacyNotificationsTab.Archived, target.tab)
        assertEquals("severity=critical&rule=42", target.forwardedQuery)
        assertEquals("notifications/archived?severity=critical&rule=42", target.routeWithQuery)
    }

    @Test
    fun paramsWithoutTabRedirectToInboxAndForwardEverything() {
        val target = LegacyNotificationsRedirectProjection.resolve("?vehicle_id=3&search=alert")
        assertEquals(LegacyNotificationsTab.Inbox, target.tab)
        assertEquals("vehicle_id=3&search=alert", target.forwardedQuery)
    }

    @Test
    fun firstTabValueWinsAndEveryTabPairIsDropped() {
        // web URLSearchParams.get returns the first 'tab'; delete removes every 'tab' occurrence.
        val target = LegacyNotificationsRedirectProjection.resolve("tab=channels&keep=1&tab=archived")
        assertEquals(LegacyNotificationsTab.Channels, target.tab)
        assertEquals("keep=1", target.forwardedQuery)
    }

    @Test
    fun forwardedParamsRoundTripFormUrlEncoding() {
        // Spaces serialise as '+', reserved characters percent-encode — matching URLSearchParams.toString().
        val target = LegacyNotificationsRedirectProjection.resolve("tab=inbox&search=low%20battery&from=a%26b")
        assertEquals(LegacyNotificationsTab.Inbox, target.tab)
        assertEquals("search=low+battery&from=a%26b", target.forwardedQuery)
    }

    @Test
    fun emptySegmentsAreSkipped() {
        val target = LegacyNotificationsRedirectProjection.resolve("tab=archived&&keep=1")
        assertEquals("keep=1", target.forwardedQuery)
    }

    // ── routeWithQuery: web `to = qs ? `${target}?${qs}` : target` ────────────────────────────────────

    @Test
    fun routeWithQueryOmitsTheQuestionMarkWhenNoParamsRemain() {
        val target = LegacyNotificationsRedirectTarget(LegacyNotificationsTab.Channels, forwardedQuery = "")
        assertEquals("notifications/channels", target.routeWithQuery)
        assertEquals("notifications/channels", target.route)
    }

    @Test
    fun routeWithQueryAppendsTheForwardedParams() {
        val target = LegacyNotificationsRedirectTarget(LegacyNotificationsTab.Archived, forwardedQuery = "keep=1")
        assertEquals("notifications/archived?keep=1", target.routeWithQuery)
    }

    // ── Diagnostics: PII-safe view.opened tagged with the resolved tab ────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceAndTab() {
        val logger = RecordingLogger()

        LegacyNotificationsRedirectDiagnostics.recordViewOpened(logger, LegacyNotificationsTab.Archived)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "LegacyNotificationsRedirect", "tab" to "archived"), fields)
    }

    @Test
    fun diagnosticsSlugAndIdAreStable() {
        assertEquals("LegacyNotificationsRedirect", LegacyNotificationsRedirectDiagnostics.SLUG)
        assertEquals("legacy-notifications-redirect", LegacyNotificationsRedirectDiagnostics.ID)
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
