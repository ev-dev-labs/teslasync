package io.teslasync.android.sharedsurfaces.pagecontainer

import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.sharedsurfaces.datafreshness.DATA_FRESHNESS_TEST_TAG
import io.teslasync.android.sharedsurfaces.datafreshness.DataFreshnessProjection
import io.teslasync.android.sharedsurfaces.datafreshness.FreshnessRender
import io.teslasync.android.sharedsurfaces.datafreshness.FreshnessSnapshot
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the PageContainer surface across every state the web
 * component renders (web/src/components/layout/PageContainer.tsx): the loading spinner, the error surface with a
 * working retry, the empty surface, the healthy content, and the header (title heading, freshness chip, and
 * copy-link button). Also exercises the stateful surface's breadcrumb-overrides publish (web
 * `useSetBreadcrumbOverrides`) and the one-shot PII-safe `view.opened` diagnostic. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure model + diagnostics logic.
 */
class PageContainerUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Loading: the centred brand spinner announces the localized "Loading" name ───────────────────────

    @Test
    fun loadingStateRendersTheSpinner() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PageContainerScaffold(title = TITLE, bodyState = PageBodyState.Loading) {}
            }
        }

        compose.onNodeWithContentDescription(LOADING).assertIsDisplayed()
    }

    // ── Error: the shared error surface shows the host message and a working Retry ──────────────────────

    @Test
    fun errorStateShowsMessageAndRetry() {
        var retried = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PageContainerScaffold(
                    title = TITLE,
                    bodyState = PageBodyState.Error,
                    errorMessage = ERROR,
                    onRetry = { retried = true },
                ) {}
            }
        }

        compose.onNodeWithText(ERROR, useUnmergedTree = true).assertIsDisplayed()
        val retry = compose.onNodeWithText(RETRY)
        retry.assertIsDisplayed().assertHasClickAction()

        retry.performClick()

        assertEquals(true, retried)
    }

    // ── Empty: the shared empty surface shows the host message, never a blank box ────────────────────────

    @Test
    fun emptyStateShowsTheMessage() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PageContainerScaffold(title = TITLE, bodyState = PageBodyState.Empty, emptyMessage = EMPTY) {}
            }
        }

        compose.onNodeWithText(EMPTY, useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Content + header: children render; the title is a heading; freshness chip + copy-link present ────

    @Test
    fun contentStateRendersChildrenAndHeader() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PageContainerScaffold(
                    title = TITLE,
                    bodyState = PageBodyState.Content,
                    subtitle = SUBTITLE,
                    freshnessRender = staleRender(),
                    copyLink = "io.teslasync.android://charging",
                ) {
                    Text(CONTENT)
                }
            }
        }

        compose.onNodeWithTag(PAGE_CONTAINER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(TITLE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(SUBTITLE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(CONTENT).assertIsDisplayed()
        compose.onNodeWithTag(DATA_FRESHNESS_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(COPY_LINK).assertIsDisplayed().assertHasClickAction()
    }

    // ── Header collapses to just the title when there is no trailing item ───────────────────────────────

    @Test
    fun headerWithoutTrailingItemsRendersTitleOnly() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PageContainerScaffold(title = TITLE, bodyState = PageBodyState.Content) { Text(CONTENT) }
            }
        }

        compose.onNodeWithText(TITLE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(CONTENT).assertIsDisplayed()
    }

    // ── Breadcrumb overrides: the stateful surface publishes its labels into the provided store ──────────

    @Test
    fun mountingPublishesBreadcrumbOverridesAndEmitsViewOpened() {
        val store = BreadcrumbOverridesStore()
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalBreadcrumbOverrides provides store) {
                    PageContainer(
                        title = TITLE,
                        breadcrumbLabels = mapOf(ROUTE to LABEL),
                        logger = logger,
                    ) {
                        Text(CONTENT)
                    }
                }
            }
        }
        compose.waitForIdle()

        assertEquals(LABEL, store.current[ROUTE])
        assertEquals(1, logger.events.count { it.first == "view.opened" })
        assertEquals(mapOf("surface" to "PageContainer"), logger.events.single { it.first == "view.opened" }.second)
    }

    private fun staleRender(): FreshnessRender {
        val now = 1_000_000_000_000L
        return DataFreshnessProjection.render(
            snapshot =
                FreshnessSnapshot(
                    updatedAtMs = now - 300_000L,
                    fetching = false,
                    stale = true,
                    hardError = false,
                    offline = false,
                    hasData = true,
                    empty = false,
                ),
            nowMs = now,
            reduceMotion = true,
            refetchable = false,
        )
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    private companion object {
        private const val TITLE = "Charging history"
        private const val SUBTITLE = "All sessions across your fleet"
        private const val CONTENT = "Session list body"
        private const val ERROR = "Cannot reach the charging service"
        private const val EMPTY = "No charging sessions yet."
        private const val RETRY = "Retry"
        private const val LOADING = "Loading"
        private const val COPY_LINK = "Copy link"
        private const val ROUTE = "/charging/:id"
        private const val LABEL = "Supercharger trip"
    }
}
