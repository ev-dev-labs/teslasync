// Off-device unit coverage for the ReauthDialog modal/dialog's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the mode resolution (web `monitor.mode === 'open' ? 'confirm' : 'credential'` +
// `forceMode`), the Authenticator-tab visibility over the cache-then-network TOTP read (web `totpTabAvailable` /
// `totpEnrolled`, including the loading / error / open / enrolled phases), the per-tab submit body, the blank /
// typed-confirmation guards, the server error-code mapping, the Authenticator-input sanitiser, the registry
// identifiers, and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.reauthdialog

import io.teslasync.shared.core.data.repo.AuthModeResponse
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.totp.TOTPStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReauthDialogModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    private fun authMode(mode: String): Resource<AuthModeResponse> =
        Resource.Success(AuthModeResponse(mode = mode), fetchedAt = 1L, stale = false)

    private fun totpSuccess(status: TOTPStatus): Resource<TOTPStatus> = Resource.Success(status, fetchedAt = 1L, stale = false)

    // ---- modeFor: web Root `forceMode ?? (monitor.mode === 'open' ? 'confirm' : 'credential')` ----------

    @Test
    fun modeFor_openDeploymentSelectsConfirm() {
        assertEquals(DialogMode.Confirm, ReauthDialogProjection.modeFor(authMode("open"), forceMode = null))
    }

    @Test
    fun modeFor_forwardAuthDeploymentSelectsCredential() {
        assertEquals(DialogMode.Credential, ReauthDialogProjection.modeFor(authMode("forward_auth"), forceMode = null))
    }

    @Test
    fun modeFor_unresolvedReadDefaultsToCredential() {
        assertEquals(DialogMode.Credential, ReauthDialogProjection.modeFor(null, forceMode = null))
    }

    @Test
    fun modeFor_forceModeOverridesTheRead() {
        assertEquals(DialogMode.Confirm, ReauthDialogProjection.modeFor(authMode("forward_auth"), forceMode = DialogMode.Confirm))
        assertEquals(DialogMode.Credential, ReauthDialogProjection.modeFor(authMode("open"), forceMode = DialogMode.Credential))
    }

    @Test
    fun authModeWire_readsCachedMode() {
        assertEquals("open", ReauthDialogProjection.authModeWire(authMode("open")))
        assertNull(ReauthDialogProjection.authModeWire(null))
    }

    // ---- totpEnrolled: web `data?.mode === 'session' && data.activated === true` -----------------------

    @Test
    fun totpEnrolled_trueOnlyForActivatedSession() {
        assertTrue(ReauthDialogProjection.totpEnrolled(totpSuccess(TOTPStatus.Session(activated = true))))
        assertFalse(ReauthDialogProjection.totpEnrolled(totpSuccess(TOTPStatus.Session(activated = false))))
        assertFalse(ReauthDialogProjection.totpEnrolled(totpSuccess(TOTPStatus.Open)))
        assertFalse(ReauthDialogProjection.totpEnrolled(null))
    }

    // ---- totpTabAvailable: web `!isFetched || isError || totpEnrolled || data?.mode !== 'open'` ---------

    @Test
    fun totpTabAvailable_trueWhileNotYetFetched() {
        val loading = Resource.Loading<TOTPStatus>(cached = null, fetchedAt = null, stale = false)
        assertTrue(ReauthDialogProjection.totpTabAvailable(loading))
        assertTrue(ReauthDialogProjection.totpTabAvailable(null))
    }

    @Test
    fun totpTabAvailable_trueOnError() {
        val error = Resource.Error<TOTPStatus>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom"))
        assertTrue(ReauthDialogProjection.totpTabAvailable(error))
    }

    @Test
    fun totpTabAvailable_trueWhenEnrolledOrSessionNotEnrolled() {
        assertTrue(ReauthDialogProjection.totpTabAvailable(totpSuccess(TOTPStatus.Session(activated = true))))
        // Forward-auth but not yet enrolled still shows the tab (web `data?.mode !== 'open'` is true).
        assertTrue(ReauthDialogProjection.totpTabAvailable(totpSuccess(TOTPStatus.Session(activated = false))))
    }

    @Test
    fun totpTabAvailable_falseOnlyForSettledOpenStatus() {
        assertFalse(ReauthDialogProjection.totpTabAvailable(totpSuccess(TOTPStatus.Open)))
    }

    @Test
    fun totpTabAvailable_falseWhenRefetchingPreviouslyOpenStatus() {
        // A background refetch (Loading with a prior fetchedAt + cached Open) is "fetched" → not available.
        val refetch = Resource.Loading(cached = TOTPStatus.Open, fetchedAt = 1L, stale = false)
        assertFalse(ReauthDialogProjection.totpTabAvailable(refetch))
    }

    // ---- submitBody: web `activeTab === 'password' ? { password } : { totp_code }` ---------------------

    @Test
    fun submitBody_populatesOnlyTheActiveTabField() {
        assertEquals(
            SudoSubmitBody(password = "hunter2"),
            ReauthDialogProjection.submitBody(ReauthTab.Password, password = "hunter2", totp = "123456"),
        )
        assertEquals(
            SudoSubmitBody(totpCode = "123456"),
            ReauthDialogProjection.submitBody(ReauthTab.Totp, password = "hunter2", totp = "123456"),
        )
    }

    // ---- validateCredential / validateConfirm: web blank + typed-confirmation guards ------------------

    @Test
    fun validateCredential_flagsBlankActiveField() {
        assertEquals(ReauthError.PasswordRequired, ReauthDialogProjection.validateCredential(ReauthTab.Password, "  ", "123456"))
        assertNull(ReauthDialogProjection.validateCredential(ReauthTab.Password, "hunter2", ""))
        assertEquals(ReauthError.TotpRequired, ReauthDialogProjection.validateCredential(ReauthTab.Totp, "hunter2", "  "))
        assertNull(ReauthDialogProjection.validateCredential(ReauthTab.Totp, "", "123456"))
    }

    @Test
    fun validateConfirm_requiresExactToken() {
        assertNull(ReauthDialogProjection.validateConfirm("CONFIRM"))
        assertNull(ReauthDialogProjection.validateConfirm("  CONFIRM  "))
        assertEquals(ReauthError.TypedConfirmationMismatch, ReauthDialogProjection.validateConfirm("confirm"))
        assertEquals(ReauthError.TypedConfirmationMismatch, ReauthDialogProjection.validateConfirm(""))
    }

    // ---- mapSubmitFailure: web submit-catch branch ----------------------------------------------------

    @Test
    fun mapSubmitFailure_notConfiguredSentinel() {
        assertEquals(
            ReauthError.NotConfigured,
            ReauthDialogProjection.mapSubmitFailure(REAUTH_NOT_CONFIGURED_CODE, "ignored", ReauthTab.Password),
        )
    }

    @Test
    fun mapSubmitFailure_invalidCredentialMapsByActiveTab() {
        assertEquals(
            ReauthError.InvalidPassword,
            ReauthDialogProjection.mapSubmitFailure(INVALID_CREDENTIAL_CODE, null, ReauthTab.Password),
        )
        assertEquals(
            ReauthError.InvalidTotp,
            ReauthDialogProjection.mapSubmitFailure(INVALID_CREDENTIAL_CODE, null, ReauthTab.Totp),
        )
    }

    @Test
    fun mapSubmitFailure_fallsBackToRawMessageThenUnknown() {
        assertEquals(
            ReauthError.Raw("HTTP 503"),
            ReauthDialogProjection.mapSubmitFailure(code = null, message = "HTTP 503", tab = ReauthTab.Password),
        )
        assertEquals(
            ReauthError.Unknown,
            ReauthDialogProjection.mapSubmitFailure(code = "WEIRD", message = "   ", tab = ReauthTab.Password),
        )
        assertEquals(
            ReauthError.Unknown,
            ReauthDialogProjection.mapSubmitFailure(code = null, message = null, tab = ReauthTab.Totp),
        )
    }

    // ---- sanitizeTotp: web `value.replace(/\D/g, '').slice(0, 8)` --------------------------------------

    @Test
    fun sanitizeTotp_stripsNonDigitsAndClampsToEight() {
        assertEquals("1234", ReauthDialogProjection.sanitizeTotp("12a34"))
        assertEquals("12345678", ReauthDialogProjection.sanitizeTotp("123456789"))
        assertEquals("", ReauthDialogProjection.sanitizeTotp("abc-def"))
        assertEquals("000111", ReauthDialogProjection.sanitizeTotp(" 000 111 "))
    }

    // ---- fromWire + registry + diagnostics ------------------------------------------------------------

    @Test
    fun reauthTabFromWire_defaultsToPasswordForAnythingButTotp() {
        assertEquals(ReauthTab.Totp, ReauthTab.fromWire("totp"))
        assertEquals(ReauthTab.Password, ReauthTab.fromWire("password"))
        assertEquals(ReauthTab.Password, ReauthTab.fromWire("garbage"))
    }

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("reauth-dialog", ReauthDialogRegistration.ID)
        assertEquals("ReauthDialog", ReauthDialogRegistration.SLUG)
    }

    @Test
    fun recordReauthDialogOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordReauthDialogOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ReauthDialog"), fields)
        // The diagnostic must carry no password, code, or token — only the surface slug, no digits.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
