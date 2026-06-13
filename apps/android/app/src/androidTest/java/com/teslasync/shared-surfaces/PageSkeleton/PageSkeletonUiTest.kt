// On-device Compose UI + accessibility verification of the PageSkeleton surface across every shaped region
// the web component renders (`PageHeaderSkeleton`, `StatGridSkeleton`, `ChartBlockSkeleton`, `TableSkeleton`)
// plus the composite full-page scaffold. Asserts each region's test tag (the web `data-testid`), the
// localized "Loading" TalkBack status label on every region (the a11y-label coverage), and that the
// reduced-motion preference is honored end to end through the surface's default `rememberReducedMotion()`
// seam. Rendered with reduced motion so the shimmer is a static fill and the test reaches idle. Runs under
// connectedAndroidTest; the testReleaseUnitTest gate covers the projection + diagnostics, this covers render.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pageskeleton

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

class PageSkeletonUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setBlock(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) { content() }
        }
    }

    @Test
    fun headerRendersWithLoadingStatusRegion() {
        setBlock { PageHeaderSkeleton(loadingLabel = LOADING, reduceMotion = true) }
        compose.onNodeWithTag(PageSkeletonRegion.Header.testTag).assertIsDisplayed()
        compose.onNodeWithContentDescription(LOADING).assertIsDisplayed()
    }

    @Test
    fun statGridRendersWithLoadingStatusRegion() {
        setBlock { StatGridSkeleton(cards = 6, loadingLabel = LOADING, reduceMotion = true) }
        compose.onNodeWithTag(PageSkeletonRegion.StatGrid.testTag).assertIsDisplayed()
        compose.onNodeWithContentDescription(LOADING).assertIsDisplayed()
    }

    @Test
    fun chartBlockRendersWithLoadingStatusRegion() {
        setBlock { ChartBlockSkeleton(heightDp = 200, loadingLabel = LOADING, reduceMotion = true) }
        compose.onNodeWithTag(PageSkeletonRegion.Chart.testTag).assertIsDisplayed()
        compose.onNodeWithContentDescription(LOADING).assertIsDisplayed()
    }

    @Test
    fun tableRendersWithLoadingStatusRegion() {
        setBlock { TableSkeleton(rows = 3, cols = 4, loadingLabel = LOADING, reduceMotion = true) }
        compose.onNodeWithTag(PageSkeletonRegion.Table.testTag).assertIsDisplayed()
        compose.onNodeWithContentDescription(LOADING).assertIsDisplayed()
    }

    @Test
    fun fullPageRendersEveryRegionWithItsStatusLabel() {
        setBlock { PageSkeletonContent(loadingLabel = LOADING, reduceMotion = true) }
        // Every region carries the localized status label; counting them proves all four are in the tree
        // (the lower regions can fall below the fold since the scaffold does not scroll). The top region is
        // laid out and visible.
        compose.onAllNodesWithContentDescription(LOADING).assertCountEquals(PageSkeletonRegion.entries.size)
        compose.onNodeWithTag(PageSkeletonRegion.Header.testTag).assertIsDisplayed()
    }

    @Test
    fun reducedMotionPreferenceIsHonoredThroughTheSeam() {
        // Forcing the platform reduced-motion override: the block resolves it through its default
        // rememberReducedMotion() and still renders its accessible status region (no infinite shimmer).
        setBlock {
            CompositionLocalProvider(LocalReducedMotion provides true) {
                ChartBlockSkeleton(loadingLabel = LOADING)
            }
        }
        compose.onNodeWithTag(PageSkeletonRegion.Chart.testTag).assertIsDisplayed()
        compose.onNodeWithContentDescription(LOADING).assertIsDisplayed()
    }

    private companion object {
        // Sample status label (the catalog `a11y.loading` value); production resolves it via stringResource.
        const val LOADING = "Loading"
    }
}
