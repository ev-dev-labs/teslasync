// On-device verification of the PinButton surface — the parity port of the web `PinButton`
// (web/src/components/ui/PinButton.tsx). Covers what the offline unit tests cannot: each render state
// draws a node whose accessible name carries the ACTION ("Pin" ⇄ "Unpin") and whose pressed/selected
// state mirrors `isPinned`; the labelled variant shows the STATE text ("Pinned") while still announcing
// the action; a pending toggle is disabled (web `disabled`); the first read shows a busy indicator
// labelled "Loading…" with no toggle; offline keeps the toggle plus an "Offline" chip; a hard read error
// shows a Retry affordance beside the toggle; a tap pins the item through the bound seam and raises the
// success toast; and the one-shot PII-safe `view.opened` diagnostic fires on mount. The offline
// :android:testReleaseUnitTest gate covers the pure model + the state holder over the seam.
package io.teslasync.android.sharedsurfaces.pinbutton

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.sharedsurfaces.toast.DefaultToastController
import io.teslasync.android.sharedsurfaces.toast.ToastTone
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class PinButtonUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val rootTag = PinButtonRegistration.ROOT_TEST_TAG
    private val toggleTag = PinButtonRegistration.TOGGLE_TEST_TAG
    private val retryTag = PinButtonRegistration.RETRY_TEST_TAG

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private data class ToggleCall(
        val itemId: String,
        val pin: Boolean,
    )

    private class FakeSource(
        initial: Resource<List<PinnedItem>>,
    ) : PinButtonSource {
        val pinnedFlow = MutableStateFlow(initial)
        val toggleCalls = mutableListOf<ToggleCall>()

        override fun pinned(
            type: PinnedItemType,
            context: String?,
        ): Flow<Resource<List<PinnedItem>>> = pinnedFlow

        override suspend fun togglePin(
            type: PinnedItemType,
            itemId: String,
            pin: Boolean,
            context: String?,
        ): Result<PinnedItem?> {
            toggleCalls += ToggleCall(itemId, pin)
            return Result.success(null)
        }

        override fun refresh() = Unit
    }

    private fun str(id: Int): String = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private fun uiStrings(): PinButtonStrings =
        PinButtonStrings(
            labels =
                PinButtonLabels(
                    pin = str(R.string.translation_pin_pin),
                    pinned = str(R.string.translation_pin_pinned),
                    unpin = str(R.string.translation_pin_unpin),
                ),
            staleLabel = str(R.string.translation_mqtt_stale),
            offlineLabel = str(R.string.translation_common_offline),
            updatingLabel = str(R.string.translation_freshness_updating),
            retryLabel = str(R.string.translation_common_retry),
            loadingLabel = str(R.string.translation_common_loading),
        )

    private fun pin(itemId: String): PinnedItem =
        PinnedItem(id = 1, itemType = PinnedItemType.Vehicle, itemId = itemId, position = 0, pinnedAt = "2026-01-01T00:00:00Z")

    // ── State: unpinned — the action name is "Pin", click action present, not selected ──────────────────

    @Test
    fun unpinnedExposesThePinActionAndIsNotSelected() {
        mount { PinButtonContent(isPinned = false, strings = uiStrings()) }

        compose.onNodeWithTag(toggleTag).assertHasClickAction()
        compose.onNodeWithContentDescription(str(R.string.translation_pin_pin)).assertIsDisplayed()
        compose.onNodeWithTag(toggleTag).assertIsNotSelected()
    }

    // ── State: pinned — the action name is "Unpin", node is selected (web aria-pressed) ─────────────────

    @Test
    fun pinnedExposesTheUnpinActionAndIsSelected() {
        mount { PinButtonContent(isPinned = true, strings = uiStrings()) }

        compose.onNodeWithContentDescription(str(R.string.translation_pin_unpin)).assertIsDisplayed()
        compose.onNodeWithTag(toggleTag).assertIsSelected()
    }

    // ── Variant: labelled — visible STATE text "Pinned", accessible ACTION name "Unpin" ─────────────────

    @Test
    fun labelledShowsStateTextAndAnnouncesTheAction() {
        mount { PinButtonContent(isPinned = true, strings = uiStrings(), showLabel = true) }

        compose.onNodeWithText(str(R.string.translation_pin_pinned), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(str(R.string.translation_pin_unpin)).assertIsDisplayed()
    }

    // ── State: pending — the toggle is disabled (web `disabled={toggle.isPending}`) ─────────────────────

    @Test
    fun pendingDisablesTheToggle() {
        mount { PinButtonContent(isPinned = false, strings = uiStrings(), pending = true) }

        compose.onNodeWithTag(toggleTag).assertIsNotEnabled()
    }

    // ── State: loading — a busy indicator labelled "Loading…", no toggle, root present ──────────────────

    @Test
    fun loadingShowsTheBusyIndicatorWithoutTheToggle() {
        mount { PinButtonContent(isPinned = false, strings = uiStrings(), loading = true) }

        compose.onNodeWithTag(rootTag).assertIsDisplayed()
        compose.onNodeWithContentDescription(str(R.string.translation_common_loading)).assertIsDisplayed()
        compose.onNodeWithTag(toggleTag).assertDoesNotExist()
    }

    // ── State: offline — the toggle stays, plus an "Offline" chip ───────────────────────────────────────

    @Test
    fun offlineKeepsTheToggleAndShowsTheOfflineChip() {
        mount { PinButtonContent(isPinned = true, strings = uiStrings(), offline = true) }

        compose.onNodeWithTag(toggleTag).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.translation_common_offline), useUnmergedTree = true).assertIsDisplayed()
    }

    // ── State: hard error — a Retry affordance renders beside the (still usable) toggle ─────────────────

    @Test
    fun hardErrorShowsRetryBesideTheToggle() {
        mount { PinButtonContent(isPinned = false, strings = uiStrings(), errorKind = QueryErrorKind.Offline) }

        compose.onNodeWithTag(toggleTag).assertIsDisplayed()
        compose.onNodeWithTag(retryTag).assertHasClickAction()
    }

    // ── Behaviour: a tap pins the item through the seam and raises the success toast ────────────────────

    @Test
    fun tappingPinsTheItemAndRaisesTheSuccessToast() {
        val source = FakeSource(Resource.Success(emptyList(), fetchedAt = 100L, stale = false))
        val toast = DefaultToastController()
        mount {
            PinButton(
                itemType = PinnedItemType.Vehicle,
                itemId = "42",
                source = source,
                toast = toast,
                logger = RecordingLogger(),
            )
        }

        compose.onNodeWithTag(toggleTag).performClick()
        compose.waitForIdle()

        assertEquals(listOf(ToggleCall("42", true)), source.toggleCalls)
        val raised = toast.toasts.value.single()
        assertEquals(ToastTone.Success, raised.tone)
        assertEquals(str(R.string.translation_toast_pin_pinned_success), raised.title)
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ─────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnostic() {
        val logger = RecordingLogger()
        mount {
            PinButton(
                itemType = PinnedItemType.Vehicle,
                itemId = "42",
                source = FakeSource(Resource.Success(listOf(pin("42")), fetchedAt = 100L, stale = false)),
                toast = DefaultToastController(),
                logger = logger,
            )
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
        assertEquals(1, opened.size)
        val record = opened.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf(FIELD_SURFACE to PinButtonRegistration.SLUG), record.fields)
        assertTrue(logger.records.all { r -> r.fields.values.none { it == "42" } })
    }

    private fun mount(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                content()
            }
        }
        compose.waitForIdle()
    }
}
