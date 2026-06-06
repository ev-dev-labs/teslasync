package io.teslasync.shared.core.diagnostics

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * End-to-end gating + redaction tests over the [Diagnostics] facade with a fake
 * sink: proves consent default-off no-op, planted-PII redaction across all three
 * components, the typed event schema, and purge-on-revoke (ADR-016 §2–§3, §5).
 */
class DiagnosticsTest {
    private val r = Redaction.REDACTED

    private fun newDiagnostics(): Pair<Diagnostics, FakeDiagnosticsSink> {
        val sink = FakeDiagnosticsSink()
        return Diagnostics.create(sink) to sink
    }

    @Test
    fun consentDefaultsOff() {
        val (diag, _) = newDiagnostics()
        assertFalse(diag.consent.granted, "consent must default OFF (ADR-016 §3)")
    }

    @Test
    fun sinksNoOpWithoutConsent() {
        val (diag, sink) = newDiagnostics()

        diag.logger.info("drive.sync", mapOf("drive_id" to "1"))
        diag.telemetry.track(TelemetryEvent.ScreenView("dashboard", "android", "1.0.0"))
        diag.crashReporter.leaveBreadcrumb("hello")
        diag.crashReporter.recordException("IllegalState", "boom")

        assertEquals(0, sink.totalEmitted, "nothing may reach the sink before consent")
    }

    @Test
    fun loggerRedactsPlantedPiiOnceConsentGranted() {
        val (diag, sink) = newDiagnostics()
        diag.grantConsent()

        diag.logger.info(
            "drive.sync",
            linkedMapOf(
                "vin" to "5YJ3E1EA7KF000001",
                "lat" to "37.4220",
                "lon" to "-122.0841",
                "token" to "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
                "email" to "owner@example.com",
                "drive_id" to "4412",
                "distance_m" to "18230",
            ),
        )

        assertEquals(1, sink.records.size)
        val fields = sink.records.single().fields
        assertEquals(r, fields["vin"])
        assertEquals(r, fields["lat"])
        assertEquals(r, fields["lon"])
        assertEquals(r, fields["token"])
        assertEquals(r, fields["email"])
        // Non-PII operational fields retained.
        assertEquals("4412", fields["drive_id"])
        assertEquals("18230", fields["distance_m"])
    }

    @Test
    fun noPlantedPiiSubstringReachesTheSink() {
        val (diag, sink) = newDiagnostics()
        diag.grantConsent()

        diag.logger.error(
            "auth.fail",
            mapOf("authorization" to "Bearer secret-token", "vin" to "5YJ3E1EA7KF000001"),
        )

        val rendered =
            sink.records
                .single()
                .fields
                .toString()
        assertFalse(rendered.contains("5YJ3E1EA7KF000001"), "VIN leaked: $rendered")
        assertFalse(rendered.contains("secret-token"), "token leaked: $rendered")
    }

    @Test
    fun telemetryEmitsTypedSchema() {
        val (diag, sink) = newDiagnostics()
        diag.grantConsent()

        diag.telemetry.track(
            TelemetryEvent.CommandIssued(
                command = "charge_start",
                surface = "dashboard",
                result = CommandResult.Ok,
                durationMs = 1200,
            ),
        )

        val (name, props) = sink.events.single()
        assertEquals("command_issued", name)
        assertEquals(
            linkedMapOf(
                "command" to "charge_start",
                "surface" to "dashboard",
                "result" to "ok",
                "duration_ms" to "1200",
            ),
            props,
        )
    }

    @Test
    fun telemetryScrubsPiiCarriedInTypedProperties() {
        val (diag, sink) = newDiagnostics()
        diag.grantConsent()

        // A screen name should never contain PII, but the value pass is the backstop.
        diag.telemetry.track(
            TelemetryEvent.ErrorOccurred(
                code = "owner@example.com",
                domain = "auth",
                screen = "settings",
                recoverable = true,
            ),
        )

        val (_, props) = sink.events.single()
        assertEquals(r, props["code"], "PII in a typed property is still scrubbed")
        assertEquals("auth", props["domain"])
    }

    @Test
    fun crashBreadcrumbsAndExceptionsAreScrubbed() {
        val (diag, sink) = newDiagnostics()
        diag.grantConsent()

        diag.crashReporter.leaveBreadcrumb(
            "GET /vehicles?token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig near 37.4220,-122.0841",
        )
        diag.crashReporter.recordException(
            type = "TokenError",
            message = "bad token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
            fields = mapOf("vin" to "5YJ3E1EA7KF000001", "code" to "401"),
        )

        val crumb = sink.breadcrumbs.single()
        assertFalse(crumb.contains("eyJ"), "breadcrumb token leaked: $crumb")
        assertFalse(crumb.contains("37.4220"), "breadcrumb coords leaked: $crumb")

        val crash = sink.crashes.single()
        assertFalse(crash.message.contains("eyJ"), "exception message token leaked: ${crash.message}")
        assertEquals(r, crash.fields["vin"])
        assertEquals("401", crash.fields["code"])
    }

    @Test
    fun revokingConsentPurgesQueuedDataAndStopsEmission() {
        val (diag, sink) = newDiagnostics()
        diag.grantConsent()
        diag.logger.info("a", mapOf("k" to "v"))
        diag.telemetry.track(TelemetryEvent.ScreenView("home", "apple", "1.0.0"))
        assertTrue(sink.totalEmitted > 0)

        diag.revokeConsent()

        assertEquals(1, sink.purgeCount, "revoke must purge queued data")
        assertEquals(0, sink.totalEmitted, "queued payloads cleared")
        assertFalse(diag.consent.granted)

        // Further emission is a no-op after revoke.
        diag.logger.info("b", mapOf("k" to "v"))
        assertEquals(0, sink.totalEmitted)
    }

    @Test
    fun consentFlowReflectsGrantAndRevoke() {
        val (diag, _) = newDiagnostics()
        assertFalse(diag.consent.grantedFlow.value)
        diag.grantConsent()
        assertTrue(diag.consent.grantedFlow.value)
        diag.revokeConsent()
        assertFalse(diag.consent.grantedFlow.value)
    }
}
