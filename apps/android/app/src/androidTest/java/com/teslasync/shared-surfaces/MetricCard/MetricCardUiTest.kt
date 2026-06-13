// Instrumented Compose UI + accessibility verification of [MetricCardContent] across the branches the web
// MetricCard renders: the base label + value, the optional subtitle, the inline help trigger (carrying the
// localized `translation_help_tooltip_iconLabel` label), the legacy change pill (its up/down glyph + text,
// web `change && !delta`), the delta footer (routed to the delta slot the card delegates to the shipped
// Delta surface), and the neon accent icon (its accessible name when one is supplied). The delta slot is
// overridden with a tagged stand-in so this test never needs the Delta view-model — the embedded Delta's
// own rendering is covered by its accepted DeltaUiTest. Runs under `connectedAndroidTest` (a
// device/emulator); the offline gate's `testReleaseUnitTest` covers the pure model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.metriccard

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.Direction
import io.teslasync.android.components.datadisplay.MetricSemantic
import io.teslasync.android.components.datadisplay.MetricUnit
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

class MetricCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        input: MetricCardInput,
        icon: androidx.compose.ui.graphics.vector.ImageVector? = null,
        iconContentDescription: String? = null,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    MetricCardContent(
                        projection = MetricCardProjection.project(input),
                        icon = icon,
                        iconContentDescription = iconContentDescription,
                        renderDelta = { Text(DELTA_SLOT_LABEL) },
                    )
                }
            }
        }
    }

    @Test
    fun labelAndValueAreDisplayed() {
        setContent(MetricCardInput("Trips", MetricCardValue.Numeric(128.0)))
        compose.onNodeWithText("Trips", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("128", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun subtitleIsDisplayed() {
        setContent(MetricCardInput("Avg Power", MetricCardValue.Text("142 kW"), subtitle = "last 30 days"))
        compose.onNodeWithText("142 kW", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("last 30 days", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun helpTriggerExposesItsLocalizedAccessibleLabel() {
        setContent(
            MetricCardInput(
                label = "Efficiency",
                value = MetricCardValue.Text("248 Wh/mi"),
                help = MetricCardHelp(helpText = "Energy used per mile."),
            ),
        )
        // The localized "More info" label (translation_help_tooltip_iconLabel) is the trigger's TalkBack name.
        compose.onNodeWithContentDescription(MORE_INFO).assertIsDisplayed()
    }

    @Test
    fun positiveChangePillShowsUpArrowAndText() {
        setContent(
            MetricCardInput(
                label = "Efficiency",
                value = MetricCardValue.Text("248 Wh/mi"),
                change = MetricCardChange(value = "4.2%", positive = true),
            ),
        )
        compose.onNodeWithText("\u2191 4.2%", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun negativeChangePillShowsDownArrowAndText() {
        setContent(
            MetricCardInput(
                label = "Range",
                value = MetricCardValue.Text("301 mi"),
                change = MetricCardChange(value = "12 mi", positive = false),
            ),
        )
        compose.onNodeWithText("\u2193 12 mi", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun deltaFooterRoutesToTheDeltaSlot() {
        val spec = MetricCardDeltaSpec(previous = 100.0, metric = range)
        setContent(MetricCardInput("Range", MetricCardValue.Numeric(120.0), delta = spec))
        compose.onNodeWithText(DELTA_SLOT_LABEL, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun accentIconExposesItsContentDescriptionWhenNamed() {
        setContent(
            input = MetricCardInput("Avg Power", MetricCardValue.Text("142 kW"), accent = MetricCardAccent.Purple),
            icon = TeslaGlyphs.Info,
            iconContentDescription = ICON_LABEL,
        )
        compose.onNodeWithContentDescription(ICON_LABEL).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private val range = MetricSemantic("range", Direction.HigherBetter, MetricUnit.Distance)

    private companion object {
        const val DELTA_SLOT_LABEL = "delta-slot"
        const val ICON_LABEL = "Power icon"

        // en catalog value resolved on-device (translation_help_tooltip_iconLabel).
        const val MORE_INFO = "More info"

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 200.dp
    }
}
