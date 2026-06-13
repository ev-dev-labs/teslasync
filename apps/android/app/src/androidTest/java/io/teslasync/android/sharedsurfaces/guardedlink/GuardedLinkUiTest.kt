// On-device verification of the GuardedLink surface — the parity port of the web `GuardedLink`
// (web/src/components/feedback/GuardedLink.tsx) and its `NavigationGuardProvider` dialog. Covers what the
// offline unit tests cannot: the link renders its caller content as ONE clickable Role.Button node, a
// clean tap navigates, a bypass tap navigates without a dialog, a dirty tap routes through the hosted
// confirmation (discard navigates, keep-editing cancels), a disabled link exposes no click action, the
// accessibility label is present, and the one-shot PII-safe `view.opened` diagnostic fires. The offline
// :android:testReleaseUnitTest gate covers the pure model + the state-holder over the seam. Every test
// binds its own [DefaultNavigationGuard] so the process singleton is never polluted across cases.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.guardedlink

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertHasNoClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class GuardedLinkUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val chrome =
        NavGuardChrome(
            title = "Unsaved changes",
            fallbackMessage = "You have unsaved changes. Discard them?",
            discardLabel = "Discard changes",
            keepEditingLabel = "Keep editing",
        )

    private val rootTag = GuardedLinkRegistration.ROOT_TEST_TAG

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

    private fun dirtyGuard(message: String? = "You have an unsaved alert rule."): NavigationGuard =
        DefaultNavigationGuard().apply {
            register(NavigationGuardEntry(id = "form", isDirty = { true }, getMessage = { message }))
        }

    // ── Render contract: one clickable Role.Button node carrying the caller content ───────────────────

    @Test
    fun rendersContentAsASingleClickableNode() {
        mount {
            GuardedLink(
                onNavigate = {},
                contentDescription = "Open settings",
                guard = DefaultNavigationGuard(),
                logger = RecordingLogger(),
            ) {
                Text("Open settings")
            }
        }

        compose.onNodeWithText("Open settings").assertIsDisplayed()
        compose.onNodeWithTag(rootTag).assertHasClickAction()
    }

    // ── State: clean tree — tapping navigates straight away (web confirmIfDirty -> true) ──────────────

    @Test
    fun cleanTapNavigates() {
        var navigated = 0
        mount {
            GuardedLink(onNavigate = { navigated++ }, guard = DefaultNavigationGuard(), logger = RecordingLogger()) {
                Text("Drives")
            }
        }

        compose.onNodeWithTag(rootTag).performClick()
        compose.waitForIdle()

        assertEquals(1, navigated)
    }

    // ── State: bypass — navigates without ever opening the dialog (web target="_blank") ───────────────

    @Test
    fun bypassTapNavigatesWithoutDialog() {
        var navigated = 0
        val guard = dirtyGuard()
        mount {
            GuardedLink(onNavigate = { navigated++ }, bypassGuard = true, guard = guard, logger = RecordingLogger()) {
                Text("Open externally")
            }
            NavigationGuardHost(chrome = chrome, guard = guard)
        }

        compose.onNodeWithTag(rootTag).performClick()
        compose.waitForIdle()

        assertEquals(1, navigated)
        compose.onNodeWithText(chrome.title).assertDoesNotExist()
    }

    // ── State: dirty -> confirmation -> discard navigates (web ok === true) ───────────────────────────

    @Test
    fun dirtyTapShowsConfirmationAndDiscardNavigates() {
        var navigated = 0
        val guard = dirtyGuard()
        mount {
            GuardedLink(onNavigate = { navigated++ }, guard = guard, logger = RecordingLogger()) { Text("Settings") }
            NavigationGuardHost(chrome = chrome, guard = guard)
        }

        compose.onNodeWithTag(rootTag).performClick()
        compose.waitForIdle()

        compose.onNodeWithText(chrome.title).assertIsDisplayed()
        compose.onNodeWithText("You have an unsaved alert rule.").assertIsDisplayed()
        assertEquals(0, navigated)

        compose.onNodeWithText(chrome.discardLabel).performClick()
        compose.waitForIdle()

        assertEquals(1, navigated)
    }

    // ── State: dirty -> confirmation -> keep editing cancels (web ok === false) ───────────────────────

    @Test
    fun keepEditingCancelsNavigation() {
        var navigated = 0
        val guard = dirtyGuard()
        mount {
            GuardedLink(onNavigate = { navigated++ }, guard = guard, logger = RecordingLogger()) { Text("Settings") }
            NavigationGuardHost(chrome = chrome, guard = guard)
        }

        compose.onNodeWithTag(rootTag).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(chrome.keepEditingLabel).performClick()
        compose.waitForIdle()

        assertEquals(0, navigated)
        compose.onNodeWithText(chrome.title).assertDoesNotExist()
    }

    // ── Accessibility: disabled link exposes no click action; the label is present ────────────────────

    @Test
    fun disabledLinkExposesNoClickAction() {
        var navigated = 0
        mount {
            GuardedLink(
                onNavigate = { navigated++ },
                enabled = false,
                contentDescription = "Open settings",
                guard = DefaultNavigationGuard(),
                logger = RecordingLogger(),
            ) {
                Text("Open settings")
            }
        }

        compose.onNodeWithTag(rootTag).assertHasNoClickAction()
        compose.onNodeWithContentDescription("Open settings").assertIsDisplayed()
        compose.onNodeWithTag(rootTag).performClick()
        compose.waitForIdle()
        assertEquals(0, navigated)
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ───────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnostic() {
        val logger = RecordingLogger()
        mount {
            GuardedLink(onNavigate = {}, guard = DefaultNavigationGuard(), logger = logger) { Text("Drives") }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
        assertEquals(1, opened.size)
        val record = opened.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf(FIELD_SURFACE to GuardedLinkRegistration.SLUG), record.fields)
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
