package io.teslasync.android.featureviews.totpenrollmentsection

import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.totp.TOTPDerivations
import io.teslasync.shared.core.presentation.totp.TOTPStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device coverage of [TOTPEnrollmentSectionProjection] — the pure derivations the web component applies
 * client-side (open-mode boundary, activated-gated session fields, 6-digit code sanitisation, verify-error
 * classification, and the backup-codes download payload). Run by the `:android:testReleaseUnitTest` gate.
 */
class TOTPEnrollmentSectionProjectionTest {
    @Test
    fun openModeIsTheEmptyBoundary() {
        assertTrue(TOTPEnrollmentSectionProjection.isOpenMode(TOTPStatus.Open))
        assertFalse(TOTPEnrollmentSectionProjection.isOpenMode(TOTPStatus.Session(activated = true)))
    }

    @Test
    fun projectSessionPassesThroughWhenActivated() {
        val display =
            TOTPEnrollmentSectionProjection.projectSession(
                TOTPStatus.Session(activated = true, lastUsedAt = "2026-01-01T00:00:00Z", backupCodesRemaining = 7),
            )
        assertTrue(display.activated)
        assertEquals("2026-01-01T00:00:00Z", display.lastUsedAtIso)
        assertEquals(7, display.backupCodesRemaining)
    }

    @Test
    fun projectSessionGatesLastUsedAndCountWhenNotActivated() {
        val display =
            TOTPEnrollmentSectionProjection.projectSession(
                TOTPStatus.Session(activated = false, lastUsedAt = "2026-01-01T00:00:00Z", backupCodesRemaining = 9),
            )
        assertFalse(display.activated)
        assertEquals(null, display.lastUsedAtIso)
        assertEquals(0, display.backupCodesRemaining)
    }

    @Test
    fun sanitizeCodeStripsNonDigitsAndClampsToSix() {
        assertEquals("123456", TOTPEnrollmentSectionProjection.sanitizeCode("12-34 56"))
        assertEquals("123456", TOTPEnrollmentSectionProjection.sanitizeCode("1234567890"))
        assertEquals("", TOTPEnrollmentSectionProjection.sanitizeCode("abc"))
    }

    @Test
    fun verifyCodeCompletenessRequiresSixDigits() {
        assertTrue(TOTPEnrollmentSectionProjection.isVerifyCodeComplete("123456"))
        assertFalse(TOTPEnrollmentSectionProjection.isVerifyCodeComplete("12345"))
        assertFalse(TOTPEnrollmentSectionProjection.isVerifyCodeComplete(""))
    }

    @Test
    fun classifyVerifyErrorMapsTheThreeSentinels() {
        assertEquals(
            TOTPVerifyError.InvalidCode,
            TOTPEnrollmentSectionProjection.classifyVerifyError(http(TOTPDerivations.TOTP_INVALID_CODE)),
        )
        assertEquals(
            TOTPVerifyError.RateLimited,
            TOTPEnrollmentSectionProjection.classifyVerifyError(http(TOTPDerivations.TOTP_RATE_LIMITED_CODE)),
        )
        assertEquals(
            TOTPVerifyError.EnrollmentExpired,
            TOTPEnrollmentSectionProjection.classifyVerifyError(http(TOTPDerivations.TOTP_ENROLLMENT_EXPIRED_CODE)),
        )
    }

    @Test
    fun classifyVerifyErrorFoldsUnknownToGeneric() {
        assertEquals(
            TOTPVerifyError.Generic,
            TOTPEnrollmentSectionProjection.classifyVerifyError(http("SOMETHING_ELSE")),
        )
        assertEquals(
            TOTPVerifyError.Generic,
            TOTPEnrollmentSectionProjection.classifyVerifyError(ApiError.Network()),
        )
    }

    @Test
    fun backupCodesFileContentMatchesWebLayout() {
        val content = TOTPEnrollmentSectionProjection.backupCodesFileContent("# header", listOf("AAAA", "BBBB"))
        assertEquals("# header\n\nAAAA\nBBBB\n", content)
    }

    private fun http(code: String): ApiError.Http = ApiError.Http(status = 400, body = null, code = code)
}
