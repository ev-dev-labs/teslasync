// Instrumented Compose UI + accessibility verification of the Popover surface (web/src/components/ui/Popover.tsx):
// the bordered content chrome renders the caller's children, exposes the optional `ariaLabel` as its TalkBack
// accessible name, and the stateful [Popover] hides its content while collapsed. Runs under `connectedAndroidTest`;
// the offline `testReleaseUnitTest` gate covers the pure positioning projection.
package io.teslasync.android.modalsdialogs.popover

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Rule
import org.junit.Test

class PopoverUiTest {
    @get:Rule
    val compose = createComposeRule()

    private class NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    @Test
    fun surfaceRendersEveryContentRow() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    PopoverSurface(accessibleName = "Sort order") {
                        BodyText(text = "Newest first")
                        BodyText(text = "Oldest first")
                        BodyText(text = "Highest range")
                    }
                }
            }
        }

        compose.onNodeWithTag(PopoverTestTags.CONTENT).assertIsDisplayed()
        compose.onNodeWithText("Newest first", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Oldest first", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Highest range", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun surfaceExposesAccessibleNameToTalkBack() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    PopoverSurface(accessibleName = "Sort order") {
                        BodyText(text = "Newest first")
                    }
                }
            }
        }

        compose.onNodeWithContentDescription("Sort order").assertIsDisplayed()
    }

    @Test
    fun surfaceRendersWithoutAccessibleName() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    PopoverSurface {
                        BodyText(text = "Estimated 312 km of range remaining")
                    }
                }
            }
        }

        compose.onNodeWithTag(PopoverTestTags.CONTENT).assertIsDisplayed()
        compose.onNodeWithText("Estimated 312 km of range remaining", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun collapsedPopoverShowsNoContent() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    Popover(
                        expanded = false,
                        onDismissRequest = {},
                        accessibleName = "Sort order",
                        logger = NoopLogger(),
                    ) {
                        BodyText(text = "Newest first")
                    }
                }
            }
        }

        compose.onNodeWithText("Newest first", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun expandedPopoverShowsContent() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    Popover(
                        expanded = true,
                        onDismissRequest = {},
                        accessibleName = "Sort order",
                        logger = NoopLogger(),
                    ) {
                        BodyText(text = "Newest first")
                    }
                }
            }
        }

        compose.onNodeWithText("Newest first", useUnmergedTree = true).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
