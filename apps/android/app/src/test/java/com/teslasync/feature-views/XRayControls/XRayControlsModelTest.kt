// Off-device unit coverage for the Ingest X-Ray controls feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the option projections (the web inline option-building analogue),
// the bucket-disable parity rule (web `BUCKET_SECS[b] >= WINDOW_SECS[windowSel]`), the controlled-value
// mapping, the top-level lifecycle classifier the composable switches on (per-state coverage), the accessible
// control-label key mirrors (a11y label coverage), and the `t(key, default)` resolver. No Compose / Android /
// HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.xraycontrols

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class XRayControlsModelTest {
    /** Deterministic label resolver standing in for the live by-name i18n lookup (always the wire token). */
    private val tokenLabelWindow: (IngestXRayWindow) -> String = { it.wire }
    private val tokenLabelBucket: (IngestXRayBucket) -> String = { it.wire }

    @Test
    fun windowLadderMatchesWebSource() {
        assertEquals(listOf("5m", "15m", "1h", "6h", "24h"), ALL_WINDOWS.map { it.wire })
        assertEquals(listOf(300, 900, 3600, 21600, 86400), ALL_WINDOWS.map { it.seconds })
    }

    @Test
    fun bucketLadderMatchesWebSource() {
        assertEquals(listOf("30s", "1m", "5m", "15m", "1h"), ALL_BUCKETS.map { it.wire })
        assertEquals(listOf(30, 60, 300, 900, 3600), ALL_BUCKETS.map { it.seconds })
    }

    @Test
    fun fromWireRoundTripsAndRejectsUnknown() {
        assertEquals(IngestXRayWindow.W1H, IngestXRayWindow.fromWire("1h"))
        assertEquals(IngestXRayBucket.B30S, IngestXRayBucket.fromWire("30s"))
        assertNull(IngestXRayWindow.fromWire("7d"))
        assertNull(IngestXRayBucket.fromWire("250ms"))
    }

    @Test
    fun vehicleLabelPrefersDisplayNameThenVinThenId() {
        assertEquals("Garage", XRayControlsProjection.vehicleLabel(XRayVehicle(1, "Garage", "VIN1")))
        assertEquals("VIN2", XRayControlsProjection.vehicleLabel(XRayVehicle(2, null, "VIN2")))
        assertEquals("VIN3", XRayControlsProjection.vehicleLabel(XRayVehicle(3, "   ", "VIN3")))
        assertEquals("Vehicle 4", XRayControlsProjection.vehicleLabel(XRayVehicle(4, null, null)))
        assertEquals("Vehicle 5", XRayControlsProjection.vehicleLabel(XRayVehicle(5, "", "  ")))
    }

    @Test
    fun vehicleOptionsLeadWithEmptySelectionRowThenMappedVehicles() {
        val options =
            XRayControlsProjection.vehicleOptions(
                listOf(XRayVehicle(1, "Model 3", null), XRayVehicle(2, null, "VINX")),
                emptySelectionLabel = "Select vehicle…",
            )
        assertEquals(3, options.size)
        assertEquals(XRayOption(VEHICLE_NONE_VALUE, "Select vehicle…"), options[0])
        assertEquals(XRayOption("1", "Model 3"), options[1])
        assertEquals(XRayOption("2", "VINX"), options[2])
        assertTrue(options.all { it.enabled })
    }

    @Test
    fun vehicleOptionsWithNoFleetStillShowsTheEmptySelectionRow() {
        val options = XRayControlsProjection.vehicleOptions(emptyList(), "Select vehicle…")
        assertEquals(listOf(XRayOption(VEHICLE_NONE_VALUE, "Select vehicle…")), options)
    }

    @Test
    fun vehicleSelectedValueMirrorsWebControlledValue() {
        assertEquals("", XRayControlsProjection.vehicleSelectedValue(null))
        assertEquals("42", XRayControlsProjection.vehicleSelectedValue(42))
    }

    @Test
    fun parseVehicleSelectionMapsBlankToNullAndParsesId() {
        assertNull(XRayControlsProjection.parseVehicleSelection(VEHICLE_NONE_VALUE))
        assertNull(XRayControlsProjection.parseVehicleSelection("   "))
        assertNull(XRayControlsProjection.parseVehicleSelection("not-a-number"))
        assertEquals(7L, XRayControlsProjection.parseVehicleSelection("7"))
    }

    @Test
    fun windowOptionsMapEveryWindowThroughTheLabelResolver() {
        val options = XRayControlsProjection.windowOptions(tokenLabelWindow)
        assertEquals(ALL_WINDOWS.map { it.wire }, options.map { it.value })
        assertEquals(ALL_WINDOWS.map { it.wire }, options.map { it.label })
        assertTrue(options.all { it.enabled })
    }

    @Test
    fun bucketDisabledWhenSpanReachesTheWindow() {
        // window 5m (300s): 30s/1m enabled; 5m/15m/1h disabled (>= window).
        assertFalse(XRayControlsProjection.bucketDisabled(IngestXRayBucket.B30S, IngestXRayWindow.W5M))
        assertFalse(XRayControlsProjection.bucketDisabled(IngestXRayBucket.B1M, IngestXRayWindow.W5M))
        assertTrue(XRayControlsProjection.bucketDisabled(IngestXRayBucket.B5M, IngestXRayWindow.W5M))
        assertTrue(XRayControlsProjection.bucketDisabled(IngestXRayBucket.B1H, IngestXRayWindow.W5M))
        // window 1h: only the 1h bucket (equal span) is disabled.
        assertFalse(XRayControlsProjection.bucketDisabled(IngestXRayBucket.B15M, IngestXRayWindow.W1H))
        assertTrue(XRayControlsProjection.bucketDisabled(IngestXRayBucket.B1H, IngestXRayWindow.W1H))
        // window 24h: every bucket is selectable.
        assertTrue(ALL_BUCKETS.none { XRayControlsProjection.bucketDisabled(it, IngestXRayWindow.W24H) })
    }

    @Test
    fun bucketOptionsCarryTheDisableFlagsForTheWindow() {
        val options = XRayControlsProjection.bucketOptions(IngestXRayWindow.W5M, tokenLabelBucket)
        assertEquals(ALL_BUCKETS.map { it.wire }, options.map { it.value })
        assertEquals(
            mapOf("30s" to true, "1m" to true, "5m" to false, "15m" to false, "1h" to false),
            options.associate { it.value to it.enabled },
        )
    }

    @Test
    fun hasSelectableVehiclesReflectsTheFleet() {
        assertFalse(XRayControlsProjection.hasSelectableVehicles(emptyList()))
        assertTrue(XRayControlsProjection.hasSelectableVehicles(listOf(XRayVehicle(1, "A", null))))
    }

    @Test
    fun surfaceForMapsLifecycleFlags() {
        assertEquals(XRayControlsSurfaceState.Loading, xrayControlsSurfaceFor(isLoading = true, isError = false))
        assertEquals(XRayControlsSurfaceState.Error, xrayControlsSurfaceFor(isLoading = false, isError = true))
        assertEquals(XRayControlsSurfaceState.Loading, xrayControlsSurfaceFor(isLoading = true, isError = true))
        assertEquals(XRayControlsSurfaceState.Ready, xrayControlsSurfaceFor(isLoading = false, isError = false))
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(XRayControlsSurfaceState.Loading, surfaceFor(UiState.loading<List<XRayVehicle>>()))
        val error = UiState<List<XRayVehicle>>(UiPhase.Error, errorKind = ErrorKind.Network)
        assertEquals(XRayControlsSurfaceState.Error, surfaceFor(error))
        assertEquals(
            XRayControlsSurfaceState.Ready,
            surfaceFor(UiState(UiPhase.Content, data = emptyList<XRayVehicle>())),
        )
        assertEquals(
            XRayControlsSurfaceState.Ready,
            surfaceFor(UiState(UiPhase.Empty, data = emptyList<XRayVehicle>())),
        )
        val offline =
            UiState(
                UiPhase.Content,
                data = listOf(XRayVehicle(1, "A", null)),
                stale = true,
                errorKind = ErrorKind.Network,
            )
        assertEquals(XRayControlsSurfaceState.Ready, surfaceFor(offline))
        assertTrue(offline.isOffline)
    }

    @Test
    fun accessibleControlKeysMirrorWebAriaLabels() {
        assertEquals("translation_admin_xray_controls_vehicleAria", KEY_VEHICLE_ARIA)
        assertEquals("translation_admin_xray_controls_windowAria", KEY_WINDOW_ARIA)
        assertEquals("translation_admin_xray_controls_bucketAria", KEY_BUCKET_ARIA)
        assertEquals("translation_admin_xray_controls_selectVehicle", KEY_SELECT_VEHICLE)
    }

    @Test
    fun optionKeysFollowTheWebNamespace() {
        assertEquals("translation_admin_xray_windowOption_5m", windowOptionKey(IngestXRayWindow.W5M))
        assertEquals("translation_admin_xray_bucketOption_30s", bucketOptionKey(IngestXRayBucket.B30S))
        assertEquals("translation_admin_xray_controls_noVehicles", KEY_NO_VEHICLES)
        assertEquals("XRayControls", XRayControlsRegistration.SLUG)
        assertFalse(XRayControlsDefaults.NO_VEHICLES.isBlank())
    }

    @Test
    fun resolveOptionalReturnsLookupWhenPresentElseFallback() {
        val present: (String) -> String? = mapOf(KEY_NO_VEHICLES to "No vehicles")::get
        assertEquals("No vehicles", resolveOptional(present, KEY_NO_VEHICLES, XRayControlsDefaults.NO_VEHICLES))
        assertEquals(
            XRayControlsDefaults.NO_VEHICLES,
            resolveOptional({ null }, KEY_NO_VEHICLES, XRayControlsDefaults.NO_VEHICLES),
        )
        assertEquals("5m", resolveOptional({ "" }, windowOptionKey(IngestXRayWindow.W5M), IngestXRayWindow.W5M.wire))
    }

    /** Bridges a [UiState] to the composable's classifier the same way `XRayControlsContent` does. */
    private fun surfaceFor(state: UiState<*>): XRayControlsSurfaceState =
        xrayControlsSurfaceFor(isLoading = state.isLoading, isError = state.isError)
}
