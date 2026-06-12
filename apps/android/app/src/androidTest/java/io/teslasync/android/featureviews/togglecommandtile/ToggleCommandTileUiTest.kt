package io.teslasync.android.featureviews.togglecommandtile

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
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [ToggleCommandTile] across every state the web
 * component renders (web/src/features/system/components/ToggleCommandTile.tsx): off (OFF line, neutral chrome),
 * on (ON line, tinted chrome) both controlled (a vehicle-state field) and uncontrolled (the local toggle),
 * in-flight (loading — taps ignored, tile still rendered), favourite on/off, the input-command dialog routing,
 * and the success/error last-status line. It also proves the tap precedence (web `handleClick`) — turn-on,
 * turn-off, request-dialog, ignore-while-loading — and the favourite's `stopPropagation`. The "Toggle
 * favorite" / "ON" / "OFF" labels are resolved from the app's i18n resources so the test follows the device
 * locale rather than hard-coding English. Runs under `connectedAndroidTest`; the offline
 * `testReleaseUnitTest` gate covers the pure projection + diagnostics.
 */
class ToggleCommandTileUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val favoriteLabel get() = context.getString(R.string.translation_commands_toggleFavorite)
    private val onText get() = context.getString(R.string.translation_commands_on)
    private val offText get() = context.getString(R.string.translation_commands_off)

    private val label = "Sentry Mode"
    private val params = mapOf<String, Any?>("on" to true)

    private val uncontrolledDef =
        ToggleCommandTileData(
            labelKey = "commands.sentry.label",
            labelFallback = label,
            command = "sentry_on",
            commandOff = "sentry_off",
            params = params,
        )

    private class NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private class Captures {
        val executed = mutableListOf<Pair<String, Map<String, Any?>>>()
        var dialogRequests = 0
        var favoriteToggles = 0
    }

    private fun setContent(
        data: ToggleCommandTileData = uncontrolledDef,
        vehicleState: Map<String, Boolean?>? = null,
        loading: Boolean = false,
        isFavorite: Boolean = false,
        lastStatus: String? = null,
        captures: Captures = Captures(),
    ): Captures {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ToggleCommandTile(
                    data = data,
                    icon = TeslaGlyphs.Info,
                    loading = loading,
                    isFavorite = isFavorite,
                    onExecute = { command, p -> captures.executed += command to p },
                    onRequestDialog = { captures.dialogRequests++ },
                    onToggleFavorite = { captures.favoriteToggles++ },
                    modifier = Modifier,
                    vehicleState = vehicleState,
                    iconOff = TeslaGlyphs.Warning,
                    lastStatus = lastStatus,
                    logger = NoopLogger(),
                )
            }
        }
        return captures
    }

    @Test
    fun offStateRendersLabelOffLineAndClickableTile() {
        setContent()
        compose.onNodeWithText(label).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(offText).assertIsDisplayed()
    }

    @Test
    fun favoriteToggleExposesItsAccessibilityLabelAndIsClickable() {
        setContent(isFavorite = true)
        compose.onNodeWithContentDescription(favoriteLabel).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun tappingAnOffUncontrolledTileTurnsItOnThenOff() {
        val captures = setContent()

        // First tap: off -> on, executes the on command with its params (web TurnOn branch).
        compose.onNodeWithText(label).performClick()
        assertEquals(uncontrolledDef.command to params, captures.executed.first())
        compose.onNodeWithText(onText).assertIsDisplayed()

        // Second tap: on -> off, executes the off command with no params (web TurnOff branch).
        compose.onNodeWithText(label).performClick()
        assertEquals(uncontrolledDef.commandOff to emptyMap<String, Any?>(), captures.executed.last())
        assertEquals(0, captures.dialogRequests)
    }

    @Test
    fun tappingAnOffInputCommandRequestsTheDialog() {
        val inputDef = uncontrolledDef.copy(hasInputConfig = true)
        val captures = setContent(data = inputDef)

        compose.onNodeWithText(label).performClick()

        assertEquals(1, captures.dialogRequests)
        assertTrue(captures.executed.isEmpty())
    }

    @Test
    fun tappingWhileLoadingIgnoresTheTapButStillRendersTheTile() {
        val captures = setContent(loading = true)

        compose.onNodeWithText(label).assertIsDisplayed().performClick()

        assertTrue(captures.executed.isEmpty())
        assertEquals(0, captures.dialogRequests)
    }

    @Test
    fun tappingTheFavoriteTogglesItWithoutTriggeringTheTile() {
        val captures = setContent()

        compose.onNodeWithContentDescription(favoriteLabel).performClick()

        assertEquals(1, captures.favoriteToggles)
        assertTrue(captures.executed.isEmpty())
        assertEquals(0, captures.dialogRequests)
    }

    @Test
    fun aControlledOnTileShowsOnAndTurnsOffOnTap() {
        val controlledDef = uncontrolledDef.copy(stateField = "sentry_mode")
        val captures = setContent(data = controlledDef, vehicleState = mapOf("sentry_mode" to true))

        compose.onNodeWithText(onText).assertIsDisplayed()

        // Controlled tile is on -> tapping runs the off command (web TurnOff); local toggle is untouched.
        compose.onNodeWithText(label).performClick()
        assertEquals(controlledDef.commandOff to emptyMap<String, Any?>(), captures.executed.single())
    }

    @Test
    fun successStatusLineIsRendered() {
        val status = "${ToggleCommandTileProjection.SUCCESS_PREFIX} Sent"
        setContent(lastStatus = status)
        compose.onNodeWithText(status).assertIsDisplayed()
    }

    @Test
    fun errorStatusLineIsRendered() {
        val status = "Failed"
        val captures = setContent(lastStatus = status)
        compose.onNodeWithText(status).assertIsDisplayed()
        assertNull(captures.executed.firstOrNull())
    }
}
