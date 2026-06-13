package io.teslasync.android.sharedsurfaces.combobox

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.forms.ComboOption
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of the Combobox surface across every branch the
 * prompt's state matrix mandates (web/src/components/forms/Combobox.tsx): the options list, the loading row,
 * the "No results" empty row, the hard error line with retry, and the stale + offline (cached) freshness
 * chips — plus the web `hideLabel` accessible-name contract, the clear (×) and chevron accessible labels, and
 * the option-selection callback. Every asserted string is resolved from the app's i18n resources so the test
 * follows the device locale rather than hard-coding English. The clock auto-advance is disabled so the
 * loading spinner's infinite animation cannot stall `waitForIdle`; the dropdown's enter animation is settled
 * with an explicit advance. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers
 * the pure projection + the ViewModel lifecycle.
 */
class ComboboxUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    @Test
    fun resultsShowEveryOption() {
        setContent(model(content(OPTIONS), query = "Model"))

        compose.onNodeWithText(MODEL_3).assertIsDisplayed()
        compose.onNodeWithText(MODEL_Y).assertIsDisplayed()
        compose.onNodeWithText(MODEL_X).assertIsDisplayed()
    }

    @Test
    fun loadingShowsTheLoadingRow() {
        setContent(model(UiState.loading(), query = "Mo"))

        compose.onNodeWithText(string(R.string.translation_combobox_loading)).assertIsDisplayed()
    }

    @Test
    fun emptyShowsTheNoResultsRow() {
        setContent(model(empty(), query = "zzz"))

        compose.onNodeWithText(string(R.string.translation_combobox_noResults)).assertIsDisplayed()
    }

    @Test
    fun errorShowsTheFailureMessageAndRetry() {
        setContent(model(errorState()))

        compose.onNodeWithText(string(R.string.translation_error_loadFailed)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_error_retry)).assertIsDisplayed()
    }

    @Test
    fun staleShowsTheStaleChip() {
        setContent(
            model(
                UiState(UiPhase.Content, OPTIONS, fetchedAt = STAMP, stale = true, refreshing = true),
                query = "Model",
            ),
        )

        compose.onNodeWithText(string(R.string.translation_mqtt_stale)).assertIsDisplayed()
    }

    @Test
    fun offlineShowsTheOfflineChipBeneathCachedOptions() {
        setContent(
            model(
                UiState(UiPhase.Content, OPTIONS, fetchedAt = STAMP, stale = true, errorKind = ErrorKind.Network),
                query = "Model",
            ),
        )

        compose.onNodeWithText(string(R.string.translation_common_offline)).assertIsDisplayed()
        compose.onNodeWithText(MODEL_3).assertIsDisplayed()
    }

    @Test
    fun hiddenLabelKeepsTheAccessibleName() {
        // Web `hideLabel` — no visible label, but the field keeps "Vehicle" as its accessible name.
        setContent(model(content(OPTIONS), expanded = false), hideLabel = true)

        compose.onNodeWithContentDescription(LABEL).assertIsDisplayed()
    }

    @Test
    fun clearAffordanceExposesItsAccessibleName() {
        setContent(model(content(OPTIONS), selected = OPTIONS.first(), expanded = false))

        compose.onNodeWithContentDescription(string(R.string.translation_combobox_clearAria)).assertIsDisplayed()
    }

    @Test
    fun chevronExposesItsAccessibleName() {
        setContent(model(content(OPTIONS), expanded = false))

        compose.onNodeWithContentDescription(string(R.string.translation_combobox_openListAria)).assertIsDisplayed()
    }

    @Test
    fun selectingAnOptionEmitsItToTheHost() {
        var picked: ComboOption? = null
        setContent(model(content(OPTIONS), query = "Model"), onSelect = { picked = it })

        compose.onNodeWithText(MODEL_Y).performClick()
        compose.waitForIdle()

        assert(picked == OPTIONS[1]) { "expected onSelect with the picked option, was $picked" }
    }

    @Test
    fun statefulSurfaceRendersTheFieldAndChevron() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = WIDTH, height = HEIGHT)) {
                    val vm = remember { ComboboxViewModel(OPTIONS.asComboboxSource(), NoopLogger, debounceMillis = 0) }
                    Combobox(viewModel = vm, label = LABEL)
                }
            }
        }
        compose.waitForIdle()

        compose.onNodeWithContentDescription(string(R.string.translation_combobox_openListAria)).assertIsDisplayed()
    }

    private fun setContent(
        model: ComboboxUiModel,
        hideLabel: Boolean = false,
        enabled: Boolean = true,
        onSelect: (ComboOption) -> Unit = {},
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = WIDTH, height = HEIGHT)) {
                    ComboboxContent(
                        model = model,
                        label = LABEL,
                        hideLabel = hideLabel,
                        enabled = enabled,
                        onSelect = onSelect,
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    private fun content(options: List<ComboOption>): UiState<List<ComboOption>> = UiState(UiPhase.Content, options, fetchedAt = STAMP)

    private fun empty(): UiState<List<ComboOption>> = UiState(UiPhase.Empty, emptyList(), fetchedAt = STAMP)

    private fun errorState(): UiState<List<ComboOption>> = UiState(UiPhase.Error, errorKind = ErrorKind.Network)

    private fun model(
        state: UiState<List<ComboOption>>,
        selected: ComboOption? = null,
        query: String = "",
        expanded: Boolean = true,
    ): ComboboxUiModel =
        ComboboxProjection.project(
            state,
            ComboboxInteraction(selected = selected, query = query, expanded = expanded),
        )

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private companion object {
        const val LABEL = "Vehicle"
        const val MODEL_3 = "Model 3"
        const val MODEL_Y = "Model Y"
        const val MODEL_X = "Model X"
        const val STAMP = 1_700_000_000_000L
        const val SETTLE_MS = 2_000L
        val WIDTH = 360.dp
        val HEIGHT = 720.dp

        val OPTIONS =
            listOf(
                ComboOption(value = "3", label = MODEL_3),
                ComboOption(value = "y", label = MODEL_Y),
                ComboOption(value = "x", label = MODEL_X),
            )
    }
}
