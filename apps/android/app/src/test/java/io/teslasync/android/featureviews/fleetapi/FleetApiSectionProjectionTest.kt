package io.teslasync.android.featureviews.fleetapi

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure off-device coverage of the [FleetApiSection] model layer — the native analogue of everything the
 * web component derives before returning JSX: the response envelope, the typed query projections, the
 * pairing-URL math, the result-panel + telemetry-errors-panel state machines (including the defensive
 * `extractTelemetryErrors` port), and the onboarding wizard progress / auto-detection / mark-complete.
 * Runs in the :android:testReleaseUnitTest gate.
 */
class FleetApiSectionProjectionTest {
    // ── response envelope ────────────────────────────────────────────────

    @Test
    fun responseOf_readsErrorFieldFromPayload() {
        val response = FleetApiResponse.of(buildJsonObject { put("error", "boom") })
        assertTrue(response.isError)
        assertEquals("boom", response.error)
    }

    @Test
    fun responseOf_successHasNoError() {
        val response = FleetApiResponse.of(buildJsonObject { put("baseUrl", "https://x") })
        assertFalse(response.isError)
        assertNull(response.error)
    }

    @Test
    fun responseOfError_carriesMessageOnly() {
        val response = FleetApiResponse.ofError("network down")
        assertTrue(response.isError)
        assertEquals("network down", response.error)
        assertEquals(JsonObject(emptyMap()), response.payload)
    }

    @Test
    fun responseParse_invalidJsonBecomesError() {
        assertTrue(FleetApiResponse.parse("not json").isError)
    }

    @Test
    fun prettyJson_indentsTwoSpaces() {
        val response = FleetApiResponse.of(buildJsonObject { put("k", "v") })
        assertTrue(response.prettyJson.contains("\"k\": \"v\""))
    }

    // ── typed query projections ──────────────────────────────────────────

    @Test
    fun fleetApiInfo_projectsFieldsWithFallbacks() {
        val info =
            FleetApiInfo.from(
                FleetApiResponse.of(
                    buildJsonObject {
                        put("baseUrl", "https://fleet.tesla.com")
                        put("clientId", "abc-123")
                        put("authenticated", true)
                        putJsonArray("regions") {
                            add("na")
                            add("eu")
                        }
                        put("hostname", "app.example.com")
                    },
                ),
            )
        assertEquals("https://fleet.tesla.com", info.baseUrl)
        assertEquals("abc-123", info.clientId)
        assertTrue(info.authenticated)
        assertEquals(listOf("na", "eu"), info.regions)
        assertEquals("app.example.com", info.hostname)
    }

    @Test
    fun fleetApiInfo_missingFieldsFallBack() {
        val info = FleetApiInfo.from(FleetApiResponse.of(buildJsonObject {}))
        assertEquals("", info.baseUrl)
        assertFalse(info.authenticated)
        assertTrue(info.regions.isEmpty())
        assertEquals(FLEET_API_DEFAULT_HOSTNAME, info.hostname)
    }

    @Test
    fun pairingUrl_usesHostnameOrDefault() {
        assertEquals("https://tesla.com/_ak/app.example.com", pairingUrlFor("app.example.com"))
        assertEquals("https://tesla.com/_ak/$FLEET_API_DEFAULT_HOSTNAME", pairingUrlFor(""))
    }

    @Test
    fun publicKeyStatus_projectsConfiguredFingerprintUrl() {
        val status =
            PublicKeyStatus.from(
                FleetApiResponse.of(
                    buildJsonObject {
                        put("configured", true)
                        put("fingerprint", "SHA256:ab")
                        put("wellKnownUrl", "https://x/.well-known/key")
                    },
                ),
            )
        assertTrue(status.configured)
        assertEquals("SHA256:ab", status.fingerprint)
        assertEquals("https://x/.well-known/key", status.wellKnownUrl)
    }

    @Test
    fun partnerKeyVerification_readsNestedVerificationAndPem() {
        val verification =
            PartnerKeyVerification.from(
                FleetApiResponse.of(
                    buildJsonObject {
                        putJsonObject("verification") {
                            put("remote_key_found", true)
                            put("matches_local", false)
                            put("local_key_configured", true)
                        }
                        putJsonObject("response") { put("public_key", "-----BEGIN-----") }
                    },
                ),
            )
        assertTrue(verification.remoteFound)
        assertFalse(verification.matchesLocal)
        assertTrue(verification.localConfigured)
        assertEquals("-----BEGIN-----", verification.publicKey)
    }

    // ── result panel state ───────────────────────────────────────────────

    @Test
    fun resultPanel_idleWhenNotRun() {
        assertEquals(ResultPanelState.Idle, ResultPanelState.from(null, hasRun = false))
    }

    @Test
    fun resultPanel_failureWhenResponseHasError() {
        val state = ResultPanelState.from(FleetApiResponse.ofError("nope"), hasRun = true)
        assertTrue(state is ResultPanelState.Failure)
        assertEquals("nope", (state as ResultPanelState.Failure).message)
    }

    @Test
    fun resultPanel_dataWhenSuccess() {
        val state = ResultPanelState.from(FleetApiResponse.of(buildJsonObject { put("ok", true) }), hasRun = true)
        assertTrue(state is ResultPanelState.Data)
    }

    // ── telemetry errors extraction ──────────────────────────────────────

    @Test
    fun extract_envelopeWrappedErrors() {
        val response =
            FleetApiResponse.of(
                buildJsonObject {
                    putJsonArray("errors") {
                        add(
                            buildJsonObject {
                                put("reported_at", "2026-06-11T12:00:00Z")
                                put("error_code", "STREAM_DISCONNECTED")
                                put("error_message", "lost link")
                            },
                        )
                    }
                },
            )
        val extraction = TelemetryErrorsExtractor.extract(response)
        assertTrue(extraction.ok)
        assertEquals(1, extraction.rows.size)
        assertEquals("STREAM_DISCONNECTED", extraction.rows.first().code)
        assertEquals("lost link", extraction.rows.first().message)
        assertEquals("2026-06-11T12:00:00Z", extraction.rows.first().timestamp)
    }

    @Test
    fun extract_nestedResponseErrors() {
        val response =
            FleetApiResponse.of(
                buildJsonObject {
                    putJsonObject("response") {
                        putJsonArray("errors") {
                            add(buildJsonObject { put("code", "X") })
                        }
                    }
                },
            )
        val extraction = TelemetryErrorsExtractor.extract(response)
        assertTrue(extraction.ok)
        assertEquals("X", extraction.rows.single().code)
    }

    @Test
    fun extract_arrayOnlyResponse() {
        val response =
            FleetApiResponse.of(
                buildJsonObject {
                    putJsonArray("response") {
                        add(buildJsonObject { put("topic", "T") })
                    }
                },
            )
        val extraction = TelemetryErrorsExtractor.extract(response)
        assertTrue(extraction.ok)
        assertEquals("T", extraction.rows.single().code)
    }

    @Test
    fun extract_unknownShapeIsNotOk() {
        val extraction = TelemetryErrorsExtractor.extract(FleetApiResponse.of(buildJsonObject { put("foo", "bar") }))
        assertFalse(extraction.ok)
        assertTrue(extraction.rows.isEmpty())
    }

    // ── telemetry errors panel state machine ─────────────────────────────

    @Test
    fun errorsPanel_idleWhenNotRun() {
        assertEquals(TelemetryErrorsPanelState.Idle, TelemetryErrorsPanelState.from(loading = false, response = null, hasRun = false))
    }

    @Test
    fun errorsPanel_loadingTakesPrecedence() {
        assertEquals(TelemetryErrorsPanelState.Loading, TelemetryErrorsPanelState.from(loading = true, response = null, hasRun = false))
    }

    @Test
    fun errorsPanel_failureOnApiError() {
        val state = TelemetryErrorsPanelState.from(loading = false, response = FleetApiResponse.ofError("bad"), hasRun = true)
        assertTrue(state is TelemetryErrorsPanelState.Failure)
    }

    @Test
    fun errorsPanel_rowsWhenPresent() {
        val response =
            FleetApiResponse.of(
                buildJsonObject {
                    putJsonArray("errors") { add(buildJsonObject { put("code", "Z") }) }
                },
            )
        val state = TelemetryErrorsPanelState.from(loading = false, response = response, hasRun = true)
        assertTrue(state is TelemetryErrorsPanelState.Rows)
        assertEquals(1, (state as TelemetryErrorsPanelState.Rows).rows.size)
    }

    @Test
    fun errorsPanel_emptyOkWhenHealthy() {
        val response = FleetApiResponse.of(buildJsonObject { putJsonArray("errors") {} })
        val state = TelemetryErrorsPanelState.from(loading = false, response = response, hasRun = true)
        assertTrue(state is TelemetryErrorsPanelState.Empty)
        assertTrue((state as TelemetryErrorsPanelState.Empty).ok)
        assertNull(state.rawJson)
    }

    @Test
    fun errorsPanel_emptyUnknownShapeCarriesRaw() {
        val response = FleetApiResponse.of(buildJsonObject { put("weird", "shape") })
        val state = TelemetryErrorsPanelState.from(loading = false, response = response, hasRun = true)
        assertTrue(state is TelemetryErrorsPanelState.Empty)
        assertFalse((state as TelemetryErrorsPanelState.Empty).ok)
        assertTrue(state.rawJson!!.contains("weird"))
    }

    // ── onboarding wizard ────────────────────────────────────────────────

    @Test
    fun wizard_progressAndCurrentStep() {
        val display =
            WizardProjection.project(
                WizardInputs(
                    completed = mapOf(OnboardingStepId.Account to true, OnboardingStepId.Keypair to true),
                    currentIndex = 2,
                ),
            )
        assertEquals(7, display.totalCount)
        assertEquals(2, display.completedCount)
        assertEquals((2 * 100) / 7, display.progressPercent)
        assertEquals(OnboardingStepId.Keypair, display.currentStep)
        assertTrue(display.isCurrentComplete)
        assertTrue(display.canGoPrevious)
        assertTrue(display.canGoNext)
    }

    @Test
    fun wizard_clampsCurrentIndex() {
        val display = WizardProjection.project(WizardInputs(emptyMap(), currentIndex = 99))
        assertEquals(OnboardingStepId.ordered.lastIndex, display.currentIndex)
        assertFalse(display.canGoNext)
    }

    @Test
    fun wizard_autoDetectMarksKeypairAndAuth() {
        val merged = WizardProjection.autoDetect(emptyMap(), configured = true, authenticated = true)
        assertTrue(merged[OnboardingStepId.Keypair] == true)
        assertTrue(merged[OnboardingStepId.Auth] == true)
    }

    @Test
    fun wizard_autoDetectPreservesManualCompletions() {
        val merged = WizardProjection.autoDetect(mapOf(OnboardingStepId.Account to true), configured = false, authenticated = false)
        assertTrue(merged[OnboardingStepId.Account] == true)
    }

    @Test
    fun wizard_markCompleteAdvancesAndMarks() {
        val (merged, next) = WizardProjection.markComplete(emptyMap(), currentIndex = 0)
        assertTrue(merged[OnboardingStepId.Account] == true)
        assertEquals(1, next)
    }

    @Test
    fun wizard_markCompleteDoesNotAdvancePastLast() {
        val last = OnboardingStepId.ordered.lastIndex
        val (_, next) = WizardProjection.markComplete(emptyMap(), currentIndex = last)
        assertEquals(last, next)
    }

    @Test
    fun signalCatalog_isVerbatimWebSet() {
        assertEquals(12, TelemetrySignalCatalog.categories.size)
        assertTrue(TelemetrySignalCatalog.allFields.contains("BatteryLevel"))
        assertTrue(TelemetrySignalCatalog.allFields.contains("VehicleSpeed"))
        assertEquals(30, TelemetrySignalCatalog.DEFAULT_INTERVAL_SECONDS)
    }
}
