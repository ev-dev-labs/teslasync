package io.teslasync.android.featureviews.commandtile

import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [CommandTileContent] across every state the web
 * component renders (web/src/features/system/components/CommandTile.tsx): idle (icon + label + optional
 * sublabel), in-flight (loading — taps ignored, tile still rendered), favourite on/off, dangerous (tap routes to
 * the confirm dialog), and the success/error last-status line. It also proves the tap precedence (web
 * `handleClick`) and the favourite's `stopPropagation`. The "Toggle favorite" label is resolved from the app's
 * i18n resources so the test follows the device locale rather than hard-coding English. Runs under
 * `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure model + diagnostics.
 */
class CommandTileUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val favoriteLabel get() = context.getString(R.string.translation_commands_toggleFavorite)

    private val label = "Flash Lights"
    private val sublabel = "Signal"
    private val params = mapOf<String, Any?>("intensity" to "high")

    private val baseDef =
        CommandTileDef(
            id = "flash-lights",
            command = "flash_lights",
            label = label,
            sublabel = sublabel,
            params = params,
        )

    private class Captures {
        var executed: Pair<String, Map<String, Any?>>? = null
        var dialogFor: CommandTileDef? = null
        var favoriteToggles = 0
    }

    private fun setContent(
        def: CommandTileDef = baseDef,
        loading: Boolean = false,
        isFavorite: Boolean = false,
        lastStatus: String? = null,
        captures: Captures = Captures(),
    ): Captures {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CommandTileContent(
                    def = def,
                    icon = TeslaGlyphs.Info,
                    loading = loading,
                    isFavorite = isFavorite,
                    onExecute = { command, p -> captures.executed = command to p },
                    onRequestDialog = { captures.dialogFor = it },
                    onToggleFavorite = { captures.favoriteToggles++ },
                    modifier = Modifier,
                    lastStatus = lastStatus,
                )
            }
        }
        return captures
    }

    @Test
    fun idleStateRendersLabelSublabelAndClickableTile() {
        setContent()
        compose.onNodeWithText(label).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(sublabel).assertIsDisplayed()
    }

    @Test
    fun favoriteToggleExposesItsAccessibilityLabelAndIsClickable() {
        setContent()
        compose.onNodeWithContentDescription(favoriteLabel).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun tappingAnOrdinaryTileExecutesWithCommandAndParams() {
        val captures = setContent()

        compose.onNodeWithText(label).performClick()

        assertEquals(baseDef.command to params, captures.executed)
        assertNull(captures.dialogFor)
        assertEquals(0, captures.favoriteToggles)
    }

    @Test
    fun tappingADangerousTileRequestsTheConfirmDialog() {
        val dangerousDef = baseDef.copy(dangerous = true, variant = CommandVariant.Danger)
        val captures = setContent(def = dangerousDef)

        compose.onNodeWithText(label).performClick()

        assertEquals(dangerousDef, captures.dialogFor)
        assertNull(captures.executed)
    }

    @Test
    fun tappingWhileLoadingIgnoresTheTapButStillRendersTheTile() {
        val captures = setContent(loading = true)

        compose.onNodeWithText(label).assertIsDisplayed().performClick()

        assertNull(captures.executed)
        assertNull(captures.dialogFor)
    }

    @Test
    fun tappingTheFavoriteTogglesItWithoutTriggeringTheTile() {
        val captures = setContent()

        compose.onNodeWithContentDescription(favoriteLabel).performClick()

        assertEquals(1, captures.favoriteToggles)
        assertNull(captures.executed)
        assertNull(captures.dialogFor)
    }

    @Test
    fun successStatusLineIsRendered() {
        val status = "${CommandStatusTone.SUCCESS_PREFIX} Sent"
        setContent(lastStatus = status)
        compose.onNodeWithText(status).assertIsDisplayed()
    }

    @Test
    fun errorStatusLineIsRendered() {
        val status = "Failed"
        setContent(lastStatus = status)
        compose.onNodeWithText(status).assertIsDisplayed()
    }
}
