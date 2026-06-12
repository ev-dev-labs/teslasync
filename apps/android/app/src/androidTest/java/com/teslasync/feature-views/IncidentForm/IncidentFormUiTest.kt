// Instrumented Compose UI + accessibility verification of [IncidentFormContent] across the branches the web
// component renders: the idle form (every labelled control present), the submit hand-off (the assembled draft with
// the web default severity/status), the Cancel affordance, and the in-flight state (web `create.isPending` — the
// submit button flips to its logging label and both actions disable). Runs under `connectedAndroidTest` (a
// device/emulator); the offline gate's `testReleaseUnitTest` covers the pure model + the ViewModel orchestration.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.incidentform

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class IncidentFormUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        IncidentFormStrings(
            title = "Log an incident",
            close = "Close",
            titleLabel = "Title",
            titleHint = "e.g. Wall connector restart at 14:00",
            severityLabel = "Severity",
            severityMinor = "Minor",
            severityMajor = "Major",
            severityCritical = "Critical",
            statusLabel = "Status",
            statusInvestigating = "Investigating",
            statusIdentified = "Identified",
            statusMonitoring = "Monitoring",
            statusResolved = "Resolved",
            componentsLabel = "Affected components",
            componentsHint = "Comma-separated, optional",
            messageLabel = "Initial timeline message",
            messageHint = "Optional",
            cancel = "Cancel",
            submit = "Log incident",
            submitting = "Logging…",
            toastLogged = "Incident logged.",
            toastSubmitFailed = "Failed to log incident",
            validationTitleTooShort = "Title must be at least 3 characters.",
        )

    private fun setContent(
        submitting: Boolean = false,
        onSubmit: (IncidentDraft) -> Unit = {},
        onCancel: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    IncidentFormContent(
                        strings = strings,
                        submitting = submitting,
                        onSubmit = onSubmit,
                        onCancel = onCancel,
                    )
                }
            }
        }
    }

    @Test
    fun everyFieldAndActionExposesItsLabel() {
        setContent()
        compose.onNodeWithText(strings.titleLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.severityLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.statusLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.componentsLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.messageLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.cancel).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.submit).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun submitHandsBackTypedTitleWithWebDefaults() {
        var submitted: IncidentDraft? = null
        setContent(onSubmit = { submitted = it })

        compose.onNodeWithText(strings.titleLabel).performTextInput("Outage in bay 3")
        compose.onNodeWithText(strings.submit).performClick()

        assertEquals("Outage in bay 3", submitted?.title)
        assertEquals(IncidentSeverity.Minor, submitted?.severity)
        assertEquals(IncidentStatus.Investigating, submitted?.status)
    }

    @Test
    fun cancelInvokesOnCancel() {
        var cancelled = false
        setContent(onCancel = { cancelled = true })
        compose.onNodeWithText(strings.cancel).performClick()
        assertTrue(cancelled)
    }

    @Test
    fun inFlightShowsLoggingLabelAndDisablesActions() {
        setContent(submitting = true)
        compose.onNodeWithText(strings.submitting).assertIsDisplayed().assertIsNotEnabled()
        compose.onNodeWithText(strings.cancel).assertIsNotEnabled()
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
