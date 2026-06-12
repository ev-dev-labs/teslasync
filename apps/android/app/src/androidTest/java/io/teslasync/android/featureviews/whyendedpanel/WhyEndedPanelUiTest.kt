package io.teslasync.android.featureviews.whyendedpanel

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId

/**
 * Instrumented Compose UI + accessibility verification of WhyEndedPanel across every branch the prompt's
 * state matrix mandates (web/src/features/driving/components/drive-detail/WhyEndedPanel.tsx): collapsed
 * (header title), loading (the spinner's localized accessible name), the hard error with Retry, the two
 * ready sections with rows, the per-section empty states, the offline (cached + chip) surface, and the
 * end-to-end expand toggle on the stateful surface — plus the window-selector accessible name (web
 * `aria-label`). Every asserted string resolves from the app's i18n resources so the test follows the device
 * locale rather than hard-coding English (the a11y-label coverage). The clock auto-advance is disabled so
 * the loading spinner's infinite animation cannot stall `waitForIdle`. Runs under `connectedAndroidTest`; the
 * offline `testReleaseUnitTest` gate covers the pure projection + view-model, including the collapsed
 * "header only / empty body" contract.
 */
class WhyEndedPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    @Test
    fun collapsedShowsTheLocalizedTitle() {
        setContent(state(expanded = false, resource = null))

        compose.onNodeWithText(string(R.string.translation_driveDetail_whyEnded_title)).assertIsDisplayed()
    }

    @Test
    fun loadingShowsTheSpinnerWithItsLocalizedAccessibleName() {
        setContent(state(expanded = true, resource = Resource.Loading(cached = null, fetchedAt = null, stale = false)))

        compose.onNodeWithContentDescription(string(R.string.translation_common_loading)).assertIsDisplayed()
    }

    @Test
    fun errorShowsTheFailureTitleMessageAndRetry() {
        setContent(
            state(
                expanded = true,
                resource = Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
            ),
        )

        compose.onNodeWithText(string(R.string.translation_driveDetail_whyEnded_error_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_driveDetail_whyEnded_error_message)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_common_retry)).assertIsDisplayed()
    }

    @Test
    fun readyShowsBothSectionsWithRows() {
        setContent(state(expanded = true, resource = Resource.Success(payloadWithData(), fetchedAt = 1L, stale = false)))

        compose.onNodeWithText(string(R.string.translation_driveDetail_whyEnded_fsmTitle)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_driveDetail_whyEnded_signalTitle)).assertIsDisplayed()
        compose.onNodeWithText(GEAR_FIELD).assertIsDisplayed()
    }

    @Test
    fun emptyResponseShowsTheTwoPerSectionEmptyStates() {
        setContent(state(expanded = true, resource = Resource.Success(payloadEmpty(), fetchedAt = 1L, stale = false)))

        compose.onNodeWithText(string(R.string.translation_driveDetail_whyEnded_fsmEmpty_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_driveDetail_whyEnded_signalEmpty)).assertIsDisplayed()
    }

    @Test
    fun windowSelectorCarriesTheLocalizedAccessibleName() {
        // Web `aria-label="Diagnostic window"` — the selector keeps it as its TalkBack name.
        setContent(state(expanded = true, resource = Resource.Success(payloadEmpty(), fetchedAt = 1L, stale = false)))

        compose.onNodeWithContentDescription(string(R.string.translation_driveDetail_whyEnded_windowAria)).assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedRowsBeneathTheOfflineChip() {
        setContent(
            state(
                expanded = true,
                resource = Resource.Error(cached = payloadWithData(), fetchedAt = 1L, stale = true, error = ApiError.Timeout()),
            ),
        )

        compose.onNodeWithText(string(R.string.translation_common_offline)).assertIsDisplayed()
        compose.onNodeWithText(GEAR_FIELD).assertIsDisplayed()
    }

    @Test
    fun togglingTheHeaderExpandsTheStatefulSurface() {
        compose.mainClock.autoAdvance = false
        val source =
            object : WhyEndedPanelSource {
                override fun driveWhyEnded(
                    driveId: String,
                    window: String,
                ): Flow<Resource<JsonElement>> = flowOf(Resource.Success(payloadWithData(), fetchedAt = 1L, stale = false))
            }
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = WIDTH, height = HEIGHT)) {
                    WhyEndedPanel(source = source, driveId = "42", zoneId = ZoneId.of("UTC"), logger = NoopLogger)
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)

        // The header title is always present; tapping it expands the lazy body and reveals the sections.
        compose.onNodeWithText(string(R.string.translation_driveDetail_whyEnded_title)).performClick()
        compose.mainClock.advanceTimeBy(SETTLE_MS)
        compose.waitForIdle()

        compose.onNodeWithText(string(R.string.translation_driveDetail_whyEnded_fsmTitle)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_driveDetail_whyEnded_signalTitle)).assertIsDisplayed()
        compose.onNodeWithText(GEAR_FIELD).assertIsDisplayed()
    }

    private fun state(
        expanded: Boolean,
        resource: Resource<JsonElement>?,
    ): WhyEndedFeedState = WhyEndedFeedState(expanded = expanded, window = WhyEndedWindow.Sec60, resource = resource)

    private fun setContent(state: WhyEndedFeedState) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = WIDTH, height = HEIGHT)) {
                    WhyEndedPanelContent(
                        state = state,
                        strings = uiStrings(),
                        onToggleExpand = {},
                        onSelectWindow = {},
                        onRetry = {},
                        zoneId = ZoneId.of("UTC"),
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    private fun uiStrings(): WhyEndedPanelStrings =
        WhyEndedPanelStrings(
            title = string(R.string.translation_driveDetail_whyEnded_title),
            windowAria = string(R.string.translation_driveDetail_whyEnded_windowAria),
            errorTitle = string(R.string.translation_driveDetail_whyEnded_error_title),
            errorMessage = string(R.string.translation_driveDetail_whyEnded_error_message),
            retry = string(R.string.translation_common_retry),
            fsmTitle = string(R.string.translation_driveDetail_whyEnded_fsmTitle),
            fsmEmptyTitle = string(R.string.translation_driveDetail_whyEnded_fsmEmpty_title),
            fsmEmptyMessage = string(R.string.translation_driveDetail_whyEnded_fsmEmpty_message),
            signalTitle = string(R.string.translation_driveDetail_whyEnded_signalTitle),
            signalColTs = string(R.string.translation_driveDetail_whyEnded_signal_cols_ts),
            signalColField = string(R.string.translation_driveDetail_whyEnded_signal_cols_field),
            signalColValue = string(R.string.translation_driveDetail_whyEnded_signal_cols_value),
            signalEmpty = string(R.string.translation_driveDetail_whyEnded_signalEmpty),
        )

    private fun payloadWithData(): JsonElement =
        Json.parseToJsonElement(
            """
            {
              "fsm_transitions": [
                { "id": 1, "ts": "2026-03-14T11:45:00Z", "fsm_name": "drive",
                  "from_state": "driving", "to_state": "parked", "trigger": "shift_to_park" }
              ],
              "signal_window": [
                { "ts": "2026-03-14T11:45:00Z", "field": "$GEAR_FIELD", "value": "P" }
              ]
            }
            """.trimIndent(),
        )

    private fun payloadEmpty(): JsonElement = Json.parseToJsonElement("""{ "fsm_transitions": [], "signal_window": [] }""")

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private companion object {
        const val GEAR_FIELD = "Gear"
        val WIDTH = 380.dp
        val HEIGHT = 800.dp
        const val SETTLE_MS = 2_000L
    }
}
