// Instrumented Compose UI + accessibility verification of the stateless HelpIconContent across the states the web
// component renders: the shown trigger whose accessible name is the per-field "Help for {field}" (the web `for` ⇒
// `t('a11y.helpFor')`), the shown trigger that falls back to the generic "More info" (web `for` omitted), the shown
// trigger whose accessible name is an explicit override (web `ariaLabel`), and the hidden branch that draws nothing
// (web `if (!text) return null`). Asserting the trigger's content description IS the accessibility-label test — it
// is what TalkBack announces, the native mirror of the web trigger's `aria-label`. Runs under
// `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure model.
// `assertDoesNotExist` is a SemanticsNodeInteraction member and is deliberately called without an import (an
// explicit import does not resolve).
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helpicon

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

class HelpIconUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun shownIconExposesPerFieldNameWhenForIdProvided() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HelpIconContent(
                    text = null,
                    content = HELP_TEXT,
                    forId = FIELD,
                    ariaLabel = null,
                    helpForLabel = HELP_FOR_LABEL,
                    genericLabel = GENERIC_LABEL,
                )
            }
        }
        // The web trigger `aria-label` "Help for {field}" is mirrored as the icon's content description.
        compose.onNodeWithContentDescription(HELP_FOR_LABEL).assertIsDisplayed()
    }

    @Test
    fun shownIconFallsBackToGenericNameWhenForIdOmitted() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HelpIconContent(
                    text = HELP_TEXT,
                    content = null,
                    forId = null,
                    ariaLabel = null,
                    helpForLabel = HELP_FOR_LABEL,
                    genericLabel = GENERIC_LABEL,
                )
            }
        }
        compose.onNodeWithContentDescription(GENERIC_LABEL).assertIsDisplayed()
    }

    @Test
    fun explicitAriaLabelOverridesComputedName() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HelpIconContent(
                    text = HELP_TEXT,
                    content = null,
                    forId = FIELD,
                    ariaLabel = OVERRIDE_LABEL,
                    helpForLabel = HELP_FOR_LABEL,
                    genericLabel = GENERIC_LABEL,
                )
            }
        }
        compose.onNodeWithContentDescription(OVERRIDE_LABEL).assertIsDisplayed()
        compose.onNodeWithContentDescription(HELP_FOR_LABEL).assertDoesNotExist()
    }

    @Test
    fun rendersNothingWhenNoHelpTextSupplied() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HelpIconContent(
                    text = null,
                    content = null,
                    forId = FIELD,
                    ariaLabel = null,
                    helpForLabel = HELP_FOR_LABEL,
                    genericLabel = GENERIC_LABEL,
                )
            }
        }
        // Web `if (!text) return null`: neither the per-field nor the generic trigger is drawn.
        compose.onNodeWithContentDescription(HELP_FOR_LABEL).assertDoesNotExist()
        compose.onNodeWithContentDescription(GENERIC_LABEL).assertDoesNotExist()
    }

    private companion object {
        const val HELP_TEXT = "Cooldown protects against alert spam."
        const val FIELD = "cooldown"
        const val HELP_FOR_LABEL = "Help for cooldown"
        const val GENERIC_LABEL = "More info"
        const val OVERRIDE_LABEL = "Custom help label"
    }
}
