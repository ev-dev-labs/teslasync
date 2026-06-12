package io.teslasync.android.featureviews.aifeaturetogglelist

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [AIFeatureToggleListContent] across every state the
 * surface renders: the always-visible legend, the loading skeleton chrome, the hard-error retry surface, the
 * defensive empty state, the populated toggle rows (with both the catalog-resolved label and the
 * registry-fallback label/description paths), the toggle on/off semantics + click write-back, and the
 * stale/offline cached views. Mirrors the web spec
 * (web/src/features/settings/components/AIFeatureToggleList.tsx).
 *
 * A small synthetic registry is injected so labels are deterministic and the rows fit on screen:
 *   • `digest-narration` HAS a catalog entry, so its catalog label wins over the (wrong) registry fallback —
 *     proving the `t(key, fallback)` catalog path; and
 *   • `zz-demo-feature` has NO catalog entry, so its registry fallback label + description render — proving the
 *     fallback path the 11 catalog-absent features rely on.
 */
class AIFeatureToggleListUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val legend = "Per-feature opt-in (all default off)"
    private val catalogRowId = "digest-narration"
    private val fallbackRowId = "zz-demo-feature"

    private fun rows() =
        AIFeatureToggleListProjection.rows(
            listOf(
                AiFeatureMeta(catalogRowId, "WRONG_FALLBACK_LABEL", "wrong fallback description", false),
                AiFeatureMeta(fallbackRowId, "Demo Feature Label", "Demo feature description", false),
            ),
        )

    private fun setContent(
        state: UiState<Map<String, Boolean>>,
        onToggle: (String, Boolean) -> Unit = { _, _ -> },
        onRetry: () -> Unit = {},
        rows: List<AiFeatureRow> = rows(),
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AIFeatureToggleListContent(
                    state = state,
                    onToggle = onToggle,
                    onRetry = onRetry,
                    rows = rows,
                )
            }
        }
    }

    @Test
    fun contentShowsLegendCatalogLabelAndRegistryFallbackRow() {
        setContent(UiState(UiPhase.Content, data = mapOf(fallbackRowId to true)))

        compose.onNodeWithText(legend).assertIsDisplayed()
        // Catalog wins over the registry fallback (web `t(key, fallback)`).
        compose.onNodeWithText("Weekly digest narration", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("WRONG_FALLBACK_LABEL", useUnmergedTree = true).assertDoesNotExist()
        // Catalog-absent feature falls back to the registry label + description.
        compose.onNodeWithText("Demo Feature Label", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Demo feature description", useUnmergedTree = true).assertExists()
    }

    @Test
    fun toggleReflectsValueAndClickInvokesOnToggleWithIdAndNextValue() {
        var toggledId: String? = null
        var toggledValue: Boolean? = null
        setContent(
            state = UiState(UiPhase.Content, data = mapOf(catalogRowId to true, fallbackRowId to false)),
            onToggle = { id, value ->
                toggledId = id
                toggledValue = value
            },
        )

        compose.onNodeWithTag("ai-feature-row-$catalogRowId").assertIsOn()
        compose.onNodeWithTag("ai-feature-row-$fallbackRowId").assertIsOff()

        compose.onNodeWithTag("ai-feature-row-$fallbackRowId").performClick()
        assertEquals(fallbackRowId, toggledId)
        assertEquals(true, toggledValue)
    }

    @Test
    fun loadingShowsLegendAndAccessibleSkeletonNotRowsOrBlank() {
        setContent(UiState(UiPhase.Loading))

        compose.onNodeWithText(legend).assertIsDisplayed()
        compose.onNodeWithContentDescription("Loading").assertExists()
        // No toggle rows while the first load is in flight.
        compose.onNodeWithTag("ai-feature-row-$fallbackRowId").assertDoesNotExist()
    }

    @Test
    fun errorShowsLegendRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = { retried = true },
        )

        compose.onNodeWithText(legend).assertIsDisplayed()
        compose.onNodeWithText("Retry").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsLegendAndFriendlyEmptyState() {
        setContent(UiState(UiPhase.Empty, data = emptyMap()), rows = emptyList())

        compose.onNodeWithText(legend).assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedTogglesWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = mapOf(fallbackRowId to true),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )

        compose.onNodeWithText(legend).assertIsDisplayed()
        compose.onNodeWithTag("ai-feature-row-$fallbackRowId").assertIsOn()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleReachableContentAutoRefreshesAndKeepsCachedToggles() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = mapOf(fallbackRowId to false),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )

        compose.waitForIdle()
        compose.onNodeWithText(legend).assertIsDisplayed()
        compose.onNodeWithTag("ai-feature-row-$fallbackRowId").assertIsOff()
        assertTrue(refreshed)
    }
}
