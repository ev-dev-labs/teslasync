package io.teslasync.android.miscsurfaces.globalshortcuts

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onChildren
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [GlobalShortcuts] registration provider — the parity port of the web
 * `GlobalShortcuts(): null` (web/src/lib/globalShortcuts.tsx). Covers what the offline projection test cannot: the
 * Compose lifecycle behaviour (register on enter composition, unregister on leave — the web `useShortcut` effect),
 * the i18n resolution at the Compose boundary, the `view.opened` diagnostic, and the accessibility contract that
 * the surface introduces NO interactive node (it renders nothing, just like the web component). The offline gate's
 * `testReleaseUnitTest` covers the pure catalogue + registry + diagnostics.
 */
class GlobalShortcutsUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Registration lifecycle (web useShortcut: register on mount, cleanup on unmount) ──────────────

    @Test
    fun mountingSeedsTheRegistryWithTheTwentyOneDefinitionsInOrder() {
        val registry = ShortcutRegistry()
        setContent(registry)

        val registered = registry.shortcuts.value
        assertEquals(21, registered.size)
        assertEquals("global.palette.ctrlk", registered.first().id)
        assertEquals("global.palette.cmd.action.dashboard.edit", registered.last().id)
        assertTrue(registered.any { it.id == "global.goto.d" })
        // The registry mirrors the projection's id order exactly.
        assertEquals(GlobalShortcutsProjection.blueprints.map { it.id }, registered.map { it.id })
    }

    @Test
    fun registeredDefinitionsCarryTheLocalizedCatalogStrings() {
        val registry = ShortcutRegistry()
        setContent(registry)

        val byId = registry.shortcuts.value.associateBy { it.id }
        // Group titles + descriptions resolve through the P1/S10 catalog (en fallback values).
        assertEquals("Actions", byId.getValue("global.palette.ctrlk").group)
        assertEquals("Open command palette", byId.getValue("global.palette.ctrlk").description)
        assertEquals("Navigation (press g then…)", byId.getValue("global.goto.d").group)
        // The goto description interpolates the destination's localized nav title (Dashboard), not an English literal.
        assertEquals("Go to Dashboard", byId.getValue("global.goto.d").description)
        // Vehicles resolves to the localized nav title "Fleet" — a documented, never-silent refinement.
        assertEquals("Go to Fleet", byId.getValue("global.goto.v").description)
        assertEquals("Commands", byId.getValue("global.palette.cmd.pref.themePicker").group)
        assertEquals("Open theme picker", byId.getValue("global.palette.cmd.pref.themePicker").description)
    }

    @Test
    fun leavingCompositionUnregistersEveryDefinition() {
        val registry = ShortcutRegistry()
        var mounted by mutableStateOf(true)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                if (mounted) GlobalShortcuts(registry = registry, logger = RecordingLogger())
            }
        }
        compose.waitForIdle()
        assertEquals(21, registry.shortcuts.value.size)

        compose.runOnUiThread { mounted = false }
        compose.waitForIdle()

        assertTrue("registry must be cleared on unmount (web useShortcut cleanup)", registry.shortcuts.value.isEmpty())
    }

    // ── Accessibility / render contract: the provider emits NOTHING (web `return null`) ──────────────

    @Test
    fun providerRendersNoVisibleOrInteractiveNode() {
        val registry = ShortcutRegistry()
        setContent(registry)

        // No interactive element exists — the surface renders nothing, so there is no node to label for TalkBack.
        compose.onAllNodes(hasClickAction()).assertCountEquals(0)
        compose.onRoot().onChildren().assertCountEquals(0)
        // The registered descriptions are NOT drawn here (the separate cheatsheet reader renders them).
        compose.onNodeWithText("Open command palette").assertDoesNotExist()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ───────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val registry = ShortcutRegistry()
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                GlobalShortcuts(registry = registry, logger = logger)
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "globalShortcuts"), fields)
    }

    private fun setContent(registry: ShortcutRegistry) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                GlobalShortcuts(registry = registry, logger = RecordingLogger())
            }
        }
        compose.waitForIdle()
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
