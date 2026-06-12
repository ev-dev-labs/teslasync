// Off-device unit coverage for the StatusPageSkeleton feature view's pure model (P3 acceptance:
// adapter + per-state + a11y label tests). The web source is a purely presentational loading scaffold
// with no data and no i18n, so the "adapter" under test is the projection of its JSX into the
// [STATUS_PAGE_SKELETON_SPEC] bar geometry; "per-state" is the single, unconditional render state the
// surface exposes (asserted stable here); and the a11y label is the loading announcement resolved
// through the i18n facade. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.statuspageskeleton

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class StatusPageSkeletonModelTest {
    private val spec = StatusPageSkeletonProjection.webParity

    @Test
    fun registrationIdentifiersMatchSurfaceSlug() {
        assertEquals("status-page-skeleton", StatusPageSkeletonRegistration.ID)
        assertEquals("StatusPageSkeleton", StatusPageSkeletonRegistration.SLUG)
    }

    @Test
    fun webParityIsTheExportedSpec() {
        assertEquals(STATUS_PAGE_SKELETON_SPEC, spec)
    }

    @Test
    fun maxContentWidthMatchesWebMaxW3xl() {
        // Tailwind `max-w-3xl` = 48rem = 768 px, converted 1:1 to dp.
        assertEquals(768, MAX_CONTENT_WIDTH_DP)
    }

    @Test
    fun heroProjectsRoundedAvatarTitleSubtitleAndAction() {
        assertEquals(SkeletonBar(heightDp = 56, widthDp = 56, rounded = true), spec.hero.avatar)
        assertEquals(SkeletonBar(heightDp = 24, widthFraction = 0.6f), spec.hero.title)
        assertEquals(SkeletonBar(heightDp = 14, widthFraction = 0.4f), spec.hero.subtitle)
        assertEquals(SkeletonBar(heightDp = 36, widthDp = 120), spec.hero.action)
    }

    @Test
    fun chipBarProjectsEightRoundedPills() {
        assertEquals(8, spec.chips.count)
        assertEquals(SkeletonBar(heightDp = 32, widthDp = 92, rounded = true), spec.chips.chip)
    }

    @Test
    fun healthPanelProjectsSixFullWidthRowsWithCollapsedHeaderGap() {
        assertEquals(SkeletonBar(heightDp = 18, widthDp = 80), spec.health.header)
        // The web `space-y-1` (4 dp) collapses with the header's `mb-2` (8 dp) to an 8 dp header gap,
        // while rows keep the 4 dp inter-row gap.
        assertEquals(SkeletonGap.Sm, spec.health.headerGap)
        assertEquals(SkeletonGap.Xs, spec.health.rowGap)
        assertEquals(SkeletonGap.Md, spec.health.padding)
        assertEquals(6, spec.health.rowCount)
        assertEquals(SkeletonBar(heightDp = 44), spec.health.row)
    }

    @Test
    fun actionItemsPanelProjectsTwoRowsWithUniformSpacing() {
        assertEquals(SkeletonBar(heightDp = 18, widthDp = 180), spec.actionItems.header)
        assertEquals(SkeletonGap.Sm, spec.actionItems.headerGap)
        assertEquals(SkeletonGap.Sm, spec.actionItems.rowGap)
        assertEquals(SkeletonGap.Lg, spec.actionItems.padding)
        assertEquals(2, spec.actionItems.rowCount)
        assertEquals(SkeletonBar(heightDp = 32), spec.actionItems.row)
    }

    @Test
    fun resourcesPanelProjectsFiveRowsWithUniformSpacing() {
        assertEquals(SkeletonBar(heightDp = 18, widthDp = 120), spec.resources.header)
        assertEquals(SkeletonGap.Md, spec.resources.headerGap)
        assertEquals(SkeletonGap.Md, spec.resources.rowGap)
        assertEquals(SkeletonGap.Lg, spec.resources.padding)
        assertEquals(5, spec.resources.rowCount)
        assertEquals(SkeletonBar(heightDp = 28), spec.resources.row)
    }

    @Test
    fun accordionProjectsFourIdenticalRows() {
        assertEquals(4, spec.accordionCount)
        assertEquals(SkeletonBar(heightDp = 20, widthDp = 20), spec.accordion.icon)
        assertEquals(SkeletonBar(heightDp = 16, widthFraction = 0.4f), spec.accordion.title)
        assertEquals(SkeletonBar(heightDp = 12, widthFraction = 0.6f), spec.accordion.subtitle)
        assertEquals(SkeletonBar(heightDp = 24, widthDp = 60), spec.accordion.badge)
    }

    @Test
    fun listRowsAndBlockBarsFillParentWidth() {
        // The list rows carry no fixed width (web `w-full`), so the renderer fills the parent.
        assertNull(spec.health.row.widthDp)
        assertNull(spec.health.row.widthFraction)
        assertNull(spec.actionItems.row.widthDp)
        assertNull(spec.resources.row.widthDp)
    }

    @Test
    fun fractionalBarsCarryAFractionAndNoFixedWidth() {
        // The web percentage-width bars (`width="60%"`/`"40%"`) project to a fraction, never a fixed dp.
        listOf(spec.hero.title, spec.hero.subtitle, spec.accordion.title, spec.accordion.subtitle)
            .forEach { bar ->
                assertNull(bar.widthDp)
                assertTrue((bar.widthFraction ?: 0f) in 0f..1f)
            }
    }

    @Test
    fun renderStateIsSingleAndUnconditional() {
        // The surface has no data sources, so there is exactly one render state: every read of the
        // projection yields the same, stable composition (no loading/empty/error/stale/offline branch).
        assertSame(spec, StatusPageSkeletonProjection.webParity)
        assertEquals(spec, StatusPageSkeletonProjection.webParity)
    }

    @Test
    fun everyBarHasAPositiveHeight() {
        val allBars =
            listOf(spec.hero.avatar, spec.hero.title, spec.hero.subtitle, spec.hero.action) +
                spec.chips.chip +
                listOf(spec.health.header, spec.health.row) +
                listOf(spec.actionItems.header, spec.actionItems.row) +
                listOf(spec.resources.header, spec.resources.row) +
                listOf(spec.accordion.icon, spec.accordion.title, spec.accordion.subtitle, spec.accordion.badge)
        assertTrue(allBars.all { it.heightDp > 0 })
    }

    @Test
    fun countsArePositive() {
        assertTrue(spec.chips.count > 0)
        assertTrue(spec.health.rowCount > 0)
        assertTrue(spec.actionItems.rowCount > 0)
        assertTrue(spec.resources.rowCount > 0)
        assertTrue(spec.accordionCount > 0)
    }

    @Test
    fun accessibilityLabelResolvesLoadingKeyThroughFacade() {
        assertEquals("a11y.loading", A11Y_LOADING_KEY)
        val resolved =
            StatusPageSkeletonProjection.accessibilityLabel { key ->
                if (key == A11Y_LOADING_KEY) "Loading" else "UNRESOLVED:$key"
            }
        assertEquals("Loading", resolved)
    }
}
