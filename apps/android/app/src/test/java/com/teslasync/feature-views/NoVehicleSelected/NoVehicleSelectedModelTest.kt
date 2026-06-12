// Off-device unit coverage for the NoVehicleSelected feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the web `override ?? default` resolver, the host guard that
// mirrors `useSelectedVehicle().vehicleId == null`, the surface-state classifier the composable switches
// on (per-state coverage over the shared UiState lifecycle), the accessibility content-description fold
// (a11y label coverage), the onboarding navigation target locked to the canonical Destinations graph,
// and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :app:testReleaseUnitTest. Reference values are the strings + behaviour the web component produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.novehicleselected

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.Destinations
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NoVehicleSelectedModelTest {
    // ── defaults + i18n keys mirror the web source ──────────────────────────────

    @Test
    fun defaultsMirrorWebSource() {
        assertEquals("No vehicle selected", NoVehicleSelectedDefaults.TITLE)
        assertEquals(
            "Add a vehicle to your fleet to see data on this page.",
            NoVehicleSelectedDefaults.DESCRIPTION,
        )
        assertEquals("Set up TeslaSync", NoVehicleSelectedDefaults.ACTION)
    }

    @Test
    fun i18nKeysMatchCatalogResourceNames() {
        // Each web `common.noVehicleSelected.*` key maps to a `translation_*` resource present in
        // values/, values-ar/, and values-he/ (asserted by name; resource bytes are not read off-device).
        assertEquals("translation_common_noVehicleSelected_title", KEY_TITLE)
        assertEquals("translation_common_noVehicleSelected_desc", KEY_DESCRIPTION)
        assertEquals("translation_common_noVehicleSelected_action", KEY_ACTION)
    }

    // ── override resolver (web `override ?? default`) ────────────────────────────

    @Test
    fun resolveOverrideKeepsCallerTextAndFallsBackOnNull() {
        assertEquals("Pick a vehicle", resolveOverride("Pick a vehicle", NoVehicleSelectedDefaults.TITLE))
        assertEquals(NoVehicleSelectedDefaults.TITLE, resolveOverride(null, NoVehicleSelectedDefaults.TITLE))
        // JS `??` only coalesces null/undefined — an explicit empty override is kept verbatim.
        assertEquals("", resolveOverride("", NoVehicleSelectedDefaults.TITLE))
    }

    // ── host guard (web `useSelectedVehicle().vehicleId == null`) ────────────────

    @Test
    fun shouldRenderOnlyWhenNoVehicleSelected() {
        assertTrue(shouldRender(null))
        assertFalse(shouldRender(1L))
        assertFalse(shouldRender(0L))
    }

    // ── surface classifier: per-state coverage over the shared UiState lifecycle ─

    @Test
    fun surfaceForMapsLifecycleFlags() {
        assertEquals(
            NoVehicleSelectedSurfaceState.Loading,
            noVehicleSelectedSurfaceFor(isLoading = true, isError = false),
        )
        assertEquals(
            NoVehicleSelectedSurfaceState.Error,
            noVehicleSelectedSurfaceFor(isLoading = false, isError = true),
        )
        // Loading wins when both flags are set (first-load over a prior error).
        assertEquals(
            NoVehicleSelectedSurfaceState.Loading,
            noVehicleSelectedSurfaceFor(isLoading = true, isError = true),
        )
        assertEquals(
            NoVehicleSelectedSurfaceState.Empty,
            noVehicleSelectedSurfaceFor(isLoading = false, isError = false),
        )
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(NoVehicleSelectedSurfaceState.Loading, surfaceFor(UiState.loading<Unit>()))
        assertEquals(
            NoVehicleSelectedSurfaceState.Error,
            surfaceFor(UiState<Unit>(UiPhase.Error, errorKind = ErrorKind.Network)),
        )
        assertEquals(NoVehicleSelectedSurfaceState.Empty, surfaceFor(UiState<Unit>(UiPhase.Content, data = Unit)))
        assertEquals(NoVehicleSelectedSurfaceState.Empty, surfaceFor(UiState<Unit>(UiPhase.Empty, data = Unit)))
        // Stale/offline (cached content after a failed refresh) resolves to the empty presentation.
        val offline = UiState<Unit>(UiPhase.Content, data = Unit, stale = true, errorKind = ErrorKind.Network)
        assertEquals(NoVehicleSelectedSurfaceState.Empty, surfaceFor(offline))
        assertTrue(offline.isOffline)
    }

    // ── accessibility label fold ─────────────────────────────────────────────────

    @Test
    fun emptyStateContentDescriptionFoldsTitleAndMessage() {
        assertEquals(
            "No vehicle selected. Add a vehicle to your fleet to see data on this page.",
            emptyStateContentDescription(
                NoVehicleSelectedDefaults.TITLE,
                NoVehicleSelectedDefaults.DESCRIPTION,
            ),
        )
    }

    // ── onboarding navigation target locked to the canonical graph ───────────────

    @Test
    fun onboardingTargetMatchesCanonicalDestination() {
        assertEquals("onboarding", NoVehicleSelectedNavigation.ONBOARDING_DESTINATION_ID)
        assertEquals("/onboarding", NoVehicleSelectedNavigation.ONBOARDING_WEB_PATH)
        val destination = Destinations.require(NoVehicleSelectedNavigation.ONBOARDING_DESTINATION_ID)
        assertEquals(NoVehicleSelectedNavigation.ONBOARDING_WEB_PATH, destination.webPath)
        assertEquals(NoVehicleSelectedNavigation.ONBOARDING_ROUTE, destination.route)
    }

    // ── diagnostics: one PII-safe view.opened ────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        recordNoVehicleSelectedOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no vehicle id / VIN can leak through the diagnostic.
        assertEquals(mapOf("surface" to "NoVehicleSelected"), records[0].fields)
    }

    @Test
    fun registrationIdsAreStable() {
        assertEquals("no-vehicle-selected", NoVehicleSelectedRegistration.ID)
        assertEquals("NoVehicleSelected", NoVehicleSelectedRegistration.SLUG)
    }

    /** Bridges a [UiState] to the composable's classifier the same way `NoVehicleSelectedContent` does. */
    private fun surfaceFor(state: UiState<*>): NoVehicleSelectedSurfaceState =
        noVehicleSelectedSurfaceFor(isLoading = state.isLoading, isError = state.isError)
}
