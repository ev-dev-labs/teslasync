// Instrumented Compose UI + accessibility verification of the stateless ActionItemContent across the branches the
// web component renders: the three severity variants, the title + description + CTA happy path, the empty-title
// fallback (the prompt's "never a blank box" contract), a row with no CTA, the merged TalkBack announcement
// (title + description), and the CTA button's click callback. Runs under `connectedAndroidTest` (a device /
// emulator); the offline gate's `testReleaseUnitTest` covers the pure model + classifier.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.actionitem

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ActionItemUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun infoRowRendersTitleDescriptionAndCta() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ActionItemContent(
                    severity = ActionSeverity.Info,
                    title = TITLE,
                    description = DESCRIPTION,
                    cta = ActionItemCta(label = CTA, kind = ActionCtaKind.Button, onActivate = {}),
                )
            }
        }
        compose.onNodeWithContentDescription(TITLE, substring = true).assertIsDisplayed()
        compose.onNodeWithText(CTA).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun warnSeverityRendersTitle() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ActionItemContent(severity = ActionSeverity.Warn, title = WARN_TITLE)
            }
        }
        compose.onNodeWithContentDescription(WARN_TITLE, substring = true).assertIsDisplayed()
    }

    @Test
    fun errorSeverityRendersTitle() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ActionItemContent(severity = ActionSeverity.Error, title = ERROR_TITLE)
            }
        }
        compose.onNodeWithContentDescription(ERROR_TITLE, substring = true).assertIsDisplayed()
    }

    @Test
    fun blankTitleShowsEmptyFallback() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ActionItemContent(severity = ActionSeverity.Info, title = "")
            }
        }
        // The localized empty fallback (R.string.translation_common_noData) is rendered, never a blank line.
        compose.onNodeWithContentDescription(FALLBACK, substring = true).assertIsDisplayed()
    }

    @Test
    fun rowExposesMergedTitleAndDescriptionLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ActionItemContent(severity = ActionSeverity.Error, title = TITLE, description = DESCRIPTION)
            }
        }
        // The merged announcement folds the title and its description into one TalkBack focus.
        compose.onNodeWithContentDescription(TITLE, substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(DESCRIPTION, substring = true).assertIsDisplayed()
    }

    @Test
    fun ctaInvokesCallbackOnClick() {
        var activated = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ActionItemContent(
                    severity = ActionSeverity.Warn,
                    title = TITLE,
                    cta = ActionItemCta(label = CTA, kind = ActionCtaKind.InternalLink, onActivate = { activated = true }),
                )
            }
        }
        compose.onNodeWithText(CTA).assertHasClickAction().performClick()
        assertTrue(activated)
    }

    @Test
    fun noCtaRendersNoAffordance() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ActionItemContent(severity = ActionSeverity.Info, title = TITLE, description = DESCRIPTION)
            }
        }
        compose.onNodeWithContentDescription(TITLE, substring = true).assertIsDisplayed()
        compose.onNodeWithText(CTA).assertDoesNotExist()
    }

    private companion object {
        const val TITLE = "Software update available"
        const val DESCRIPTION = "v1.2.0 to v1.3.0"
        const val CTA = "Install"
        const val WARN_TITLE = "Vehicle authorization expires soon"
        const val ERROR_TITLE = "Re-authentication required"

        // English catalog value resolved on-device (R.string.translation_common_noData).
        const val FALLBACK = "No data available"
    }
}
