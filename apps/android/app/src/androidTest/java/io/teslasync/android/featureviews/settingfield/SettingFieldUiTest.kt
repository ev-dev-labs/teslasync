package io.teslasync.android.featureviews.settingfield

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [SettingFieldContent] across the branches the web
 * source defines (web/src/features/settings/components/SettingField.tsx): the uppercased label
 * (web `<label class="… uppercase …">`), the field control (web `children`) rendered beneath, and the inline
 * help icon's accessible name — "Help for {forId}" when a field id is present and the generic "More info"
 * when it is not (web HelpIcon aria-label ternary), plus the no-icon case when no help is supplied
 * (web HelpIcon `if (!text) return null`). Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure projection logic.
 */
class SettingFieldUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val childMarker = "field-control"

    private fun setContent(
        label: String,
        help: SettingFieldHelp? = null,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SettingFieldContent(label = label, help = help) {
                    BodyText(childMarker)
                }
            }
        }
    }

    @Test
    fun rendersTheUppercasedLabelAndTheChildControl() {
        val label = "Electricity Cost (per kWh)"
        setContent(label = label)
        compose.onNodeWithText(SettingFieldProjection.displayLabel(label, Locale.getDefault())).assertIsDisplayed()
        compose.onNodeWithText(childMarker).assertIsDisplayed()
    }

    @Test
    fun helpIconExposesThePerFieldAccessibleName() {
        setContent(
            label = "Electricity Cost (per kWh)",
            help =
                SettingFieldHelp(
                    i18nKey = "help.fields.settings.electricityCost",
                    content = "Cost per kWh used across analytics.",
                    forId = "electricity-cost",
                ),
        )
        compose.onNodeWithContentDescription("Help for electricity-cost").assertIsDisplayed()
    }

    @Test
    fun helpIconExposesTheGenericAccessibleNameWithoutAFieldId() {
        setContent(
            label = "Gas Price",
            help = SettingFieldHelp(content = "Used to compute fuel savings versus driving an EV."),
        )
        compose.onNodeWithContentDescription("More info").assertIsDisplayed()
    }

    @Test
    fun rendersNoHelpIconWhenNoHelpIsSupplied() {
        setContent(label = "Comparison Vehicle MPG")
        compose.onNodeWithText(SettingFieldProjection.displayLabel("Comparison Vehicle MPG", Locale.getDefault())).assertIsDisplayed()
        compose.onNodeWithContentDescription("More info").assertDoesNotExist()
    }
}
