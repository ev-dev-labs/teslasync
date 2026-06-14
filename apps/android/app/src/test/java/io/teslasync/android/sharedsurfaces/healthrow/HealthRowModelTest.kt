package io.teslasync.android.sharedsurfaces.healthrow

import io.teslasync.android.sharedsurfaces.statushero.HeroStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the HealthRow's pure logic — the native mirror of the web component's
 * `DOT_FOR_STATUS` / `TEXT_FOR_STATUS` colour tables and its `to ? (external ? a : Link) : (onClick ? button :
 * div)` render split (web/src/components/status/HealthRow.tsx). Every status tier maps to the right tone, and
 * every click-prop combination reduces to the expected interaction + accessibility role. Because the composable
 * is a thin render layer over [projectHealthRow] / [healthRowInteraction], the assertions here double as the
 * surface's per-state snapshot. Runs in the :android:testReleaseUnitTest gate.
 */
class HealthRowModelTest {
    // ── projectHealthRow: the web DOT_FOR_STATUS / TEXT_FOR_STATUS colour-family table ─────────────────────

    @Test
    fun projectHealthRowMapsHealthyToSuccess() {
        assertEquals(HealthRowProjection(HeroStatus.Healthy, HealthRowTone.Success), projectHealthRow(HeroStatus.Healthy))
    }

    @Test
    fun projectHealthRowMapsDegradedToWarning() {
        assertEquals(HealthRowProjection(HeroStatus.Degraded, HealthRowTone.Warning), projectHealthRow(HeroStatus.Degraded))
    }

    @Test
    fun projectHealthRowMapsUnhealthyToDanger() {
        assertEquals(HealthRowProjection(HeroStatus.Unhealthy, HealthRowTone.Danger), projectHealthRow(HeroStatus.Unhealthy))
    }

    @Test
    fun projectHealthRowMapsUnknownToNeutral() {
        // unknown is the not-yet-known / neutral tier — a muted zinc dot + summary, never a hidden row.
        assertEquals(HealthRowProjection(HeroStatus.Unknown, HealthRowTone.Neutral), projectHealthRow(HeroStatus.Unknown))
    }

    @Test
    fun projectHealthRowMapsMaintenanceToInfo() {
        assertEquals(HealthRowProjection(HeroStatus.Maintenance, HealthRowTone.Info), projectHealthRow(HeroStatus.Maintenance))
    }

    @Test
    fun everyStatusProjectsToItselfWithATone() {
        // The web union has exactly five members; the native enum must cover them all with a stable projection.
        assertEquals(5, HeroStatus.entries.size)
        HeroStatus.entries.forEach { status ->
            assertEquals(status, projectHealthRow(status).status)
        }
    }

    @Test
    fun distinctStatusesYieldDistinctTones() {
        // The web families green / amber / red / zinc / blue are all different — one tone per tier.
        val tones = HeroStatus.entries.map { projectHealthRow(it).tone }.toSet()
        assertEquals(HeroStatus.entries.size, tones.size)
    }

    // ── healthRowInteraction: the web to ? (external ? a : Link) : (onClick ? button : div) split ──────────

    @Test
    fun toWithExternalResolvesToOpenExternal() {
        assertEquals(
            HealthRowInteraction.OpenExternal("https://status.example.com"),
            healthRowInteraction(to = "https://status.example.com", external = true, hasOnClick = false),
        )
    }

    @Test
    fun toWithoutExternalResolvesToNavigate() {
        assertEquals(
            HealthRowInteraction.Navigate("/vehicles"),
            healthRowInteraction(to = "/vehicles", external = false, hasOnClick = false),
        )
    }

    @Test
    fun aPresentLinkTakesPrecedenceOverOnClick() {
        // Web: the `if (to)` branch wins, so onClick is ignored while a link target is present.
        assertEquals(
            HealthRowInteraction.Navigate("/drives"),
            healthRowInteraction(to = "/drives", external = false, hasOnClick = true),
        )
    }

    @Test
    fun onClickWithoutLinkResolvesToClickable() {
        assertEquals(
            HealthRowInteraction.Clickable,
            healthRowInteraction(to = null, external = false, hasOnClick = true),
        )
    }

    @Test
    fun neitherLinkNorOnClickResolvesToStatic() {
        assertEquals(
            HealthRowInteraction.Static,
            healthRowInteraction(to = null, external = false, hasOnClick = false),
        )
    }

    @Test
    fun blankOrWhitespaceLinkIsTreatedAsAbsent() {
        // An empty router target navigates nowhere, so it falls through to onClick / static — even with external.
        assertEquals(
            HealthRowInteraction.Clickable,
            healthRowInteraction(to = "   ", external = true, hasOnClick = true),
        )
        assertEquals(
            HealthRowInteraction.Static,
            healthRowInteraction(to = "", external = true, hasOnClick = false),
        )
    }

    // ── role + affordance: the web (to || onClick) chevron + interactive gate ──────────────────────────────

    @Test
    fun everyInteractiveBranchIsAnActionableButtonThatShowsTheChevron() {
        listOf(
            HealthRowInteraction.OpenExternal("https://x"),
            HealthRowInteraction.Navigate("/x"),
            HealthRowInteraction.Clickable,
        ).forEach { interaction ->
            assertEquals(HealthRowRole.Button, healthRowRole(interaction))
            assertTrue(healthRowShowsAffordance(interaction))
        }
    }

    @Test
    fun aStaticRowExposesNoRoleAndHidesTheChevron() {
        assertEquals(HealthRowRole.None, healthRowRole(HealthRowInteraction.Static))
        assertFalse(healthRowShowsAffordance(HealthRowInteraction.Static))
    }
}
