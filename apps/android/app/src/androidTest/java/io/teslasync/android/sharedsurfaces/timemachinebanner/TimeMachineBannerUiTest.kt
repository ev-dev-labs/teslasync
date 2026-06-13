// On-device Compose UI + accessibility verification of the TimeMachineBanner shared surface across every state the
// web component renders (web/src/components/feedback/TimeMachineBanner.tsx): the viewing state with its title,
// body and "Return to live" affordance; the open inline picker with its labelled date/time field, the "View as of
// date" submit and "Cancel"; the prompt state (no anchor) without return-to-live; and the dormant live state
// where the web returns null. It asserts the rendered i18n copy and that every control is a labelled, clickable
// element. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure model, this covers
// the render.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timemachinebanner

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

class TimeMachineBannerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val sampleWhen = "2024-11-12 14:30"
    private val sampleDraft = "2024-11-12 14:30"

    private fun s(id: Int): String = context.getString(id)

    private fun titleFor(whenLabel: String): String = context.getString(R.string.translation_timeMachine_banner_title, whenLabel)

    private fun viewingStrings(): TimeMachineBannerStrings =
        TimeMachineBannerStrings(
            heading = titleFor(sampleWhen),
            body = s(R.string.translation_timeMachine_banner_body),
            pick = s(R.string.translation_timeMachine_banner_pick),
            returnToLive = s(R.string.translation_timeMachine_banner_returnToLive),
            inputLabel = s(R.string.translation_timeMachine_banner_inputLabel),
            submit = s(R.string.translation_timeMachine_banner_submit),
            cancel = s(R.string.translation_timeMachine_banner_cancel),
            confirm = s(R.string.translation_common_confirm),
            pickEmpty = s(R.string.translation_timeMachine_banner_pick),
        )

    private fun promptStrings(): TimeMachineBannerStrings =
        viewingStrings().copy(
            heading = s(R.string.translation_timeMachine_banner_pickPrompt),
            body = s(R.string.translation_timeMachine_banner_pickBody),
        )

    private fun setSurface(
        render: TimeMachineBannerRender,
        strings: TimeMachineBannerStrings,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TimeMachineBannerContent(render = render, strings = strings, draftDisplay = sampleDraft)
            }
        }
    }

    @Test
    fun viewingShowsTitleBodyAndReturnToLive() {
        setSurface(
            TimeMachineBannerRender(visible = true, viewing = true, showReturnToLive = true, showPicker = false, submitEnabled = false),
            viewingStrings(),
        )

        compose.onNodeWithTag(TIME_MACHINE_BANNER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(titleFor(sampleWhen)).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_timeMachine_banner_body)).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_timeMachine_banner_pick)).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(s(R.string.translation_timeMachine_banner_returnToLive)).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun pickerOpenShowsLabelledFieldSubmitAndCancel() {
        setSurface(
            TimeMachineBannerRender(visible = true, viewing = true, showReturnToLive = true, showPicker = true, submitEnabled = true),
            viewingStrings(),
        )

        compose.onNodeWithTag(TIME_MACHINE_PICKER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_timeMachine_banner_inputLabel)).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_timeMachine_banner_submit)).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(s(R.string.translation_timeMachine_banner_cancel)).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun promptStateShowsPromptCopyWithoutReturnToLive() {
        setSurface(
            TimeMachineBannerRender(visible = true, viewing = false, showReturnToLive = false, showPicker = true, submitEnabled = true),
            promptStrings(),
        )

        compose.onNodeWithTag(TIME_MACHINE_BANNER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_timeMachine_banner_pickPrompt)).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_timeMachine_banner_returnToLive)).assertDoesNotExist()
    }

    @Test
    fun dormantStateRendersNothing() {
        setSurface(
            TimeMachineBannerRender(visible = false, viewing = false, showReturnToLive = false, showPicker = false, submitEnabled = false),
            viewingStrings(),
        )

        compose.onNodeWithTag(TIME_MACHINE_BANNER_TEST_TAG).assertDoesNotExist()
    }
}
