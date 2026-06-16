package io.teslasync.android.onboarding

import io.teslasync.android.featureviews.stepper.OnboardingStepData
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.onboarding.OnboardingStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device coverage for the framework-free OnboardingPage model — the `steps` builder (a 1:1 port of the web
 * page's `steps` useMemo), the pessimistic-default gate fallback, and the one PII-safe `view.opened` diagnostic
 * (web/src/features/onboarding/pages/OnboardingPage.tsx). Run by the `:app:testDebugUnitTest` gate; the Compose
 * render lives in OnboardingPage.kt.
 */
class OnboardingPageModelTest {
    @Test
    fun buildsThreeStepsInWebOrderWithStableKeys() {
        val steps = onboardingSteps(status = OnboardingStatus(), isFetching = false, labels = LABELS)

        assertEquals(3, steps.size)
        assertEquals(listOf(ONBOARDING_STEP_TESLA, ONBOARDING_STEP_VEHICLE, ONBOARDING_STEP_TELEMETRY), steps.map { it.key })
    }

    @Test
    fun mapsEachAnchorOntoItsDoneFlag() {
        val status = OnboardingStatus(teslaConnected = true, vehicleCount = 2, dataFlowing = false, isComplete = false)

        val steps = onboardingSteps(status = status, isFetching = false, labels = LABELS).associateBy { it.key }

        assertTrue(steps.getValue(ONBOARDING_STEP_TESLA).done)
        assertTrue(steps.getValue(ONBOARDING_STEP_VEHICLE).done)
        assertFalse(steps.getValue(ONBOARDING_STEP_TELEMETRY).done)
    }

    @Test
    fun vehicleStepIsNotDoneWhenCountIsZero() {
        val status = OnboardingStatus(teslaConnected = true, vehicleCount = 0, dataFlowing = true, isComplete = false)

        val vehicle = onboardingSteps(status = status, isFetching = false, labels = LABELS).step(ONBOARDING_STEP_VEHICLE)

        assertFalse(vehicle.done)
    }

    @Test
    fun teslaCtaRoutesInAppAndTelemetryCtaIsAnExternalDoc() {
        val steps = onboardingSteps(status = OnboardingStatus(), isFetching = false, labels = LABELS).associateBy { it.key }

        val tesla = steps.getValue(ONBOARDING_STEP_TESLA).cta!!
        assertEquals(OnboardingNav.TESLA_ACCOUNT_PATH, tesla.to)
        assertNull(tesla.href)
        assertEquals("Connect Tesla account", tesla.label)

        val telemetry = steps.getValue(ONBOARDING_STEP_TELEMETRY).cta!!
        assertEquals(OnboardingNav.TELEMETRY_DOCS_PATH, telemetry.href)
        assertNull(telemetry.to)
    }

    @Test
    fun vehicleCtaIsTheRefreshActionWithNeitherRouteNorLink() {
        val cta = onboardingSteps(status = OnboardingStatus(), isFetching = false, labels = LABELS).step(ONBOARDING_STEP_VEHICLE).cta!!

        assertNull(cta.to)
        assertNull(cta.href)
        assertEquals("Refresh", cta.label)
        assertFalse(cta.disabled)
    }

    @Test
    fun vehicleCtaShowsCheckingAndDisablesWhileFetching() {
        val cta = onboardingSteps(status = OnboardingStatus(), isFetching = true, labels = LABELS).step(ONBOARDING_STEP_VEHICLE).cta!!

        assertEquals("Checking…", cta.label)
        assertTrue(cta.disabled)
    }

    @Test
    fun pessimisticDefaultsFillNullStatusWithNothingSetUp() {
        val status = (null as OnboardingStatus?).orPessimisticDefaults()

        assertFalse(status.teslaConnected)
        assertEquals(0, status.vehicleCount)
        assertFalse(status.dataFlowing)
        assertFalse(status.isComplete)
    }

    @Test
    fun pessimisticDefaultsPassThroughAResolvedStatus() {
        val resolved = OnboardingStatus(teslaConnected = true, vehicleCount = 1, dataFlowing = true, isComplete = true)

        assertEquals(resolved, resolved.orPessimisticDefaults())
    }

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val logger = RecordingLogger()

        recordOnboardingPageOpened(logger)

        val opened = logger.records.single { it.event == "view.opened" }
        assertEquals("OnboardingPage", opened.fields["surface"])
    }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun List<OnboardingStepData>.step(key: String): OnboardingStepData = single { it.key == key }

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

    private companion object {
        val LABELS =
            OnboardingStepLabels(
                teslaTitle = "Connect your Tesla account",
                teslaDescription = "tesla desc",
                teslaCta = "Connect Tesla account",
                vehicleTitle = "Wait for vehicles to appear",
                vehicleDescription = "vehicle desc",
                vehicleCta = "Refresh",
                vehicleChecking = "Checking…",
                telemetryTitle = "Wait for telemetry data",
                telemetryDescription = "telemetry desc",
                telemetryDocs = "Setup guide",
            )
    }
}
