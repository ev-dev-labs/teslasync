package io.teslasync.android.data

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.support.FakePageFeed
import io.teslasync.android.support.PageStateContractHost
import io.teslasync.android.support.PageStateTags
import io.teslasync.android.support.ParityPageLedger
import io.teslasync.android.support.expectedTagForState
import io.teslasync.android.support.resourceForState
import io.teslasync.android.support.staleResource
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Page-state contract smoke test for every generated A7 page (P3/A7). A7 pages attach their content
 * through the [io.teslasync.android.navigation.PageHosts] seam and all project a shared-core
 * `Resource` onto the [UiState] surface via [toUiState]; this test is data-driven over the real page
 * units of `apps/parity/parity-manifest.json` (packaged as an androidTest asset) and asserts that,
 * for each page id, every web-canonical data state it declares (loading / empty / success / error)
 * renders the matching surface — plus the universal offline/"last known" contract (stale banner over
 * still-visible cached data). It exercises the production projection through a fake shared state
 * holder, so it verifies the contract every page must satisfy without depending on per-page wiring
 * that A7 lands later. Runs on a device/emulator (connectedDebugAndroidTest).
 */
class PageStateContractTest {
    @get:Rule
    val rule = createComposeRule()

    // The androidTest (instrumentation) context owns the packaged parity-ledger asset.
    private val instrumentationContext get() = InstrumentationRegistry.getInstrumentation().context

    private fun assertTagPresent(
        tag: String,
        message: String,
    ) {
        rule.waitForIdle()
        assertTrue(message, rule.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun everyGeneratedPageRendersItsDeclaredStateContracts() {
        val pages = ParityPageLedger.load(instrumentationContext)
        assertTrue(
            "expected the full generated A7 page ledger (>=150 page units), loaded ${pages.size}",
            pages.size >= MIN_EXPECTED_PAGES,
        )
        assertTrue("every ledger unit must be a page", pages.all { it.id.startsWith("page:") })

        val feed = FakePageFeed()
        rule.setContent { TeslaSyncTheme { PageStateContractHost(feed) } }

        var declaredStatesAsserted = 0
        for (page in pages) {
            for (state in page.states) {
                feed.set(resourceForState(state))
                assertTagPresent(
                    expectedTagForState(state),
                    "page ${page.id} did not render the '$state' state contract",
                )
                declaredStatesAsserted++
            }

            // Universal cached/stale ("offline / last known") + data contract for every page.
            feed.set(staleResource())
            assertTagPresent(PageStateTags.STALE, "page ${page.id} did not render the stale/offline banner")
            assertTagPresent(PageStateTags.CONTENT, "page ${page.id} did not keep cached content while stale")
        }

        assertTrue(
            "expected to assert the declared loading/empty/success/error states across the ledger",
            declaredStatesAsserted >= MIN_EXPECTED_DECLARED_STATES,
        )
    }

    private companion object {
        const val MIN_EXPECTED_PAGES = 150
        const val MIN_EXPECTED_DECLARED_STATES = 300
    }
}
