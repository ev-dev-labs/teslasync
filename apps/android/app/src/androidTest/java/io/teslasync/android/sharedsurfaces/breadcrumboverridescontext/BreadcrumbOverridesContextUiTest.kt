// Instrumented Compose UI + accessibility verification of the BreadcrumbOverridesContext surface across the
// states the web source expresses (web/src/components/layout/BreadcrumbOverridesContext.tsx): outside / with no
// registration a breadcrumb consumer shows each route's default label (web merged map `{}`), a page that pushes
// an override via SetBreadcrumbOverrides replaces that route's label in the consuming trail (web
// `useSetBreadcrumbOverrides` -> merged `overrides` -> `useBreadcrumbs` `override ?? fallback`), unregistering
// the override reverts the trail to the default (web latest-effect-wins on unmount), and the one-shot PII-safe
// `view.opened` diagnostic (P1/S11) fires on mount. The surface is an anonymous context provider with no
// interactive elements of its own, so the accessibility guarantee asserted here is that the labels it bridges
// to the breadcrumb are exposed as TalkBack-readable text in the semantics tree (the same rationale the accepted
// ChartHiddenSeriesContext sibling documents; the diagnostics PII test is the security-equivalent guarantee).
// Runs under `connectedAndroidTest`; the offline :android:testReleaseUnitTest gate covers the pure model.

package io.teslasync.android.sharedsurfaces.breadcrumboverridescontext

import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class BreadcrumbOverridesContextUiTest {
    @get:Rule
    val compose = createComposeRule()

    // -- State: no registration -> the consuming trail shows the route default (web merged map `{}`) --------

    @Test
    fun withNoOverrideTheTrailShowsTheRouteDefaultLabel() {
        mountTrail(override = null)

        compose.onNodeWithText(DRIVE_DEFAULT).assertIsDisplayed()
        compose.onNodeWithText(OVERRIDE_LABEL).assertDoesNotExist()
    }

    // -- State: a page override replaces the route default in the trail (web override ?? fallback) ----------

    @Test
    fun aPageOverrideReplacesTheRouteDefaultLabel() {
        mountTrail(override = mapOf(DRIVE_ROUTE to OVERRIDE_LABEL))

        compose.onNodeWithText(OVERRIDE_LABEL).assertIsDisplayed()
        compose.onNodeWithText(DRIVE_DEFAULT).assertDoesNotExist()
    }

    // -- State: unregistering the override reverts to the route default (web latest-effect-wins on unmount) -

    @Test
    fun unregisteringTheOverrideRevertsToTheRouteDefault() {
        val override = mutableStateOf<BreadcrumbOverrideMap?>(mapOf(DRIVE_ROUTE to OVERRIDE_LABEL))
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BreadcrumbOverridesProvider(logger = RecordingLogger()) {
                    SetBreadcrumbOverrides(override.value)
                    BreadcrumbTrail()
                }
            }
        }
        compose.onNodeWithText(OVERRIDE_LABEL).assertIsDisplayed()

        override.value = null
        compose.waitForIdle()

        compose.onNodeWithText(DRIVE_DEFAULT).assertIsDisplayed()
        compose.onNodeWithText(OVERRIDE_LABEL).assertDoesNotExist()
    }

    // -- Accessibility: every bridged label is exposed to TalkBack as readable text -------------------------

    @Test
    fun bridgedBreadcrumbLabelsAreExposedToAccessibility() {
        mountTrail(override = mapOf(DRIVE_ROUTE to OVERRIDE_LABEL))

        // The whole resolved trail is present in the semantics tree TalkBack reads, ancestors as well as the
        // overridden current page.
        compose.onNodeWithText(ROOT_LABEL).assertIsDisplayed()
        compose.onNodeWithText(DRIVES_LABEL).assertIsDisplayed()
        compose.onNodeWithText(OVERRIDE_LABEL).assertIsDisplayed()
    }

    // -- Diagnostics: the one-shot PII-safe view.opened (P1/S11) fires on mount -----------------------------

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BreadcrumbOverridesProvider(logger = logger) {
                    BreadcrumbTrail()
                }
            }
        }
        compose.waitForIdle()

        val opened =
            logger.records.filter { it.event == "view.opened" && it.fields["surface"] == "BreadcrumbOverridesContext" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
    }

    private fun mountTrail(override: BreadcrumbOverrideMap?) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BreadcrumbOverridesProvider(logger = RecordingLogger()) {
                    SetBreadcrumbOverrides(override)
                    BreadcrumbTrail()
                }
            }
        }
    }

    @Composable
    private fun BreadcrumbTrail() {
        val overrides = useBreadcrumbOverrides()
        Row {
            TRAIL.forEach { (routePattern, fallbackLabel) ->
                Text(resolveBreadcrumbLabel(overrides, routePattern, fallbackLabel))
            }
        }
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

    private companion object {
        const val ROOT_LABEL = "Dashboard"
        const val DRIVES_LABEL = "Drives"
        const val DRIVE_ROUTE = "/drives/:id"
        const val DRIVE_DEFAULT = "Drive #4421"
        const val OVERRIDE_LABEL = "Trip to the office"

        val TRAIL =
            listOf(
                "/" to ROOT_LABEL,
                "/drives" to DRIVES_LABEL,
                DRIVE_ROUTE to DRIVE_DEFAULT,
            )
    }
}
