// Off-device accessibility verification of the StickyCompactHero surface — the label set the composable attaches
// to its interactive nodes (the region landmark, the tappable status summary's spoken status headline, and the
// refresh control). The pure label contract is asserted here without a Compose host; the on-device UI test
// additionally asserts the labels are attached to the live nodes. Runs in the :android:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickycompacthero

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StickyCompactHeroA11yTest {
    private fun strings(): StickyCompactHeroStrings =
        StickyCompactHeroStrings(
            regionLabel = "Status",
            healthy = "Healthy",
            degraded = "Degraded",
            unhealthy = "Unhealthy",
            unknown = "Unknown",
            maintenance = "Maintenance",
            refresh = "Refresh",
            loading = "Loading",
            stale = "Stale",
            offline = "You're offline",
            retry = "Retry",
            errorMessage = "Failed to load data",
        )

    @Test
    fun everyInteractiveAndLandmarkLabelIsPresent() {
        val labels = strings()
        assertTrue(labels.hasAccessibilityLabels)
        assertTrue("region landmark is named", labels.regionLabel.isNotBlank())
        assertTrue("refresh control is named", labels.refresh.isNotBlank())
    }

    @Test
    fun everyStatusHasASpokenSummaryHeadline() {
        val labels = strings()
        HeroStatus.entries.forEach { status ->
            assertTrue("status $status has a non-blank spoken headline", labels.headline(status).isNotBlank())
        }
    }

    @Test
    fun aBlankLandmarkOrControlFailsTheAccessibilityContract() {
        assertFalse("a blank region landmark is rejected", strings().copy(regionLabel = "").hasAccessibilityLabels)
        assertFalse("a blank refresh control is rejected", strings().copy(refresh = "").hasAccessibilityLabels)
        assertFalse("a blank status headline is rejected", strings().copy(maintenance = "").hasAccessibilityLabels)
    }
}
